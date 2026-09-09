"""RepoProvider protocol — provider-agnostic Git/PR (MR) flows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class PullSummary:
    number: int
    title: str
    state: str
    head: str
    base: str
    url: str = ""
    body: str = ""


@dataclass(frozen=True)
class DiffStat:
    additions: int
    deletions: int
    changed_files: int


class RepoError(Exception):
    """Structured repo-provider failure with a machine-readable ``code``."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@runtime_checkable
class RepoProvider(Protocol):
    async def list_pulls(self, repo: str, state: str = "open") -> list[PullSummary]:
        """List pull/merge requests for ``repo`` (``owner/name``)."""

    async def create_pull(
        self,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> PullSummary:
        """Open a pull/merge request."""

    async def comment(self, repo: str, number: int, body: str) -> None:
        """Post a review comment on pull/MR ``number``."""

    async def get_diff_stat(self, repo: str, number: int) -> DiffStat:
        """Return additions / deletions / changed-file counts for a PR/MR."""
