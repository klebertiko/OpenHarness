"""Repos API — list/create/comment against Fake in REPO_PROVIDER=fake mode."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from main import app
from repos.base import DiffStat, PullSummary
from repos.fake import FakeRepoProvider
from secret_store.memory import MemorySecrets


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REPO_PROVIDER", "fake")
    store = MemorySecrets()
    fake = FakeRepoProvider()
    fake.seed_pull(
        "acme/app",
        PullSummary(
            number=1,
            title="Seeded PR",
            state="open",
            head="feat",
            base="main",
            url="fake://acme/app/pull/1",
            body="",
        ),
        diff=DiffStat(additions=5, deletions=1, changed_files=2),
    )
    app.state.secrets_store = store
    app.state.fake_repo_provider = fake
    with TestClient(app) as c:
        app.state.secrets_store = store
        app.state.fake_repo_provider = fake
        yield c


def test_list_create_comment_via_fake(client: TestClient) -> None:
    listed = client.get("/repos/fake/pulls", params={"repo": "acme/app"})
    assert listed.status_code == 200
    body = listed.json()
    assert body["provider"] == "fake"
    assert len(body["pulls"]) == 1
    assert body["pulls"][0]["title"] == "Seeded PR"

    created = client.post(
        "/repos/fake/pulls",
        json={
            "repo": "acme/app",
            "title": "New",
            "head": "x",
            "base": "main",
            "body": "hi",
        },
    )
    assert created.status_code == 201
    assert created.json()["pull"]["number"] == 2

    commented = client.post(
        "/repos/fake/pulls/2/comments",
        json={"repo": "acme/app", "body": "LGTM"},
    )
    assert commented.status_code == 201
    assert commented.json()["ok"] is True

    diff = client.get("/repos/fake/pulls/1/diff", params={"repo": "acme/app"})
    assert diff.status_code == 200
    assert diff.json()["diff"]["changedFiles"] == 2


def test_get_pull_comments_reviews_checks_commits_via_fake(client: TestClient) -> None:
    detail = client.get("/repos/fake/pulls/1", params={"repo": "acme/app"})
    assert detail.status_code == 200
    pull = detail.json()["pull"]
    assert pull["number"] == 1
    assert pull["title"] == "Seeded PR"
    assert "author" in pull and "mergeable" in pull and "headSha" in pull

    comments = client.get("/repos/fake/pulls/1/comments", params={"repo": "acme/app"})
    assert comments.status_code == 200
    assert comments.json()["comments"] == []

    reviews = client.get("/repos/fake/pulls/1/reviews", params={"repo": "acme/app"})
    assert reviews.status_code == 200
    assert reviews.json()["reviews"] == []

    checks = client.get("/repos/fake/pulls/1/checks", params={"repo": "acme/app"})
    assert checks.status_code == 200
    assert checks.json()["checks"] == []

    commits = client.get("/repos/fake/pulls/1/commits", params={"repo": "acme/app"})
    assert commits.status_code == 200
    assert commits.json()["commits"] == []


def test_get_pull_missing_returns_404(client: TestClient) -> None:
    r = client.get("/repos/fake/pulls/999", params={"repo": "acme/app"})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "pull_not_found"


def test_pr_watch_stub(client: TestClient) -> None:
    r = client.post("/repos/fake/pr-watch", params={"repo": "acme/app"})
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "pr_watch"
    assert data["openCount"] >= 1


def test_origin_unsupported_on_windows(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # Force native Windows path even if env says fake — origin bypasses fake override.
    monkeypatch.setenv("REPO_PROVIDER", "github")
    from repos import origin as origin_mod

    monkeypatch.setattr(origin_mod, "_default_platform", lambda: "win32")
    monkeypatch.setattr(origin_mod, "_default_is_wsl", lambda: False)

    r = client.get("/repos/origin/pulls", params={"repo": "acme/app"})
    assert r.status_code == 501
    detail = r.json()["detail"]
    assert detail["code"] == "origin_unsupported_platform"


def test_repo_provider_env_defaults_to_fake() -> None:
    os.environ.pop("REPO_PROVIDER", None)
    from repos.factory import default_provider_name

    assert default_provider_name() == "fake"
    os.environ["REPO_PROVIDER"] = "fake"
    assert default_provider_name() == "fake"


# ── repo format validation (CodeQL py/partial-ssrf, Security review 2026-09-26) ─
#
# `repo` used to reach GitHubRepoProvider/GitLabRepoProvider as a raw,
# unvalidated f-string path segment (`f"/repos/{repo}/pulls"`,
# `f"/projects/{quote(repo)}/merge_requests"`). A `repo` containing `../`
# segments lets the caller redirect the app's own stored provider token at an
# arbitrary GitHub/GitLab API endpoint instead of the intended repo — a
# confused-deputy path injection reachable from anything holding the
# sidecar's bearer token, not just the app's own UI. Every endpoint below
# takes `repo` from the same untrusted boundary (query or body), so one
# malformed value is enough to prove the class; the fix validates centrally
# in routers/repos.py, before any adapter is touched.


@pytest.mark.parametrize(
    "repo",
    [
        "../orgs/acme/members",
        "acme/../../rate_limit",
        "acme/app/../../../user",
        "/acme/app",
        "acme/app/",
        "acme//app",
        "acme",
        "",
        "acme/.",
        "acme/..",
    ],
)
def test_malformed_repo_is_rejected_before_reaching_any_adapter(client: TestClient, repo: str) -> None:
    r = client.get("/repos/fake/pulls", params={"repo": repo})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "invalid_repo"


def test_malformed_repo_rejected_on_create_pull_body_too(client: TestClient) -> None:
    r = client.post(
        "/repos/fake/pulls",
        json={"repo": "../orgs/acme/members", "title": "x", "head": "a", "base": "main", "body": ""},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "invalid_repo"


def test_malformed_repo_rejected_on_comment_body_too(client: TestClient) -> None:
    r = client.post(
        "/repos/fake/pulls/1/comments",
        json={"repo": "../orgs/acme/members", "body": "hi"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "invalid_repo"


def test_nested_gitlab_style_namespace_is_still_accepted(client: TestClient) -> None:
    # GitLab subgroups nest arbitrarily deep — validation must not reduce to
    # GitHub's exactly-two-segments shape.
    r = client.get("/repos/fake/pulls", params={"repo": "group/subgroup/project"})
    assert r.status_code == 200
    assert r.json()["pulls"] == []
