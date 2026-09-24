"""Resolve RepoProvider instances from name + env."""

from __future__ import annotations

import os
from typing import Any

from repos.base import RepoProvider
from repos.fake import FakeRepoProvider
from repos.github import GitHubRepoProvider
from repos.gitlab import GitLabRepoProvider
from repos.origin import OriginRepoProvider
from secret_store.base import SecretsStore


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
        "author": pull.author,
        "authorAvatarUrl": pull.author_avatar_url,
        "createdAt": pull.created_at,
        "updatedAt": pull.updated_at,
        "draft": pull.draft,
        "merged": pull.merged,
        "mergeable": pull.mergeable,
        "headSha": pull.head_sha,
    }


def diff_to_dict(stat: Any) -> dict[str, Any]:
    return {
        "additions": stat.additions,
        "deletions": stat.deletions,
        "changedFiles": stat.changed_files,
    }


def comment_to_dict(comment: Any) -> dict[str, Any]:
    return {
        "id": comment.id,
        "author": comment.author,
        "authorAvatarUrl": comment.author_avatar_url,
        "body": comment.body,
        "createdAt": comment.created_at,
    }


def review_to_dict(review: Any) -> dict[str, Any]:
    return {
        "id": review.id,
        "author": review.author,
        "authorAvatarUrl": review.author_avatar_url,
        "state": review.state,
        "submittedAt": review.submitted_at,
    }


def check_to_dict(check: Any) -> dict[str, Any]:
    return {
        "name": check.name,
        "status": check.status,
        "conclusion": check.conclusion,
        "url": check.url,
    }


def commit_to_dict(commit: Any) -> dict[str, Any]:
    return {
        "sha": commit.sha,
        "message": commit.message,
        "author": commit.author,
        "authoredAt": commit.authored_at,
    }
