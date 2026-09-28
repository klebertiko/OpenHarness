"""RepoProvider port and adapters (GitHub / GitLab / Origin / Fake)."""

from .base import DiffStat, PullSummary, RepoError, RepoProvider

__all__ = [
    "DiffStat",
    "PullSummary",
    "RepoError",
    "RepoProvider",
]
