"""Workspace Manager service: create, list and select Git worktrees; removal lives in ``removal.py``.

Every public method takes the *source repository* as a path string (any directory inside it) and never a destination:
the worktree location is built here, from a generated id, under the managed root (see ``paths.py``).
"""
from __future__ import annotations

import hashlib
import os
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import Settings
from .errors import WorkspaceError
from .gitrun import GitFailure, GitRunner
from .gitstate import WorktreeEntry, parse_status_v2, parse_worktree_list
from .paths import ManagedRoot, canonical, new_workspace_id, repo_dir_name, valid_workspace_id
from .removal import RemovalMixin
from .store import StateStore
from .validation import validate_branch_name, validate_ref

_REPO_LOCKS: dict[str, threading.RLock] = {}
_REPO_LOCKS_GUARD = threading.Lock()
ADD_TIMEOUT_S = 300.0
ID_ATTEMPTS = 5


@dataclass(frozen=True)
class RepoContext:
    cwd: Path  # a directory inside the repository, resolved
    common_dir: Path
    key: str
    repo_dir: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _short_branch(ref: str | None) -> str | None:
    return ref[len("refs/heads/"):] if ref and ref.startswith("refs/heads/") else ref


class WorkspaceService(RemovalMixin):
    def __init__(self, settings: Settings | None = None, runner: GitRunner | None = None):
        self.settings = settings or Settings.from_env()
        self.runner = runner or GitRunner(self.settings.ensure_hooks_dir())
        self.store = StateStore(self.settings.state_path)

    # ------------------------------------------------------------------ plumbing

    def _new_id(self) -> str:
        return new_workspace_id()

    @contextmanager
    def _locked(self, ctx: RepoContext) -> Iterator[None]:
        with _REPO_LOCKS_GUARD:
            lock = _REPO_LOCKS.setdefault(ctx.key, threading.RLock())
        with lock:
            yield

    def _open(self, repo: str) -> RepoContext:
        """Validate the client-supplied repository path and identify the repository it belongs to."""
        if not isinstance(repo, str) or not repo.strip() or "\0" in repo or len(repo) > 1024:
            raise WorkspaceError("invalid_repo", "repo must be a non-empty path", 400)
        if repo.startswith(("\\\\", "//")):
            raise WorkspaceError("invalid_repo", "network (UNC) and device paths are not accepted", 400)
        path = Path(repo)
        if not path.is_absolute():
            raise WorkspaceError("invalid_repo", "repo must be an absolute path", 400)
        real = Path(os.path.realpath(path))
        if not real.is_dir():
            raise WorkspaceError("invalid_repo", "repo is not an existing directory", 400)
        done = self.runner.run(real, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], check=False)
        lines = done.text().splitlines()
        if done.returncode != 0 or len(lines) != 2:
            raise WorkspaceError("not_a_repository", "the path is not inside a non-bare git working tree", 400, detail=done.stderr.strip()[:200])
        common = Path(lines[0])
        return RepoContext(cwd=real, common_dir=common, key=hashlib.sha256(canonical(common).encode("utf-8")).hexdigest()[:16],
                           repo_dir=repo_dir_name(common))

    def _worktrees(self, ctx: RepoContext) -> list[WorktreeEntry]:
        done = self.runner.run(ctx.cwd, ["worktree", "list", "--porcelain", "-z"])
        return [wt for wt in parse_worktree_list(done.stdout) if not wt.bare]

    def _registry(self, ctx: RepoContext) -> dict[str, dict[str, Any]]:
        return dict(self.store.read()["workspaces"].get(ctx.key, {}))

    def _status(self, path: str):
        return parse_status_v2(self.runner.run(
            path, ["status", "--porcelain=v2", "-z", "--untracked-files=normal", "--ignore-submodules=dirty"],
            filters=True).stdout)

    def _describe(self, wt: WorktreeEntry, position: int, registry: dict[str, dict[str, Any]], selected_id: str | None,
                  with_status: bool = True) -> dict[str, Any]:
        canon = canonical(wt.path)
        kind = "main" if position == 0 else "linked"
        record = next((rec for rec in registry.values() if canonical(rec["path"]) == canon), None)
        managed = bool(record) and kind == "linked" and ManagedRoot(self.settings.managed_root).owns(wt.path)
        ident = "main" if kind == "main" else record["id"] if managed else "ext-" + hashlib.sha256(canon.encode("utf-8")).hexdigest()[:12]
        missing = not os.path.isdir(wt.path)
        changes, state = None, "missing" if missing else "unknown"
        if not missing and not wt.prunable and with_status:
            try:
                report = self._status(wt.path)
                changes = {"modified": report.modified, "staged": report.staged, "untracked": report.untracked, "conflicted": report.conflicted}
                state = "dirty" if report.dirty else "clean"
            except (GitFailure, WorkspaceError):
                state = "unknown"
        info: dict[str, Any] = {
            "id": ident, "path": os.path.normpath(wt.path), "kind": kind, "managed": managed,
            "branch": _short_branch(wt.branch), "detached": wt.detached or wt.branch is None, "head": wt.head,
            "state": state, "dirty": None if changes is None else state == "dirty", "changes": changes,
            "locked": wt.locked, "lock_reason": wt.lock_reason, "prunable": wt.prunable, "prunable_reason": wt.prunable_reason,
            "missing": missing, "selected": ident == selected_id,
        }
        if managed:
            info.update({k: record.get(k) for k in ("created_at", "base_ref", "base_commit")})
        return info

    def _infos(self, ctx: RepoContext, with_status: bool = True) -> list[dict[str, Any]]:
        entries = self._worktrees(ctx)
        registry = self._registry(ctx)
        chosen = self.store.read()["selected"]
        selected_id = chosen["id"] if chosen and chosen.get("repo_key") == ctx.key else None
        infos = [self._describe(wt, n, registry, selected_id, with_status) for n, wt in enumerate(entries)]
        live = {canonical(wt.path) for wt in entries}
        stale = [ident for ident, rec in registry.items() if canonical(rec["path"]) not in live and not os.path.lexists(rec["path"])]
        if stale:  # registry entries whose worktree git no longer knows and whose directory is gone: drop the orphan metadata
            def forget(state):
                group = state["workspaces"].get(ctx.key, {})
                for ident in stale:
                    group.pop(ident, None)
            self.store.mutate(forget)
        return infos

    # ------------------------------------------------------------------ list / select

    def list(self, repo: str) -> list[dict[str, Any]]:
        ctx = self._open(repo)
        with self._locked(ctx):
            return self._infos(ctx)

    def _find(self, ctx: RepoContext, workspace_id: str, with_status: bool = True) -> dict[str, Any]:
        for info in self._infos(ctx, with_status):
            if info["id"] == workspace_id:
                return info
        raise WorkspaceError("workspace_not_found", "no such workspace in this repository", 404)

    def select(self, repo: str, workspace_id: str) -> dict[str, Any]:
        ctx = self._open(repo)
        with self._locked(ctx):
            info = self._find(ctx, workspace_id)
            if info["missing"] or info["prunable"]:
                raise WorkspaceError("workspace_missing", "the workspace directory is gone and cannot be selected", 409)
            main = next(i for i in self._infos(ctx, with_status=False) if i["kind"] == "main")
            record = {"repo": main["path"], "repo_key": ctx.key, "id": workspace_id, "selected_at": _now()}
            self.store.mutate(lambda state: state.update(selected=record))
            info["selected"] = True
            return info

    def clear_selection(self) -> None:
        self.store.mutate(lambda state: state.update(selected=None))

    def selected(self) -> dict[str, Any]:
        """The persisted selection, re-verified against git. ``cwd`` is the directory to run in, or None."""
        chosen = self.store.read()["selected"]
        if not chosen:
            return {"selected": None, "cwd": None, "stale": None}
        try:
            ctx = self._open(chosen["repo"])
            with self._locked(ctx):
                info = self._find(ctx, chosen["id"])
        except WorkspaceError as exc:
            return {"selected": None, "cwd": None, "stale": {"id": chosen.get("id"), "repo": chosen.get("repo"), "reason": exc.code}}
        if info["missing"] or info["prunable"]:
            return {"selected": None, "cwd": None, "stale": {"id": chosen["id"], "repo": chosen["repo"], "reason": "workspace_missing"}}
        info["selected"] = True
        return {"selected": info, "cwd": info["path"], "stale": None}

    # ------------------------------------------------------------------ create

    def create(self, repo: str, ref: str, branch: str | None = None) -> dict[str, Any]:
        validate_ref(ref)
        if branch is not None:
            validate_branch_name(branch)
        ctx = self._open(repo)
        if self.runner.run(ctx.cwd, ["check-ref-format", "--allow-onelevel", ref], check=False).returncode != 0:
            raise WorkspaceError("invalid_ref", "git does not accept this as a ref name", 400)
        if branch is not None and self.runner.run(ctx.cwd, ["check-ref-format", f"refs/heads/{branch}"], check=False).returncode != 0:
            raise WorkspaceError("invalid_branch", "git does not accept this as a branch name", 400)
        resolved = self.runner.run(ctx.cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", f"{ref}^{{commit}}"], check=False)
        commit = resolved.text().strip()
        if resolved.returncode != 0 or not commit:
            raise WorkspaceError("ref_not_found", "the ref does not name a commit in this repository", 404)
        with self._locked(ctx):
            if branch is not None and self.runner.run(
                    ctx.cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", f"refs/heads/{branch}"], check=False).returncode == 0:
                raise WorkspaceError("branch_exists", f"branch {branch!r} already exists", 409)
            dest, created_parent = self._allocate(ctx)
            args = ["worktree", "add", *(["-b", branch] if branch else ["--detach"]), "--quiet", "--", str(dest), commit]
            try:
                self.runner.run(ctx.cwd, args, filters=True, timeout=ADD_TIMEOUT_S)
            except GitFailure as exc:
                self._rollback(ctx, dest, created_parent, branch, commit)
                text = exc.stderr.lower()
                if branch is not None and "already exists" in text and "branch" in text:
                    raise WorkspaceError("branch_exists", f"branch {branch!r} already exists", 409) from exc
                raise WorkspaceError("worktree_add_failed", "git could not create the worktree", 409, detail=exc.stderr.strip()[:300]) from exc
            except BaseException:
                self._rollback(ctx, dest, created_parent, branch, commit)
                raise
            ident = dest.name
            record = {"id": ident, "path": str(dest), "branch": branch, "base_ref": ref, "base_commit": commit, "created_at": _now()}
            try:
                self.store.mutate(lambda state: state["workspaces"].setdefault(ctx.key, {}).update({ident: record}))
            except BaseException:
                self._rollback(ctx, dest, created_parent, branch, commit)
                raise
            return self._find(ctx, ident)

    def _allocate(self, ctx: RepoContext) -> tuple[Path, bool]:
        """Pick and prepare a destination: proven inside the managed root, outside every worktree of the repository."""
        probe = ManagedRoot(self.settings.managed_root)
        registered = {canonical(rec["path"]) for rec in self._registry(ctx).values()}
        root_c = canonical(probe.path)
        for wt in self._worktrees(ctx):
            wc = canonical(wt.path)
            if wc in registered:
                continue
            if wc == root_c or wc.startswith(root_c + os.sep) or root_c.startswith(wc + os.sep):
                raise WorkspaceError("unsafe_destination", "the managed root and the repository must not contain one another", 409)
        root = ManagedRoot.from_path(self.settings.managed_root)
        last: WorkspaceError | None = None
        for _ in range(ID_ATTEMPTS):
            try:
                dest = root.destination(ctx.repo_dir, self._new_id())
            except WorkspaceError as exc:
                if exc.code == "id_collision":
                    last = exc
                    continue
                raise
            return dest, root.prepare(dest)
        raise last

    def _rollback(self, ctx: RepoContext, dest: Path, created_parent: bool, branch: str | None, commit: str) -> None:
        """Undo a half-made create: the worktree (through git), the branch we made (only if it still points where we put it), the directory."""
        if os.path.lexists(dest) or canonical(dest) in {canonical(wt.path) for wt in self._worktrees(ctx)}:
            self.runner.run(ctx.cwd, ["worktree", "remove", "--force", "--", str(dest)], check=False, filters=True)
        if branch is not None:
            self.runner.run(ctx.cwd, ["update-ref", "-d", f"refs/heads/{branch}", commit], check=False)
        if created_parent:
            try:
                dest.parent.rmdir()
            except OSError:
                pass
