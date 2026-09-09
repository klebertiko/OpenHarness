"""Cowork projects + Automation jobs CRUD API."""

from __future__ import annotations

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


def test_automation_job_crud(client: TestClient) -> None:
    project = client.post(
        "/cowork/projects",
        json={
            "name": "Schedules home",
            "rootPath": "/tmp/sched",
            "instructions": "",
            "memoryJson": {},
            "harnessEnabled": False,
        },
    ).json()

    created = client.post(
        "/automations/",
        json={
            "name": "Morning digest",
            "cron": "0 9 * * *",
            "projectId": project["id"],
            "harnessBundleId": None,
            "harnessEnabled": False,
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "Morning digest"
    assert body["cron"] == "0 9 * * *"
    assert body["projectId"] == project["id"]
    assert body["harnessEnabled"] is False
    assert body["status"] == "idle"
    assert body["lastRunAt"] is None
    job_id = body["id"]

    listed = client.get("/automations/")
    assert listed.status_code == 200
    assert any(j["id"] == job_id for j in listed.json()["jobs"])

    got = client.get(f"/automations/{job_id}")
    assert got.status_code == 200
    assert got.json()["cron"] == "0 9 * * *"

    updated = client.put(
        f"/automations/{job_id}",
        json={"cron": None, "harnessEnabled": True, "name": "On-demand only"},
    )
    assert updated.status_code == 200
    assert updated.json()["cron"] is None
    assert updated.json()["harnessEnabled"] is True
    assert updated.json()["name"] == "On-demand only"

    deleted = client.delete(f"/automations/{job_id}")
    assert deleted.status_code == 204
    assert client.get(f"/automations/{job_id}").status_code == 404


def test_cowork_project_not_found(client: TestClient) -> None:
    assert client.get("/cowork/projects/missing").status_code == 404


def test_automation_job_not_found(client: TestClient) -> None:
    assert client.get("/automations/missing").status_code == 404
