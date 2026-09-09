"""GitHub + GitLab adapters — httpx MockTransport fixtures; tokens via SecretsStore."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from repos.base import RepoError
from repos.github import GitHubRepoProvider
from repos.gitlab import GitLabRepoProvider
from secrets.memory import MemorySecrets

GH_TOKEN = "ghp_TEST_TOKEN_NEVER_LEAK"
GL_TOKEN = "glpat-TEST_TOKEN_NEVER_LEAK"


def _github_handler(request: httpx.Request) -> httpx.Response:
    auth = request.headers.get("Authorization", "")
    assert auth == f"Bearer {GH_TOKEN}", "token must come from SecretsStore"
    path = request.url.path
    if request.method == "GET" and path == "/repos/acme/app/pulls":
        return httpx.Response(
            200,
            json=[
                {
                    "number": 7,
                    "title": "Fix login",
                    "state": "open",
                    "html_url": "https://github.com/acme/app/pull/7",
                    "body": "details",
                    "head": {"ref": "fix/login"},
                    "base": {"ref": "main"},
                }
            ],
        )
    if request.method == "POST" and path == "/repos/acme/app/pulls":
        body = json.loads(request.content.decode())
        return httpx.Response(
            201,
            json={
                "number": 8,
                "title": body["title"],
                "state": "open",
                "html_url": "https://github.com/acme/app/pull/8",
                "body": body.get("body", ""),
                "head": {"ref": body["head"]},
                "base": {"ref": body["base"]},
            },
        )
    if request.method == "POST" and path == "/repos/acme/app/issues/7/comments":
        body = json.loads(request.content.decode())
        assert body["body"] == "ship it"
        return httpx.Response(201, json={"id": 1, "body": body["body"]})
    if request.method == "GET" and path == "/repos/acme/app/pulls/7":
        return httpx.Response(
            200,
            json={
                "number": 7,
                "additions": 12,
                "deletions": 3,
                "changed_files": 2,
            },
        )
    return httpx.Response(404, json={"message": "not found"})


def _gitlab_handler(request: httpx.Request) -> httpx.Response:
    assert request.headers.get("PRIVATE-TOKEN") == GL_TOKEN
    # httpx decodes %2F in .path; match on raw_path which keeps acme%2Fapp.
    raw = request.url.raw_path.decode().split("?", 1)[0]
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/merge_requests"):
        return httpx.Response(
            200,
            json=[
                {
                    "iid": 3,
                    "title": "Add CI",
                    "state": "opened",
                    "web_url": "https://gitlab.com/acme/app/-/merge_requests/3",
                    "description": "mr body",
                    "source_branch": "ci",
                    "target_branch": "main",
                }
            ],
        )
    if request.method == "POST" and raw.endswith("/projects/acme%2Fapp/merge_requests"):
        body = json.loads(request.content.decode())
        return httpx.Response(
            201,
            json={
                "iid": 4,
                "title": body["title"],
                "state": "opened",
                "web_url": "https://gitlab.com/acme/app/-/merge_requests/4",
                "description": body.get("description", ""),
                "source_branch": body["source_branch"],
                "target_branch": body["target_branch"],
            },
        )
    if request.method == "POST" and raw.endswith("/projects/acme%2Fapp/merge_requests/3/notes"):
        body = json.loads(request.content.decode())
        assert body["body"] == "looks good"
        return httpx.Response(201, json={"id": 9, "body": body["body"]})
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/merge_requests/3/changes"):
        return httpx.Response(
            200,
            json={
                "changes": [
                    {"diff": "@@ -1 +1 @@\n-old\n+new\n"},
                    {"diff": "@@ -1 +1,2 @@\n line\n+extra\n"},
                ]
            },
        )
    return httpx.Response(404, json={"message": "not found"})


def test_github_list_create_comment_diff_uses_secret_ref() -> None:
    async def exercise() -> None:
        store = MemorySecrets()
        store.put("github/token", GH_TOKEN)
        provider = GitHubRepoProvider(
            store,
            token_ref="github/token",
            transport=httpx.MockTransport(_github_handler),
        )

        pulls = await provider.list_pulls("acme/app")
        assert len(pulls) == 1
        assert pulls[0].number == 7
        assert pulls[0].head == "fix/login"

        created = await provider.create_pull(
            "acme/app",
            title="New feature",
            head="feat",
            base="main",
            body="desc",
        )
        assert created.number == 8
        assert created.title == "New feature"

        await provider.comment("acme/app", 7, "ship it")
        stat = await provider.get_diff_stat("acme/app", 7)
        assert stat.additions == 12
        assert stat.deletions == 3
        assert stat.changed_files == 2

    asyncio.run(exercise())


def test_github_missing_token_raises() -> None:
    async def exercise() -> None:
        provider = GitHubRepoProvider(MemorySecrets(), token_ref="github/token")
        with pytest.raises(RepoError) as exc:
            await provider.list_pulls("acme/app")
        assert exc.value.code == "missing_token"

    asyncio.run(exercise())


def test_gitlab_list_create_comment_diff_uses_secret_ref() -> None:
    async def exercise() -> None:
        store = MemorySecrets()
        store.put("gitlab/token", GL_TOKEN)
        provider = GitLabRepoProvider(
            store,
            token_ref="gitlab/token",
            transport=httpx.MockTransport(_gitlab_handler),
        )

        pulls = await provider.list_pulls("acme/app")
        assert len(pulls) == 1
        assert pulls[0].number == 3
        assert pulls[0].state == "open"
        assert pulls[0].head == "ci"

        created = await provider.create_pull(
            "acme/app",
            title="Docs",
            head="docs",
            base="main",
            body="update readme",
        )
        assert created.number == 4

        await provider.comment("acme/app", 3, "looks good")
        stat = await provider.get_diff_stat("acme/app", 3)
        assert stat.changed_files == 2
        assert stat.additions >= 1
        assert stat.deletions >= 1

    asyncio.run(exercise())


def test_gitlab_missing_token_raises() -> None:
    async def exercise() -> None:
        provider = GitLabRepoProvider(MemorySecrets(), token_ref="gitlab/token")
        with pytest.raises(RepoError) as exc:
            await provider.list_pulls("acme/app")
        assert exc.value.code == "missing_token"

    asyncio.run(exercise())
