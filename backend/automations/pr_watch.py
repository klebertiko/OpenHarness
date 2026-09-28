"""Optional pr_watch automation stub — poll open PRs/MRs via RepoProvider."""

from __future__ import annotations

from typing import Any

from repos.base import RepoProvider


async def stub_pr_watch(provider: RepoProvider, repo: str) -> dict[str, Any]:
    """Thin poll: list open pulls and return a summary (no Agent enqueue yet)."""
    pulls = await provider.list_pulls(repo, state="open")
    return {
        "ok": True,
        "type": "pr_watch",
        "repo": repo,
        "openCount": len(pulls),
        "numbers": [p.number for p in pulls],
        "titles": [p.title for p in pulls],
    }


def is_pr_watch_job(name: str) -> bool:
    """Jobs named ``pr_watch:...`` or ``pr_watch`` use the stub execute path."""
    lowered = name.strip().lower()
    return lowered == "pr_watch" or lowered.startswith("pr_watch:")
