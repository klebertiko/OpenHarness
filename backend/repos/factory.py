"""Resolve RepoProvider instances from name + env."""

from __future__ import annotations

import os
from typing import Any

from repos.base import RepoProvider
from repos.fake import FakeRepoProvider
from repos.github import GitHubRepoProvider
from repos.gitlab import GitLabRepoProvider
from repos.origin import OriginRepoProvider
from secrets.base import SecretsStore


def default_provider_name() -> str:
    return (os.environ.get("REPO_PROVIDER") or "fake").strip().lower()


def build_provider(
    name: str,
    *,
    secrets: SecretsStore,
    fake: FakeRepoProvider | None = None,
) -> RepoProvider:
    """Map provider id to adapter. ``fake`` reuses a shared in-memory instance."""
    key = name.strip().lower()
    # Dev override: REPO_PROVIDER=fake forces Fake regardless of path (except origin tests).
    env = default_provider_name()
    if env == "fake" and key in {"fake", "github", "gitlab"}:
        # Still allow explicit origin so Windows error is reachable in API tests.
        if key != "origin":
            return fake if fake is not None else FakeRepoProvider()

    if key == "fake":
        return fake if fake is not None else FakeRepoProvider()
    if key == "github":
        return GitHubRepoProvider(secrets, token_ref="github/token")
    if key == "gitlab":
        return GitLabRepoProvider(secrets, token_ref="gitlab/token")
    if key == "origin":
        return OriginRepoProvider()
    raise KeyError(key)


def pull_to_dict(pull: Any) -> dict[str, Any]:
    return {
        "number": pull.number,
        "title": pull.title,
        "state": pull.state,
        "head": pull.head,
        "base": pull.base,
        "url": pull.url,
        "body": pull.body,
    }


def diff_to_dict(stat: Any) -> dict[str, Any]:
    return {
        "additions": stat.additions,
        "deletions": stat.deletions,
        "changedFiles": stat.changed_files,
    }
