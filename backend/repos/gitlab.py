"""GitLab RepoProvider — raw REST via httpx (merge requests)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from repos.base import DiffStat, PullSummary, RepoError
from secrets.base import SecretsStore


class GitLabRepoProvider:
    """GitLab merge-request adapter. Token resolved from ``SecretsStore`` by ref."""

    def __init__(
        self,
        secrets: SecretsStore,
        *,
        token_ref: str = "gitlab/token",
        base_url: str = "https://gitlab.com/api/v4",
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
        return {"PRIVATE-TOKEN": self._token()}

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            transport=self._transport,
            timeout=30.0,
        )

    @staticmethod
    def _project_path(repo: str) -> str:
        return quote(repo, safe="")

    @staticmethod
    def _parse_mr(data: dict[str, Any]) -> PullSummary:
        state = str(data.get("state") or "opened")
        # Normalize GitLab "opened" → "open" for the shared port.
        if state == "opened":
            state = "open"
        return PullSummary(
            number=int(data.get("iid") or data.get("id") or 0),
            title=str(data.get("title") or ""),
            state=state,
            head=str(data.get("source_branch") or ""),
            base=str(data.get("target_branch") or ""),
            url=str(data.get("web_url") or ""),
            body=str(data.get("description") or ""),
        )

    async def list_pulls(self, repo: str, state: str = "open") -> list[PullSummary]:
        gl_state = "opened" if state == "open" else state
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.get(
                f"/projects/{path}/merge_requests",
                params={"state": gl_state},
            )
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"list_pulls HTTP {resp.status_code}")
            return [self._parse_mr(item) for item in resp.json()]

    async def create_pull(
        self,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> PullSummary:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.post(
                f"/projects/{path}/merge_requests",
                json={
                    "title": title,
                    "source_branch": head,
                    "target_branch": base,
                    "description": body,
                },
            )
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"create_pull HTTP {resp.status_code}")
            return self._parse_mr(resp.json())

    async def comment(self, repo: str, number: int, body: str) -> None:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.post(
                f"/projects/{path}/merge_requests/{number}/notes",
                json={"body": body},
            )
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"comment HTTP {resp.status_code}")

    async def get_diff_stat(self, repo: str, number: int) -> DiffStat:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.get(
                f"/projects/{path}/merge_requests/{number}/changes",
            )
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"get_diff_stat HTTP {resp.status_code}")
            data = resp.json()
            changes = data.get("changes") or []
            additions = 0
            deletions = 0
            for change in changes:
                diff = str(change.get("diff") or "")
                for line in diff.splitlines():
                    if line.startswith("+") and not line.startswith("+++"):
                        additions += 1
                    elif line.startswith("-") and not line.startswith("---"):
                        deletions += 1
            return DiffStat(
                additions=additions,
                deletions=deletions,
                changed_files=len(changes),
            )
