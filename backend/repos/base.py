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
    author: str = ""
    author_avatar_url: str = ""
    created_at: str = ""
    updated_at: str = ""
    draft: bool = False
    merged: bool = False
    # ``None`` = provider has no opinion yet (e.g. GitHub still computing
    # mergeability) — never coerced to a fake True/False.
    mergeable: bool | None = None
    head_sha: str = ""


@dataclass(frozen=True)
class DiffStat:
    additions: int
    deletions: int
    changed_files: int


@dataclass(frozen=True)
class Comment:
    id: int
    author: str
    author_avatar_url: str
    body: str
    created_at: str


@dataclass(frozen=True)
class Review:
    id: int
    author: str
    author_avatar_url: str
    # approved | changes_requested | commented | pending — only states the
    # source provider actually models; GitLab never emits changes_requested.
    state: str
    submitted_at: str


@dataclass(frozen=True)
class CheckRun:
    name: str
    status: str  # queued | in_progress | completed
    conclusion: str  # success | failure | neutral | cancelled | skipped | ""
    url: str = ""


@dataclass(frozen=True)
class Commit:
    sha: str
    message: str
    author: str
    authored_at: str


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

    async def get_pull(self, repo: str, number: int) -> PullSummary:
        """Fetch a single pull/MR with full metadata (author, draft, merged, ...)."""

    async def list_comments(self, repo: str, number: int) -> list[Comment]:
        """List human/bot comments on pull/MR ``number`` (not review-state notes)."""

    async def list_reviews(self, repo: str, number: int) -> list[Review]:
        """List reviewer states for pull/MR ``number``."""

    async def list_checks(self, repo: str, number: int) -> list[CheckRun]:
        """List CI check runs for the pull/MR's current head."""

    async def list_commits(self, repo: str, number: int) -> list[Commit]:
        """List commits included in pull/MR ``number``."""
