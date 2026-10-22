"""Two-phase worktree removal.

Phase 1, ``removal_check``: inspect the worktree (modified, staged, untracked, conflicted, ignored entries, commits that exist
only here, lock) and return the report together with a confirmation token bound to that exact state.

Phase 2, ``remove``: only with a token that still matches the state. If there is pending work it is preserved first on
``refs/openharness/rescue/<id>`` (a commit holding the index snapshot and the work tree, built with a scratch index so the user's
own index is never written); if preservation does not verify, nothing is removed. Deletion itself is always ``git worktree remove``,
never a recursive delete of our own, and never on the principal worktree, on a worktree the manager did not create, or on a locked
one unless the lock is released explicitly.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import WorkspaceError
from .gitrun import GitFailure
from .gitstate import StatusReport, WorktreeEntry, parse_status_v2
from .paths import ManagedRoot, canonical, is_link

TOKEN_TTL_S = 600
RESCUE_PREFIX = "refs/openharness/rescue/"
MAX_REPORTED_PATHS = 100
MAX_REPORTED_COMMITS = 20
_TOKEN_KEY = secrets.token_bytes(32)  # per process: a restart invalidates every outstanding confirmation, which is the safe direction
_IDENTITY = {
    "GIT_AUTHOR_NAME": "OpenHarness", "GIT_AUTHOR_EMAIL": "openharness@localhost",
    "GIT_COMMITTER_NAME": "OpenHarness", "GIT_COMMITTER_EMAIL": "openharness@localhost",
}


@dataclass
class InspectionState:
    entry: WorktreeEntry
    report: StatusReport
    status_raw: bytes
    stat: dict[str, list[int] | None]
    ignored: int
    unpushed: dict[str, Any]
    missing: bool
    fingerprint: str = field(default="")

    @property
    def dirty(self) -> bool:
        return self.report.dirty

    @property
    def pending(self) -> bool:
        return self.dirty or self.unpushed["count"] > 0


def _invalid(reason: str) -> WorkspaceError:
    return WorkspaceError("confirmation_invalid", f"the removal confirmation is not valid ({reason}); check the workspace again", 409, reason=reason)


class RemovalMixin:
    # ------------------------------------------------------------------ inspection

    def _resolve_entry(self, ctx, workspace_id: str) -> tuple[WorktreeEntry, dict[str, Any]]:
        registry = self._registry(ctx)
        for position, wt in enumerate(self._worktrees(ctx)):
            info = self._describe(wt, position, registry, None, with_status=False)
            if info["id"] == workspace_id:
                return wt, info
        raise WorkspaceError("workspace_not_found", "no such workspace in this repository", 404)

    def _unpushed(self, ctx, entry: WorktreeEntry) -> dict[str, Any]:
        """Commits reachable from this worktree's HEAD and from no other branch, remote-tracking ref or tag."""
        own = entry.branch
        try:
            refs = self.runner.run(ctx.cwd, ["for-each-ref", "--format=%(objectname) %(objecttype) %(*objecttype) %(refname)",
                                             "refs/heads", "refs/remotes", "refs/tags"]).text().splitlines()
            others = set()
            for line in refs:
                sha, kind, peeled, name = (line.split(" ", 3) + ["", "", ""])[:4] if line.count(" ") >= 3 else (None, None, None, None)
                if sha is None or name == own:
                    continue
                if kind == "commit" or (kind == "tag" and peeled == "commit"):
                    others.add(sha)
            revs = (f"{entry.head}\n" + "".join(f"^{sha}\n" for sha in sorted(others))).encode()
            count = int(self.runner.run(ctx.cwd, ["rev-list", "--count", "--stdin"], input=revs).text().strip() or 0)
            commits: list[dict[str, str]] = []
            if count:
                listing = self.runner.run(ctx.cwd, ["log", "--stdin", f"--max-count={MAX_REPORTED_COMMITS}", "--no-show-signature",
                                                    "--no-color", "--format=%H%x09%s"], input=revs).text().splitlines()
                commits = [{"sha": sha, "subject": subject} for sha, _, subject in (row.partition("\t") for row in listing)]
            upstream = bool(own and self.runner.run(ctx.cwd, ["for-each-ref", "--format=%(upstream)", own]).text().strip())
        except (GitFailure, ValueError) as exc:
            raise WorkspaceError("inspection_failed", "could not determine which commits exist only in this worktree", 409) from exc
        branch = own[len("refs/heads/"):] if own and own.startswith("refs/heads/") else None
        return {"count": count, "branch": branch, "has_upstream": upstream, "commits": commits}

    def _inspect(self, ctx, entry: WorktreeEntry, ident: str | None = None) -> dict[str, Any]:
        missing = not os.path.isdir(entry.path)
        report, raw, stat, ignored = StatusReport(), b"", {}, 0
        if not missing:
            try:
                raw = self.runner.run(entry.path, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignore-submodules=dirty"],
                                      filters=True).stdout
                report = parse_status_v2(raw)
                ignored_raw = self.runner.run(entry.path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]).stdout
                ignored = len([name for name in ignored_raw.split(b"\0") if name])
            except GitFailure as exc:
                raise WorkspaceError("inspection_failed", "git could not read the state of this worktree", 409) from exc
            for rel in report.paths:
                try:
                    st = os.lstat(os.path.join(entry.path, rel))
                    stat[rel] = [st.st_size, st.st_mtime_ns]
                except OSError:
                    stat[rel] = None
        state = InspectionState(entry=entry, report=report, status_raw=raw, stat=stat, ignored=ignored,
                                unpushed=self._unpushed(ctx, entry), missing=missing)
        state.fingerprint = hashlib.sha256(json.dumps({
            "head": entry.head, "branch": entry.branch, "locked": entry.locked, "reason": entry.lock_reason,
            "status": hashlib.sha256(raw).hexdigest(), "stat": sorted(stat.items()), "ignored": ignored,
            "unpushed": [state.unpushed["count"], [c["sha"] for c in state.unpushed["commits"]]],
        }, sort_keys=True).encode("utf-8")).hexdigest()
        return {"state": state}

    # ------------------------------------------------------------------ tokens

    @staticmethod
    def _mac(expiry: int, repo_key: str, ident: str, fingerprint: str) -> str:
        return hmac.new(_TOKEN_KEY, f"{expiry}|{repo_key}|{ident}|{fingerprint}".encode("utf-8"), hashlib.sha256).hexdigest()

    def _issue_token(self, ctx, ident: str, state: InspectionState) -> str:
        expiry = int(time.time()) + TOKEN_TTL_S
        return f"{expiry}.{self._mac(expiry, ctx.key, ident, state.fingerprint)}"

    def _verify_token(self, token: str, ctx, ident: str, state: InspectionState) -> None:
        head, dot, mac = (token or "").partition(".")
        if not dot or not head.isdigit() or not mac:
            raise _invalid("malformed")
        if time.time() > int(head):
            raise _invalid("expired")
        if not hmac.compare_digest(mac, self._mac(int(head), ctx.key, ident, state.fingerprint)):
            raise _invalid("stale")

    # ------------------------------------------------------------------ phase 1

    def _rescue_ref_for(self, ctx, ident: str) -> str:
        for n in range(1, 50):
            ref = RESCUE_PREFIX + (ident if n == 1 else f"{ident}-{n}")
            if self.runner.run(ctx.cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", ref], check=False).returncode != 0:
                return ref
        raise WorkspaceError("preservation_failed", "too many rescue refs exist for this workspace", 409)

    def _blockers(self, info: dict[str, Any]) -> list[str]:
        blockers = []
        if info["kind"] == "main":
            blockers.append("principal")
        elif not info["managed"]:
            blockers.append("not_managed")
        return blockers

    def removal_check(self, repo: str, workspace_id: str) -> dict[str, Any]:
        ctx = self._open(repo)
        with self._locked(ctx):
            entry, info = self._resolve_entry(ctx, workspace_id)
            blockers = self._blockers(info)
            state = self._inspect(ctx, entry)["state"]
            report = state.report
            paths = [{"path": p, "code": c} for p, c in list(report.paths.items())[:MAX_REPORTED_PATHS]]
            removable = not blockers
            return {
                "workspace": info, "removable": removable, "blockers": blockers,
                "changes": {"modified": report.modified, "staged": report.staged, "untracked": report.untracked,
                            "conflicted": report.conflicted, "ignored_entries": state.ignored, "paths": paths,
                            "paths_truncated": len(report.paths) > MAX_REPORTED_PATHS},
                "unpushed": state.unpushed, "locked": entry.locked, "lock_reason": entry.lock_reason,
                "needs_lock_release": entry.locked, "missing": state.missing,
                "pending_work": state.pending, "will_preserve": removable and state.pending,
                "rescue_ref": self._rescue_ref_for(ctx, workspace_id) if removable and state.pending else None,
                "confirmation_token": self._issue_token(ctx, workspace_id, state) if removable else None,
                "expires_in": TOKEN_TTL_S if removable else None,
            }

    # ------------------------------------------------------------------ phase 2

    def _assert_unlinked(self, path: str) -> None:
        """No link anywhere between the managed root and the worktree directory: git must not be pointed through one."""
        root = ManagedRoot(self.settings.managed_root).path
        current = Path(os.path.abspath(path))
        while canonical(current) != canonical(root) and current != current.parent:
            if is_link(current):
                raise WorkspaceError("unsafe_destination", "a link sits on the path of this workspace; refusing to follow it", 409)
            current = current.parent

    def remove(self, repo: str, workspace_id: str, token: str, release_lock: bool = False) -> dict[str, Any]:
        ctx = self._open(repo)
        with self._locked(ctx):
            entry, info = self._resolve_entry(ctx, workspace_id)
            if self._blockers(info):
                raise WorkspaceError("protected_workspace", "this workspace is not one the manager created and may not be removed", 403,
                                     blockers=self._blockers(info))
            self._assert_unlinked(entry.path)
            state = self._inspect(ctx, entry)["state"]
            self._verify_token(token, ctx, workspace_id, state)
            if entry.locked and not release_lock:
                raise WorkspaceError("workspace_locked", "the workspace is locked; release the lock explicitly to remove it", 409,
                                     lock_reason=entry.lock_reason)
            rescue = None
            if state.pending:
                rescue = self._create_rescue(ctx, entry, state, workspace_id)
                if self._inspect(ctx, entry)["state"].fingerprint != state.fingerprint:
                    self.runner.run(ctx.cwd, ["update-ref", "-d", rescue["ref"]], check=False)
                    raise _invalid("stale")
            unlocked = False
            if entry.locked:
                self.runner.run(ctx.cwd, ["worktree", "unlock", "--", entry.path])
                unlocked = True
            force = state.dirty or state.missing
            try:
                self.runner.run(ctx.cwd, ["worktree", "remove", *(["--force"] if force else []), "--", entry.path], timeout=120)
            except GitFailure as exc:
                if unlocked:
                    reason = ["--reason", entry.lock_reason] if entry.lock_reason else []
                    self.runner.run(ctx.cwd, ["worktree", "lock", *reason, "--", entry.path], check=False)
                raise WorkspaceError("remove_failed", "git could not remove the worktree", 409, detail=exc.stderr.strip()[:300],
                                     rescue=rescue) from exc

            def forget(data):
                data["workspaces"].get(ctx.key, {}).pop(workspace_id, None)
                chosen = data["selected"]
                if chosen and chosen.get("repo_key") == ctx.key and chosen.get("id") == workspace_id:
                    data["selected"] = None
            self.store.mutate(forget)
            branch = info["branch"]
            return {"removed": True, "id": workspace_id, "path": info["path"], "rescue": rescue, "branch_kept": branch}

    # ------------------------------------------------------------------ preservation

    def _create_rescue(self, ctx, entry: WorktreeEntry, state: InspectionState, ident: str) -> dict[str, Any]:
        """Put everything pending on ``refs/openharness/rescue/<id>`` and prove it is there, or raise ``preservation_failed``.

        The index snapshot and the work tree each become a commit built from a COPY of the index, so the user's own index and
        files are only read. Attributes are taken from the empty tree and autocrlf is off, so the stored bytes are the bytes on disk.
        """
        ref = self._rescue_ref_for(ctx, ident)
        commit = entry.head
        staged_commit = None
        created = False
        try:
            if state.dirty:
                commit, staged_commit = self._snapshot(ctx, entry, ident)
            zero = "0" * len(commit)
            self.runner.run(ctx.cwd, ["update-ref", "--no-deref", ref, commit, zero])
            created = True
            verified = self._verify_rescue(ctx, ref, commit, staged_commit, entry, state)
        except (GitFailure, OSError, WorkspaceError) as exc:
            if created:
                self.runner.run(ctx.cwd, ["update-ref", "-d", ref], check=False)
            if isinstance(exc, WorkspaceError) and exc.code == "preservation_failed":
                raise
            raise WorkspaceError("preservation_failed", "pending work could not be preserved; nothing was removed", 409,
                                 detail=str(exc)[:300]) from exc
        return {"ref": ref, "commit": commit, "verified_paths": verified, "recover": [
            f"git branch recovered/{ident} {ref}",
            f"git worktree add <new-directory> {ref}",
            f"git diff {entry.head} {ref}",
        ]}

    def _snapshot(self, ctx, entry: WorktreeEntry, ident: str) -> tuple[str, str | None]:
        run, cwd = self.runner.run, Path(entry.path)
        empty_tree = run(cwd, ["hash-object", "-t", "tree", "--stdin"], input=b"").text().strip()
        base_env = {**_IDENTITY, "GIT_ATTR_SOURCE": empty_tree}
        source_index = Path(run(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).text().strip())
        head_tree = run(cwd, ["rev-parse", f"{entry.head}^{{tree}}"]).text().strip()
        self.settings.tmp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.settings.tmp_dir) as scratch:
            def scratch_env(name: str) -> dict[str, str]:
                target = Path(scratch) / name
                if source_index.is_file():
                    shutil.copyfile(source_index, target)
                else:
                    run(cwd, ["read-tree", entry.head], env={"GIT_INDEX_FILE": str(target)})
                return {**base_env, "GIT_INDEX_FILE": str(target)}

            parent, staged_commit = entry.head, None
            staged_env = scratch_env("staged")
            staged = run(cwd, ["write-tree"], env=staged_env, check=False)  # fails with unmerged entries: then only the work tree is kept
            if staged.returncode == 0 and staged.text().strip() != head_tree:
                staged_commit = run(cwd, ["commit-tree", staged.text().strip(), "-p", entry.head, "-m",
                                          f"openharness rescue {ident}: index snapshot"], env=staged_env).text().strip()
                parent = staged_commit
            work_env = scratch_env("worktree")
            run(cwd, ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "--all"], env=work_env, filters=True, timeout=600)
            tree = run(cwd, ["write-tree"], env=work_env).text().strip()
            commit = run(cwd, ["commit-tree", tree, "-p", parent, "-m", f"openharness rescue {ident}: work tree"], env=work_env).text().strip()
        return commit, staged_commit

    def _verify_rescue(self, ctx, ref: str, commit: str, staged_commit: str | None, entry: WorktreeEntry, state: InspectionState) -> int:
        """Re-read the rescue from git and check that every changed file still on disk is in it."""
        run = self.runner.run
        stored = run(ctx.cwd, ["rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"]).text().strip()
        if stored != commit:
            raise WorkspaceError("preservation_failed", "the rescue ref does not point at the rescue commit", 409)
        if not state.dirty:
            return 0

        def names(rev: str) -> set[str]:
            raw = run(ctx.cwd, ["ls-tree", "-r", "-z", "--name-only", rev]).stdout.decode("utf-8", "surrogateescape")
            return {n for n in raw.split("\0") if n}

        in_work, in_index = names(commit), names(staged_commit) if staged_commit else set()
        checked = 0
        for rel, code in state.report.paths.items():
            full = os.path.join(entry.path, rel)
            if os.path.lexists(full) and not (os.path.isdir(full) and not is_link(full)):
                if rel.encode("utf-8", "surrogateescape").decode("utf-8", "surrogateescape") not in in_work:
                    raise WorkspaceError("preservation_failed", f"{rel!r} is not in the rescue; nothing was removed", 409)
                checked += 1
            elif code[:1] in ("A", "M", "R", "C") and staged_commit:
                if rel not in in_index:
                    raise WorkspaceError("preservation_failed", f"staged {rel!r} is not in the rescue; nothing was removed", 409)
                checked += 1
        return checked
