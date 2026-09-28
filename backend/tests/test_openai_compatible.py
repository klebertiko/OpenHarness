"""OpenAICompatibleAdapter.probe() — real GET /models, never a fabricated
success. httpx.MockTransport fixtures, same convention as
tests/repos/test_github_gitlab_adapters.py."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from adapters.base import AdapterConfig
from adapters.openai_compatible import OpenAICompatibleAdapter


def _config(**over: object) -> AdapterConfig:
    base = dict(adapter="ollama", model="", endpoint="http://fake/v1", api_key="")
    base.update(over)
    return AdapterConfig(**base)  # type: ignore[arg-type]


def test_probe_live_with_model_count(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://fake/v1/models"
        return httpx.Response(200, json={"data": [{"id": "a"}, {"id": "b"}, {"id": "c"}]})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(_config()))

    assert probe.ok is True
    assert probe.health == "live"
    assert "3 models" in probe.detail


def test_probe_attaches_bearer_header_when_api_key_present() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"data": []})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    asyncio.run(adapter.probe(_config(api_key="sk-or-TEST-SECRET")))

    assert captured["auth"] == "Bearer sk-or-TEST-SECRET"


def test_probe_no_auth_header_when_no_key() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"data": []})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    asyncio.run(adapter.probe(_config(api_key="")))

    assert captured["auth"] is None


def test_probe_reports_fault_on_401_never_a_fabricated_success() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_api_key"})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(_config(api_key="sk-or-BAD")))

    assert probe.ok is False
    assert probe.health == "fault"
    assert "401" in probe.detail


def test_probe_reports_fault_on_connect_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(_config()))

    assert probe.ok is False
    assert probe.health == "fault"
