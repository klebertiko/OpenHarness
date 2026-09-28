"""GitLab RepoProvider — raw REST via httpx (merge requests).

GitLab's review model is simpler than GitHub's: there is no native
"changes requested" review state, only approvals. ``list_reviews`` here only
ever returns ``state="approved"`` entries — that is the honest shape of what
GitLab's Approvals API models, not a gap papered over with a fake value.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from repos.base import CheckRun, Comment, Commit, DiffStat, PullSummary, RepoError, Review
from secret_store.base import SecretsStore

_MERGE_STATUS_MAP = {
    "can_be_merged": True,
    "cannot_be_merged": False,
    "cannot_be_merged_recheck": False,
}

_JOB_STATUS_MAP = {
    # GitLab job status -> (CheckRun.status, CheckRun.conclusion)
    "created": ("queued", ""),
    "pending": ("queued", ""),
    "waiting_for_resource": ("queued", ""),
    "manual": ("queued", ""),
    "scheduled": ("queued", ""),
    "running": ("in_progress", ""),
    "success": ("completed", "success"),
    "failed": ("completed", "failure"),
    "canceled": ("completed", "cancelled"),
    "canceling": ("in_progress", ""),
    "skipped": ("completed", "skipped"),
}


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
        author = data.get("author") or {}
        draft = data.get("draft")
        if draft is None:
            draft = data.get("work_in_progress")
        return PullSummary(
            number=int(data.get("iid") or data.get("id") or 0),
            title=str(data.get("title") or ""),
            state=state,
            head=str(data.get("source_branch") or ""),
            base=str(data.get("target_branch") or ""),
            url=str(data.get("web_url") or ""),
            body=str(data.get("description") or ""),
            author=str(author.get("username") or ""),
            author_avatar_url=str(author.get("avatar_url") or ""),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
            draft=bool(draft or False),
            merged=state == "merged",
            mergeable=_MERGE_STATUS_MAP.get(str(data.get("merge_status") or "")),
            head_sha=str(data.get("sha") or ""),
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

    async def get_pull(self, repo: str, number: int) -> PullSummary:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.get(f"/projects/{path}/merge_requests/{number}")
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"get_pull HTTP {resp.status_code}")
            return self._parse_mr(resp.json())

    async def list_comments(self, repo: str, number: int) -> list[Comment]:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.get(f"/projects/{path}/merge_requests/{number}/notes")
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"list_comments HTTP {resp.status_code}")
            comments: list[Comment] = []
            for item in resp.json():
                if item.get("system"):
                    continue  # system notes are timeline events, not comments
                author = item.get("author") or {}
                comments.append(
                    Comment(
                        id=int(item.get("id") or 0),
                        author=str(author.get("username") or ""),
                        author_avatar_url=str(author.get("avatar_url") or ""),
                        body=str(item.get("body") or ""),
                        created_at=str(item.get("created_at") or ""),
                    )
                )
            return comments

    async def list_reviews(self, repo: str, number: int) -> list[Review]:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.get(f"/projects/{path}/merge_requests/{number}/approvals")
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"list_reviews HTTP {resp.status_code}")
            data = resp.json()
            reviews: list[Review] = []
            for entry in data.get("approved_by") or []:
                user = entry.get("user") or {}
                reviews.append(
                    Review(
                        id=int(user.get("id") or 0),
                        author=str(user.get("username") or ""),
                        author_avatar_url=str(user.get("avatar_url") or ""),
                        state="approved",
                        submitted_at="",
                    )
                )
            return reviews

    async def list_checks(self, repo: str, number: int) -> list[CheckRun]:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.get(f"/projects/{path}/merge_requests/{number}/pipelines")
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"list_checks HTTP {resp.status_code}")
            pipelines = resp.json()
            if not pipelines:
                return []
            pipeline_id = pipelines[0].get("id")
            jobs_resp = await client.get(f"/projects/{path}/pipelines/{pipeline_id}/jobs")
            if jobs_resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"list_checks HTTP {jobs_resp.status_code}")
            checks: list[CheckRun] = []
            for job in jobs_resp.json():
                status, conclusion = _JOB_STATUS_MAP.get(str(job.get("status") or ""), ("queued", ""))
                checks.append(
                    CheckRun(
                        name=str(job.get("name") or ""),
                        status=status,
                        conclusion=conclusion,
                        url=str(job.get("web_url") or ""),
                    )
                )
            return checks

    async def list_commits(self, repo: str, number: int) -> list[Commit]:
        path = self._project_path(repo)
        async with self._client() as client:
            resp = await client.get(f"/projects/{path}/merge_requests/{number}/commits")
            if resp.status_code >= 400:
                raise RepoError("gitlab_api_error", f"list_commits HTTP {resp.status_code}")
            commits: list[Commit] = []
            for item in resp.json():
                commits.append(
                    Commit(
                        sha=str(item.get("id") or ""),
                        message=str(item.get("message") or ""),
                        author=str(item.get("author_name") or ""),
                        authored_at=str(item.get("authored_date") or ""),
                    )
                )
            return commits
