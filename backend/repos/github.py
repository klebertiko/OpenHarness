"""GitHub RepoProvider — raw REST via httpx (no PyGithub)."""

from __future__ import annotations

from typing import Any

import httpx

from repos.base import DiffStat, PullSummary, RepoError
from secrets.base import SecretsStore


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
        return PullSummary(
            number=int(data["number"]),
            title=str(data.get("title") or ""),
            state=str(data.get("state") or "open"),
            head=str((data.get("head") or {}).get("ref") or ""),
            base=str((data.get("base") or {}).get("ref") or ""),
            url=str(data.get("html_url") or ""),
            body=str(data.get("body") or ""),
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
