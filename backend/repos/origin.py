"""Cursor Origin RepoProvider — unsupported on native Windows; CLI wrap elsewhere."""

from __future__ import annotations

import os
import shutil
import sys
from typing import Callable

from repos.base import CheckRun, Comment, Commit, DiffStat, PullSummary, RepoError, Review

PlatformFn = Callable[[], str]
IsWslFn = Callable[[], bool]


def _default_platform() -> str:
    return sys.platform


def _default_is_wsl() -> bool:
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        with open("/proc/version", encoding="utf-8") as fh:
            return "microsoft" in fh.read().lower()
    except OSError:
        return False


class OriginRepoProvider:
    """Origin adapter. Native Windows raises ``origin_unsupported_platform``."""

    def __init__(
        self,
        *,
        platform_fn: PlatformFn | None = None,
        is_wsl_fn: IsWslFn | None = None,
        which_fn: Callable[[str], str | None] | None = None,
    ) -> None:
        self._platform = platform_fn or _default_platform
        self._is_wsl = is_wsl_fn or _default_is_wsl
        self._which = which_fn or shutil.which

    def _ensure_supported(self) -> None:
        if self._platform() == "win32" and not self._is_wsl():
            raise RepoError(
                "origin_unsupported_platform",
                "Cursor Origin is not supported on native Windows (use macOS, Linux, or WSL).",
            )

    def _ensure_cli(self) -> str:
        path = self._which("origin")
        if not path:
            home = os.path.expanduser("~/.local/bin/origin")
            if os.path.isfile(home) and os.access(home, os.X_OK):
                return home
            raise RepoError(
                "origin_cli_missing",
                "origin CLI not found; install via https://downloads.cursor.com/origin/install.sh",
            )
        return path

    async def list_pulls(self, repo: str, state: str = "open") -> list[PullSummary]:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin PR list for {repo!r} is not wired yet (CLI present).",
        )

    async def create_pull(
        self,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> PullSummary:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin create_pull for {repo!r} is not wired yet (CLI present).",
        )

    async def comment(self, repo: str, number: int, body: str) -> None:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin comment on {repo}#{number} is not wired yet (CLI present).",
        )

    async def get_diff_stat(self, repo: str, number: int) -> DiffStat:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin diff stat for {repo}#{number} is not wired yet (CLI present).",
        )

    async def get_pull(self, repo: str, number: int) -> PullSummary:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin pull detail for {repo}#{number} is not wired yet (CLI present).",
        )

    async def list_comments(self, repo: str, number: int) -> list[Comment]:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin comments for {repo}#{number} are not wired yet (CLI present).",
        )

    async def list_reviews(self, repo: str, number: int) -> list[Review]:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin reviews for {repo}#{number} are not wired yet (CLI present).",
        )

    async def list_checks(self, repo: str, number: int) -> list[CheckRun]:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin checks for {repo}#{number} are not wired yet (CLI present).",
        )

    async def list_commits(self, repo: str, number: int) -> list[Commit]:
        self._ensure_supported()
        self._ensure_cli()
        raise RepoError(
            "origin_not_implemented",
            f"Origin commits for {repo}#{number} are not wired yet (CLI present).",
        )
