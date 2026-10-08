"""OpenAICompatibleAdapter.probe() — real GET /models, never a fabricated
success. httpx.MockTransport fixtures."""

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


def test_probe_returns_model_ids_sorted_and_deduplicated() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "b"}, {"id": "a"}, {"id": "b"}, {"nope": 1}]})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(_config()))

    assert probe.models == ["a", "b"]


def test_probe_caps_the_model_list_and_drops_hostile_ids() -> None:
    # SEC follow-up: an endpoint is untrusted — never echo an unbounded list,
    # oversize ids or non-string ids back to the UI.
    ids = [f"m{i:04d}" for i in range(2100)]
    data = [{"id": i} for i in ids] + [{"id": "0" * 201}, {"id": 7}, {"id": None}]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": data})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(_config()))

    assert probe.ok is True
    assert len(probe.models) == 2000
    assert probe.models == ids[:2000]
    assert all(isinstance(m, str) and len(m) <= 200 for m in probe.models)


def test_probe_faults_on_an_oversized_body_instead_of_reading_it() -> None:
    big = b'{"data": [' + b'{"id": "a"},' * 300_000 + b'{"id": "z"}]}'
    assert len(big) > 2 * 1024 * 1024

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=big)

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(_config()))

    assert probe.ok is False
    assert probe.health == "fault"
    assert probe.models == []


def _probe_ids(ids: list[str]):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": i} for i in ids]})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    return asyncio.run(adapter.probe(_config()))


def test_probe_returns_every_id_at_exactly_the_cap_and_says_nothing_was_cut() -> None:
    ids = [f"m{i:04d}" for i in range(2000)]
    probe = _probe_ids(ids)

    assert probe.models == ids
    assert probe.detail == "2000 models available."


def test_probe_one_over_the_cap_is_truncated_and_the_detail_says_so() -> None:
    ids = [f"m{i:04d}" for i in range(2001)]
    probe = _probe_ids(ids)

    assert len(probe.models) == 2000
    assert probe.detail == "Showing the first 2000 of 2001 models."


def test_probe_detail_counts_the_models_actually_returned_not_hostile_entries() -> None:
    probe = _probe_ids(["a", "b", "0" * 201])

    assert probe.models == ["a", "b"]
    assert probe.detail == "2 models available."


def test_probe_keeps_an_id_of_exactly_200_chars_and_drops_201() -> None:
    keep, drop = "k" * 200, "d" * 201
    probe = _probe_ids([keep, drop])

    assert probe.models == [keep]


def test_probe_with_an_unparseable_body_is_reachable_with_no_models() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>not json</html>")

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(_config()))

    assert probe.ok is True
    assert probe.health == "live"
    assert probe.models == []
    assert probe.detail == "Reachable."
