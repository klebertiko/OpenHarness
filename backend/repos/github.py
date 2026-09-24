"""GitHub RepoProvider — raw REST via httpx (no PyGithub)."""

from __future__ import annotations

from typing import Any

import httpx

from repos.base import CheckRun, Comment, Commit, DiffStat, PullSummary, RepoError, Review
from secret_store.base import SecretsStore

_REVIEW_STATE_MAP = {
    "APPROVED": "approved",
    "CHANGES_REQUESTED": "changes_requested",
    "COMMENTED": "commented",
    "PENDING": "pending",
    "DISMISSED": "dismissed",
}


class GitHubRepoProvider:
    """GitHub pull-request adapter. Token resolved from ``SecretsStore`` by ref."""

    def __init__(
        self,
        secrets: SecretsStore,
        *,
        token_ref: str = "github/token",
        base_url: str = "https://api.github.com",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._secrets = secrets
        self._token_ref = token_ref
        self._base_url = base_url.rstrip("/")
        self._transport = transport

    def _token(self) -> str:
        value = self._secrets.get(self._token_ref)
        if not value:
            raise RepoError("missing_token", f"Secret ref '{self._token_ref}' not found")
        return value

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token()}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            transport=self._transport,
            timeout=30.0,
        )

    @staticmethod
    def _parse_pull(data: dict[str, Any]) -> PullSummary:
        user = data.get("user") or {}
        merged = data["merged"] if "merged" in data else bool(data.get("merged_at"))
        return PullSummary(
            number=int(data["number"]),
            title=str(data.get("title") or ""),
            state=str(data.get("state") or "open"),
            head=str((data.get("head") or {}).get("ref") or ""),
            base=str((data.get("base") or {}).get("ref") or ""),
            url=str(data.get("html_url") or ""),
            body=str(data.get("body") or ""),
            author=str(user.get("login") or ""),
            author_avatar_url=str(user.get("avatar_url") or ""),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
            draft=bool(data.get("draft") or False),
            merged=bool(merged),
            mergeable=data.get("mergeable"),
            head_sha=str((data.get("head") or {}).get("sha") or ""),
        )

    async def list_pulls(self, repo: str, state: str = "open") -> list[PullSummary]:
        async with self._client() as client:
            resp = await client.get(f"/repos/{repo}/pulls", params={"state": state})
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"list_pulls HTTP {resp.status_code}")
            return [self._parse_pull(item) for item in resp.json()]

    async def create_pull(
        self,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> PullSummary:
        async with self._client() as client:
            resp = await client.post(
                f"/repos/{repo}/pulls",
                json={"title": title, "head": head, "base": base, "body": body},
            )
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"create_pull HTTP {resp.status_code}")
            return self._parse_pull(resp.json())

    async def comment(self, repo: str, number: int, body: str) -> None:
        async with self._client() as client:
            resp = await client.post(
                f"/repos/{repo}/issues/{number}/comments",
                json={"body": body},
            )
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"comment HTTP {resp.status_code}")

    async def get_diff_stat(self, repo: str, number: int) -> DiffStat:
        async with self._client() as client:
            resp = await client.get(f"/repos/{repo}/pulls/{number}")
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"get_diff_stat HTTP {resp.status_code}")
            data = resp.json()
            return DiffStat(
                additions=int(data.get("additions") or 0),
                deletions=int(data.get("deletions") or 0),
                changed_files=int(data.get("changed_files") or 0),
            )

    async def get_pull(self, repo: str, number: int) -> PullSummary:
        async with self._client() as client:
            resp = await client.get(f"/repos/{repo}/pulls/{number}")
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"get_pull HTTP {resp.status_code}")
            return self._parse_pull(resp.json())

    async def list_comments(self, repo: str, number: int) -> list[Comment]:
        async with self._client() as client:
            resp = await client.get(f"/repos/{repo}/issues/{number}/comments")
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"list_comments HTTP {resp.status_code}")
            comments: list[Comment] = []
            for item in resp.json():
                user = item.get("user") or {}
                comments.append(
                    Comment(
                        id=int(item.get("id") or 0),
                        author=str(user.get("login") or ""),
                        author_avatar_url=str(user.get("avatar_url") or ""),
                        body=str(item.get("body") or ""),
                        created_at=str(item.get("created_at") or ""),
                    )
                )
            return comments

    async def list_reviews(self, repo: str, number: int) -> list[Review]:
        async with self._client() as client:
            resp = await client.get(f"/repos/{repo}/pulls/{number}/reviews")
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"list_reviews HTTP {resp.status_code}")
            reviews: list[Review] = []
            for item in resp.json():
                user = item.get("user") or {}
                raw_state = str(item.get("state") or "").upper()
                reviews.append(
                    Review(
                        id=int(item.get("id") or 0),
                        author=str(user.get("login") or ""),
                        author_avatar_url=str(user.get("avatar_url") or ""),
                        state=_REVIEW_STATE_MAP.get(raw_state, raw_state.lower()),
                        submitted_at=str(item.get("submitted_at") or ""),
                    )
                )
            return reviews

    async def list_checks(self, repo: str, number: int) -> list[CheckRun]:
        pull = await self.get_pull(repo, number)
        if not pull.head_sha:
            return []
        async with self._client() as client:
            resp = await client.get(f"/repos/{repo}/commits/{pull.head_sha}/check-runs")
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"list_checks HTTP {resp.status_code}")
            data = resp.json()
            checks: list[CheckRun] = []
            for item in data.get("check_runs") or []:
                checks.append(
                    CheckRun(
                        name=str(item.get("name") or ""),
                        status=str(item.get("status") or ""),
                        conclusion=str(item.get("conclusion") or ""),
                        url=str(item.get("html_url") or ""),
                    )
                )
            return checks

    async def list_commits(self, repo: str, number: int) -> list[Commit]:
        async with self._client() as client:
            resp = await client.get(f"/repos/{repo}/pulls/{number}/commits")
            if resp.status_code >= 400:
                raise RepoError("github_api_error", f"list_commits HTTP {resp.status_code}")
            commits: list[Commit] = []
            for item in resp.json():
                commit = item.get("commit") or {}
                author = commit.get("author") or {}
                gh_author = item.get("author") or {}
                commits.append(
                    Commit(
                        sha=str(item.get("sha") or ""),
                        message=str(commit.get("message") or ""),
                        author=str(gh_author.get("login") or author.get("name") or ""),
                        authored_at=str(author.get("date") or ""),
                    )
                )
            return commits
