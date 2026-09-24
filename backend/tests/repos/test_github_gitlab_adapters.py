"""GitHub + GitLab adapters — httpx MockTransport fixtures; tokens via SecretsStore."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from repos.base import RepoError
from repos.github import GitHubRepoProvider
from repos.gitlab import GitLabRepoProvider
from secret_store.memory import MemorySecrets

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
                "title": "Fix login",
                "state": "open",
                "html_url": "https://github.com/acme/app/pull/7",
                "body": "details",
                "head": {"ref": "fix/login", "sha": "deadbeef"},
                "base": {"ref": "main"},
                "additions": 12,
                "deletions": 3,
                "changed_files": 2,
                "user": {"login": "klebertiko", "avatar_url": "https://gh/a.png"},
                "created_at": "2026-09-01T00:00:00Z",
                "updated_at": "2026-09-02T00:00:00Z",
                "draft": False,
                "merged": False,
                "mergeable": True,
            },
        )
    if request.method == "GET" and path == "/repos/acme/app/issues/7/comments":
        return httpx.Response(
            200,
            json=[
                {
                    "id": 55,
                    "user": {"login": "bot", "avatar_url": "https://gh/bot.png"},
                    "body": "CI started",
                    "created_at": "2026-09-01T01:00:00Z",
                }
            ],
        )
    if request.method == "GET" and path == "/repos/acme/app/pulls/7/reviews":
        return httpx.Response(
            200,
            json=[
                {
                    "id": 3,
                    "user": {"login": "rev1", "avatar_url": ""},
                    "state": "CHANGES_REQUESTED",
                    "submitted_at": "2026-09-01T02:00:00Z",
                }
            ],
        )
    if request.method == "GET" and path == "/repos/acme/app/commits/deadbeef/check-runs":
        return httpx.Response(
            200,
            json={
                "check_runs": [
                    {
                        "name": "build",
                        "status": "completed",
                        "conclusion": "failure",
                        "html_url": "https://gh/checks/1",
                    }
                ]
            },
        )
    if request.method == "GET" and path == "/repos/acme/app/pulls/7/commits":
        return httpx.Response(
            200,
            json=[
                {
                    "sha": "deadbeef",
                    "commit": {
                        "message": "Fix login bug",
                        "author": {"name": "klebertiko", "date": "2026-09-01T00:00:00Z"},
                    },
                    "author": {"login": "klebertiko"},
                }
            ],
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
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/merge_requests/3"):
        return httpx.Response(
            200,
            json={
                "iid": 3,
                "title": "Add CI",
                "state": "opened",
                "web_url": "https://gitlab.com/acme/app/-/merge_requests/3",
                "description": "mr body",
                "source_branch": "ci",
                "target_branch": "main",
                "author": {"username": "klebertiko", "avatar_url": "https://gl/a.png"},
                "created_at": "2026-09-01T00:00:00Z",
                "updated_at": "2026-09-02T00:00:00Z",
                "draft": False,
                "merge_status": "can_be_merged",
                "sha": "cafebabe",
            },
        )
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/merge_requests/3/notes"):
        return httpx.Response(
            200,
            json=[
                {
                    "id": 11,
                    "author": {"username": "reviewer2", "avatar_url": ""},
                    "body": "nice work",
                    "created_at": "2026-09-01T03:00:00Z",
                    "system": False,
                },
                {
                    "id": 12,
                    "author": {"username": "gitlab-bot", "avatar_url": ""},
                    "body": "changed target branch",
                    "created_at": "2026-09-01T03:05:00Z",
                    "system": True,
                },
            ],
        )
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/merge_requests/3/approvals"):
        return httpx.Response(
            200,
            json={
                "approved_by": [
                    {"user": {"id": 42, "username": "approver1", "avatar_url": "https://gl/b.png"}}
                ]
            },
        )
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/merge_requests/3/pipelines"):
        return httpx.Response(200, json=[{"id": 900, "status": "failed"}])
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/pipelines/900/jobs"):
        return httpx.Response(
            200,
            json=[
                {"name": "test", "status": "failed", "web_url": "https://gl/jobs/1"},
                {"name": "build", "status": "success", "web_url": "https://gl/jobs/2"},
            ],
        )
    if request.method == "GET" and raw.endswith("/projects/acme%2Fapp/merge_requests/3/commits"):
        return httpx.Response(
            200,
            json=[
                {
                    "id": "cafebabe",
                    "message": "Add CI config",
                    "author_name": "klebertiko",
                    "authored_date": "2026-09-01T00:00:00Z",
                }
            ],
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


def test_github_detail_endpoints_enrich_pull() -> None:
    async def exercise() -> None:
        store = MemorySecrets()
        store.put("github/token", GH_TOKEN)
        provider = GitHubRepoProvider(
            store,
            token_ref="github/token",
            transport=httpx.MockTransport(_github_handler),
        )

        pull = await provider.get_pull("acme/app", 7)
        assert pull.author == "klebertiko"
        assert pull.author_avatar_url == "https://gh/a.png"
        assert pull.draft is False
        assert pull.merged is False
        assert pull.mergeable is True
        assert pull.head_sha == "deadbeef"

        comments = await provider.list_comments("acme/app", 7)
        assert comments[0].author == "bot"
        assert comments[0].body == "CI started"

        reviews = await provider.list_reviews("acme/app", 7)
        assert reviews[0].author == "rev1"
        assert reviews[0].state == "changes_requested"

        checks = await provider.list_checks("acme/app", 7)
        assert checks[0].name == "build"
        assert checks[0].conclusion == "failure"

        commits = await provider.list_commits("acme/app", 7)
        assert commits[0].sha == "deadbeef"
        assert commits[0].author == "klebertiko"
        assert commits[0].message == "Fix login bug"

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


def test_gitlab_detail_endpoints_enrich_mr() -> None:
    async def exercise() -> None:
        store = MemorySecrets()
        store.put("gitlab/token", GL_TOKEN)
        provider = GitLabRepoProvider(
            store,
            token_ref="gitlab/token",
            transport=httpx.MockTransport(_gitlab_handler),
        )

        pull = await provider.get_pull("acme/app", 3)
        assert pull.author == "klebertiko"
        assert pull.mergeable is True
        assert pull.head_sha == "cafebabe"

        comments = await provider.list_comments("acme/app", 3)
        # System notes ("changed target branch") are excluded — not real comments.
        assert len(comments) == 1
        assert comments[0].author == "reviewer2"

        reviews = await provider.list_reviews("acme/app", 3)
        assert reviews[0].author == "approver1"
        assert reviews[0].state == "approved"

        checks = await provider.list_checks("acme/app", 3)
        names = {c.name: c.conclusion for c in checks}
        assert names == {"test": "failure", "build": "success"}

        commits = await provider.list_commits("acme/app", 3)
        assert commits[0].sha == "cafebabe"
        assert commits[0].author == "klebertiko"

    asyncio.run(exercise())


def test_gitlab_missing_token_raises() -> None:
    async def exercise() -> None:
        provider = GitLabRepoProvider(MemorySecrets(), token_ref="gitlab/token")
        with pytest.raises(RepoError) as exc:
            await provider.list_pulls("acme/app")
        assert exc.value.code == "missing_token"

    asyncio.run(exercise())
