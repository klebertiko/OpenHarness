"""Repo providers HTTP API — list / create / comment; frontend talks only here."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from automations.pr_watch import stub_pr_watch
from repos.base import RepoError
from repos.factory import (
    build_provider,
    check_to_dict,
    comment_to_dict,
    commit_to_dict,
    diff_to_dict,
    pull_to_dict,
    review_to_dict,
)
from repos.fake import FakeRepoProvider
from secret_store.memory import MemorySecrets

router = APIRouter(prefix="/repos", tags=["repos"])


class CreatePullBody(BaseModel):
    repo: str
    title: str
    head: str
    base: str
    body: str = ""


class CommentBody(BaseModel):
    repo: str
    body: str


def _secrets(request: Request):
    store = getattr(request.app.state, "secrets_store", None)
    return store if store is not None else MemorySecrets()


def _fake(request: Request) -> FakeRepoProvider:
    fake = getattr(request.app.state, "fake_repo_provider", None)
    if fake is None:
        fake = FakeRepoProvider()
        request.app.state.fake_repo_provider = fake
    return fake


def _provider(request: Request, provider: str):
    try:
        return build_provider(provider, secrets=_secrets(request), fake=_fake(request))
    except KeyError:
        raise HTTPException(404, f"Unknown provider: {provider}") from None


_REPO_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _validate_repo(repo: str) -> str:
    """``repo`` reaches GitHubRepoProvider/GitLabRepoProvider as a raw
    f-string path segment (``f"/repos/{repo}/pulls"``,
    ``f"/projects/{quote(repo)}/merge_requests"``) with the app's own stored
    provider token attached. Security review 2026-09-26 (CodeQL
    py/partial-ssrf, 19 findings): an unvalidated ``repo`` containing a
    ``..`` segment lets any caller holding the sidecar's own bearer token
    redirect that stored token at an arbitrary GitHub/GitLab API endpoint
    instead of the intended repo — a confused-deputy path injection, not a
    remote-host SSRF (the sidecar token + CORS allowlist already block
    that). Validated once, here, before any adapter is touched — GitHub
    identifiers are exactly two segments, GitLab namespaces nest arbitrarily
    deep, so this accepts >=2 clean segments rather than special-casing
    either provider.
    """
    segments = repo.split("/")
    if len(segments) < 2 or any(
        not _REPO_SEGMENT_RE.match(s) or s in (".", "..") for s in segments
    ):
        raise RepoError("invalid_repo", "repo must look like 'owner/name' (or a GitLab namespace path)")
    return repo


def _http_error(exc: RepoError) -> HTTPException:
    status = 501 if exc.code.endswith("unsupported_platform") or exc.code.endswith(
        "not_implemented"
    ) else 400
    if exc.code == "pull_not_found":
        status = 404
    if exc.code == "missing_token":
        status = 401
    return HTTPException(status_code=status, detail=exc.to_dict())


@router.get("/{provider}/pulls")
async def list_pulls(
    provider: str,
    request: Request,
    repo: str = Query(..., description="owner/name"),
    state: str = Query("open"),
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        pulls = await adapter.list_pulls(repo, state=state)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {"provider": provider, "repo": repo, "pulls": [pull_to_dict(p) for p in pulls]}


@router.post("/{provider}/pulls", status_code=201)
async def create_pull(provider: str, body: CreatePullBody, request: Request) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(body.repo)
        pull = await adapter.create_pull(repo, body.title, body.head, body.base, body.body)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {"provider": provider, "pull": pull_to_dict(pull)}


@router.post("/{provider}/pulls/{number}/comments", status_code=201)
async def comment_pull(
    provider: str,
    number: int,
    body: CommentBody,
    request: Request,
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(body.repo)
        await adapter.comment(repo, number, body.body)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {"ok": True, "provider": provider, "number": number}


@router.get("/{provider}/pulls/{number}/diff")
async def pull_diff(
    provider: str,
    number: int,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        stat = await adapter.get_diff_stat(repo, number)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {"provider": provider, "number": number, "diff": diff_to_dict(stat)}


@router.get("/{provider}/pulls/{number}")
async def get_pull(
    provider: str,
    number: int,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        pull = await adapter.get_pull(repo, number)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {"provider": provider, "pull": pull_to_dict(pull)}


@router.get("/{provider}/pulls/{number}/comments")
async def list_comments(
    provider: str,
    number: int,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        comments = await adapter.list_comments(repo, number)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {
        "provider": provider,
        "number": number,
        "comments": [comment_to_dict(c) for c in comments],
    }


@router.get("/{provider}/pulls/{number}/reviews")
async def list_reviews(
    provider: str,
    number: int,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        reviews = await adapter.list_reviews(repo, number)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {
        "provider": provider,
        "number": number,
        "reviews": [review_to_dict(r) for r in reviews],
    }


@router.get("/{provider}/pulls/{number}/checks")
async def list_checks(
    provider: str,
    number: int,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        checks = await adapter.list_checks(repo, number)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {
        "provider": provider,
        "number": number,
        "checks": [check_to_dict(c) for c in checks],
    }


@router.get("/{provider}/pulls/{number}/commits")
async def list_commits(
    provider: str,
    number: int,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        commits = await adapter.list_commits(repo, number)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {
        "provider": provider,
        "number": number,
        "commits": [commit_to_dict(c) for c in commits],
    }


@router.post("/{provider}/pr-watch")
async def pr_watch_tick(
    provider: str,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    """Optional automation stub: poll open PRs via the provider."""
    adapter = _provider(request, provider)
    try:
        repo = _validate_repo(repo)
        result = await stub_pr_watch(adapter, repo)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return result
