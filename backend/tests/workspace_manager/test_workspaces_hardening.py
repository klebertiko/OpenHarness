"""Inputs that used to end in a 500 now end in a 4xx, and an ambiguous ref is refused instead of resolved silently."""
from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from main import app
from workspaces.errors import WorkspaceError


@pytest.fixture
def client(oh_env):
    return TestClient(app)


def test_a_token_with_non_ascii_digits_is_malformed_not_a_crash(svc, repo, wt):
    info, _ = wt
    for token in ("².abc", "٣٣.abc", "１２.abc", "1².abc"):
        with pytest.raises(WorkspaceError) as caught:
            svc.remove(str(repo.path), info["id"], token)
        assert caught.value.code == "confirmation_invalid" and caught.value.details["reason"] == "malformed"


def test_a_token_with_non_ascii_digits_over_http_is_a_409(client, repo, wt):
    info, _ = wt
    response = client.post(f"/workspaces/{info['id']}/remove", json={"repo": str(repo.path), "confirmation_token": "².abc"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "confirmation_invalid"


@pytest.mark.parametrize("suffix", ["::$DATA", ":stream", "::$INDEX_ALLOCATION"])
def test_a_repository_path_with_a_stream_suffix_is_a_400(client, repo, suffix):
    response = client.get("/workspaces", params={"repo": str(repo.path) + suffix})
    assert response.status_code == 400 and response.json()["detail"]["code"] == "invalid_repo"


@pytest.mark.parametrize("raw", [
    '{"repo": NaN, "ref": "main"}', '{"repo": "x", "ref": Infinity}', '{"repo": "x", "ref": "main", "branch": -Infinity}',
    '{"repo": "x", "ref": "main", "extra": NaN}',
])
def test_non_finite_numbers_in_a_body_are_a_422(client, raw):
    response = client.post("/workspaces", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_non_finite_numbers_in_the_remove_body_are_a_422(client):
    raw = '{"repo": "x", "confirmation_token": "t", "release_lock": NaN}'
    response = client.post("/workspaces/main/remove", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_ordinary_bodies_still_work(client, repo):
    outcome = client.post("/workspaces", json={"repo": str(repo.path), "ref": "main"})
    assert outcome.status_code == 201


def test_a_tag_and_a_branch_with_the_same_name_are_ambiguous(svc, repo):
    repo.git("tag", "dup")
    repo.commit("later.txt")
    repo.git("branch", "dup")
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "dup")
    assert caught.value.code == "ambiguous_ref" and caught.value.status == 409
    outcome = svc.create(str(repo.path), "refs/tags/dup")
    assert outcome["base_ref"] == "refs/tags/dup"  # fully qualified is unambiguous
    outcome = svc.create(str(repo.path), "refs/heads/dup")
    assert outcome["managed"]


def test_an_unambiguous_ref_is_unaffected(svc, repo):
    repo.git("tag", "v1")
    outcome = svc.create(str(repo.path), "v1")
    assert outcome["managed"]
    outcome = svc.create(str(repo.path), "main")
    assert outcome["managed"]
