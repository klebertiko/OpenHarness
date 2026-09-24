"""
SEC-3 (harness Security Gate, 2026-09-11) — the local half of the fix.

Loopback binding + a strict CORS allowlist close the *remote* vector (any
website in any browser tab). Neither stops another *local* process on this
machine from calling the sidecar with no credential at all. This is the
test for that: every route but /health must require
``Authorization: Bearer <token>``.

Uses `httpx` directly rather than `tests/conftest.py`'s auto-authenticated
`TestClient` — that fixture exists so every *other* test file doesn't need
to know auth exists; these tests are specifically about the auth boundary
itself, so they bypass the auto-injection on purpose.
"""

from __future__ import annotations

import os

import httpx
from starlette.testclient import TestClient

from main import app

TOKEN = os.environ["OH_SIDECAR_TOKEN"]


def _raw_client() -> TestClient:
    # Deliberately NOT going through conftest's patched TestClient.request —
    # these tests need to control the Authorization header themselves.
    c = TestClient(app)
    c.request = httpx.Client.request.__get__(c, TestClient)  # bypass the auto-auth patch
    return c


def test_health_needs_no_token() -> None:
    r = _raw_client().get("/health")
    assert r.status_code == 200


def test_mutating_route_without_token_is_rejected() -> None:
    r = _raw_client().get("/providers/catalog")
    assert r.status_code == 401


def test_wrong_token_is_rejected() -> None:
    r = _raw_client().get("/providers/catalog", headers={"Authorization": "Bearer not-the-real-token"})
    assert r.status_code == 401


def test_correct_token_is_accepted() -> None:
    r = _raw_client().get("/providers/catalog", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200


def test_malformed_header_without_bearer_prefix_is_rejected() -> None:
    r = _raw_client().get("/providers/catalog", headers={"Authorization": TOKEN})
    assert r.status_code == 401


def test_usage_routes_require_the_token_too() -> None:
    """The usage ledger/budget router (routers/usage.py) is registered the
    same way as every other router (`app.include_router`, no bypass of its
    own) — this pins that down explicitly rather than trusting it by
    inference from the generic middleware test above. A spending ceiling
    that anyone on the machine could read or silently reconfigure without
    the sidecar token would defeat the point of having one."""
    assert _raw_client().get("/usage/summary").status_code == 401
    assert _raw_client().get("/usage/budget").status_code == 401
    assert _raw_client().put("/usage/budget", json={"limitUsd": 5}).status_code == 401

    ok = _raw_client().get("/usage/budget", headers={"Authorization": f"Bearer {TOKEN}"})
    assert ok.status_code == 200
