"""Cowork projects CRUD API."""

from __future__ import annotations

import warnings

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def test_cowork_project_crud(client: TestClient) -> None:
    created = client.post(
        "/cowork/projects",
        json={
            "name": "Research desk",
            "rootPath": "D:/workspaces/research",
            "instructions": "Prefer primary sources.",
            "memoryJson": {"notes": ["started"]},
            "harnessBundleId": "skills-framework-default",
            "harnessEnabled": True,
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "Research desk"
    assert body["rootPath"] == "D:/workspaces/research"
    assert body["instructions"] == "Prefer primary sources."
    assert body["memoryJson"] == {"notes": ["started"]}
    assert body["harnessBundleId"] == "skills-framework-default"
    assert body["harnessEnabled"] is True
    assert "id" in body
    project_id = body["id"]

    listed = client.get("/cowork/projects")
    assert listed.status_code == 200
    assert any(p["id"] == project_id for p in listed.json()["projects"])

    got = client.get(f"/cowork/projects/{project_id}")
    assert got.status_code == 200
    assert got.json()["id"] == project_id

    updated = client.put(
        f"/cowork/projects/{project_id}",
        json={
            "name": "Research desk v2",
            "harnessEnabled": False,
            "memoryJson": {"notes": ["updated"]},
        },
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Research desk v2"
    assert updated.json()["harnessEnabled"] is False
    assert updated.json()["memoryJson"] == {"notes": ["updated"]}

    deleted = client.delete(f"/cowork/projects/{project_id}")
    assert deleted.status_code == 204
    assert client.get(f"/cowork/projects/{project_id}").status_code == 404


def test_cowork_project_not_found(client: TestClient) -> None:
    assert client.get("/cowork/projects/missing").status_code == 404


def test_update_endpoints_do_not_emit_utcnow_deprecation_warning(client: TestClient) -> None:
    project = client.post(
        "/cowork/projects",
        json={
            "name": "Warning check",
            "rootPath": "/tmp/warncheck",
            "instructions": "",
            "memoryJson": {},
            "harnessEnabled": False,
        },
    ).json()

    harness = client.post(
        "/harnesses/",
        json={"name": "Warning check harness", "description": "", "graph_json": {}},
    ).json()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert client.put(f"/cowork/projects/{project['id']}", json={"name": "v2"}).status_code == 200
        assert client.put(f"/harnesses/{harness['id']}", json={"name": "v2"}).status_code == 200

    utcnow_warnings = [
        w for w in caught if issubclass(w.category, DeprecationWarning) and "utcnow" in str(w.message)
    ]
    assert not utcnow_warnings, [str(w.message) for w in utcnow_warnings]
