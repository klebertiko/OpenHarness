"""Repo providers HTTP API — list / create / comment; frontend talks only here."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from automations.pr_watch import stub_pr_watch
from repos.base import RepoError
from repos.factory import build_provider, diff_to_dict, pull_to_dict
from repos.fake import FakeRepoProvider
from secrets.memory import MemorySecrets

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
        pulls = await adapter.list_pulls(repo, state=state)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {"provider": provider, "repo": repo, "pulls": [pull_to_dict(p) for p in pulls]}


@router.post("/{provider}/pulls", status_code=201)
async def create_pull(provider: str, body: CreatePullBody, request: Request) -> dict[str, Any]:
    adapter = _provider(request, provider)
    try:
        pull = await adapter.create_pull(body.repo, body.title, body.head, body.base, body.body)
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
        await adapter.comment(body.repo, number, body.body)
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
        stat = await adapter.get_diff_stat(repo, number)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return {"provider": provider, "number": number, "diff": diff_to_dict(stat)}


@router.post("/{provider}/pr-watch")
async def pr_watch_tick(
    provider: str,
    request: Request,
    repo: str = Query(...),
) -> dict[str, Any]:
    """Optional automation stub: poll open PRs via the provider."""
    adapter = _provider(request, provider)
    try:
        result = await stub_pr_watch(adapter, repo)
    except RepoError as exc:
        raise _http_error(exc) from exc
    return result
