"""The one place the Workspace Manager starts git.

Why a dedicated runner instead of ``sandbox.exec.run``: that helper is built for approved *tool* execution. It merges
stdout and stderr into one redacted, truncated (64 KiB) string. The Workspace Manager parses NUL-separated porcelain output
and hashes it to bind a removal confirmation to the repository state, so truncation, redaction or interleaved stderr would
silently corrupt the very data a destructive decision rests on. This runner returns exact stdout bytes and keeps stderr apart.

What it guarantees, for every call:

* argv is a list, git is an absolute path resolved once, there is no shell, stdin is closed;
* the environment is rebuilt from the sidecar allowlist (``adapters.cli_shared.scrub_env``): every inherited ``GIT_*`` and every
  unrelated secret is dropped; system and global git configuration are switched off; prompts are disabled;
* repository-controlled code cannot start: hooks are redirected to an empty directory, the filesystem monitor is off, and every
  ``filter.<name>.{clean,smudge,process}`` the repository defines is blanked (``filters=True``). If a filter driver name cannot
  be neutralised exactly, the call is refused rather than run (fail closed);
* a timeout bounds every call.

What it cannot neutralise is listed in docs/adr/0008-workspace-manager.md (a repository's own ``.git`` contents are still read by git).
"""
from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from adapters.cli_shared import scrub_env

from .errors import WorkspaceError

DEFAULT_TIMEOUT_S = 30.0
MAX_STDOUT = 64 * 1024 * 1024
_FILTER_VARS = ("clean", "smudge", "process")


class GitFailure(Exception):
    """git ran and exited non-zero."""

    def __init__(self, args: list[str], returncode: int, stderr: str):
        super().__init__(f"git {' '.join(args[:3])} exited {returncode}: {stderr.strip()[:300]}")
        self.args_run = args
        self.returncode = returncode
        self.stderr = stderr


@dataclass(frozen=True)
class GitResult:
    returncode: int
    stdout: bytes
    stderr: str

    def text(self) -> str:
        return self.stdout.decode("utf-8", "replace")


def resolve_git() -> str:
    found = shutil.which("git")
    if not found:
        raise WorkspaceError("git_unavailable", "git was not found on PATH", 503)
    return os.path.abspath(found)


class GitRunner:
    def __init__(self, hooks_dir: Path, git: str | None = None):
        self.git_path = git or resolve_git()
        self.hooks_dir = Path(hooks_dir)

    def _environment(self, extra: dict[str, str] | None) -> dict[str, str]:
        env = {key: value for key, value in scrub_env().items() if not key.upper().startswith("GIT_")}
        env.update({
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0",
            "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_LAZY_FETCH": "1", "GIT_PAGER": "cat",
        })
        env.update(extra or {})
        return env

    def _base_config(self) -> list[str]:
        pairs = [
            f"core.hooksPath={self.hooks_dir}", "core.fsmonitor=false", "core.pager=cat", "diff.external=",
            f"core.attributesFile={os.devnull}", "protocol.allow=never", "gc.auto=0", "maintenance.auto=false",
            "log.showSignature=false", "commit.gpgsign=false", "core.longpaths=true",
        ]
        return [part for pair in pairs for part in ("-c", pair)]

    def _filter_neutralisers(self, cwd: Path) -> list[str]:
        """``-c`` overrides that blank every filter driver the repository's configuration defines."""
        listing = self._execute(["config", "--list", "--null"], cwd, DEFAULT_TIMEOUT_S, None, None)
        if listing.returncode != 0:
            raise WorkspaceError("unsafe_repository", "git could not read this repository's configuration", 409)
        drivers: set[str] = set()
        for entry in listing.stdout.split(b"\0"):
            key = entry.split(b"\n", 1)[0].decode("utf-8", "replace")
            if not key.startswith("filter."):
                continue
            name, _, var = key[len("filter."):].rpartition(".")
            if var not in (*_FILTER_VARS, "required") or not name:
                continue
            if "=" in name or any(ord(ch) < 0x20 for ch in name):
                raise WorkspaceError("unsafe_repository", "the repository defines a filter driver whose name cannot be neutralised", 409)
            drivers.add(name)
        args: list[str] = []
        for name in sorted(drivers):
            for var in _FILTER_VARS:
                args += ["-c", f"filter.{name}.{var}="]
            args += ["-c", f"filter.{name}.required=false"]
        return args

    def _execute(self, args: list[str], cwd: Path, timeout: float, input: bytes | None, env: dict[str, str] | None) -> GitResult:
        argv = [self.git_path, *self._base_config(), "--no-pager", *args]
        try:
            # The single process-spawning call site of the Workspace Manager. argv is a list (no shell), git is an absolute path,
            # the environment is rebuilt from an allowlist, stdin is closed and the call is time-bounded. Expected OpenGrep finding:
            # dangerous-subprocess-use-audit (it flags any subprocess use; the reasons above are why it is controlled).
            done = subprocess.run(argv, cwd=str(cwd), env=self._environment(env), input=input,
                                  stdin=None if input is not None else subprocess.DEVNULL,
                                  capture_output=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired as exc:
            raise WorkspaceError("git_timeout", f"git {args[0]} did not finish within {timeout:g}s", 504) from exc
        except (OSError, ValueError) as exc:
            raise WorkspaceError("git_unavailable", f"git could not be started: {exc}", 503) from exc
        if len(done.stdout) > MAX_STDOUT:
            raise WorkspaceError("git_output_too_large", f"git {args[0]} produced more than {MAX_STDOUT} bytes", 507)
        return GitResult(done.returncode, done.stdout, done.stderr.decode("utf-8", "replace"))

    def run(self, cwd: Path | str, args: list[str], *, timeout: float = DEFAULT_TIMEOUT_S, input: bytes | None = None,
            env: dict[str, str] | None = None, check: bool = True, filters: bool = False) -> GitResult:
        """Run ``git <args>`` in ``cwd``.

        ``filters=True`` is required for any command that reads or writes working-tree content (checkout, status, add): it blanks
        the repository's clean/smudge/process filters first. Pure plumbing on refs and objects does not need it.
        """
        cwd = Path(cwd)
        pre = self._filter_neutralisers(cwd) if filters else []
        if pre:
            args = [*pre, *args]
        done = self._execute(list(args), cwd, timeout, input, env)
        if check and done.returncode != 0:
            raise GitFailure(list(args), done.returncode, done.stderr)
        return done
