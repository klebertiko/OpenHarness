"""The frontend's offline seed rows are what `ensureBackendRow` POSTs to
/providers/connections. A seed endpoint that drifts from the catalogue default
of a fixed-endpoint provider makes that POST 400 — silently, because the
client swallows it. Parse the TS seed textually and pin the two together."""

from __future__ import annotations

import re
from pathlib import Path

from adapters.catalog import OLLAMA_CLOUD, get_provider

STORE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "providers" / "providerStore.ts"

# One seed row: `id`, `provider` ... then its own top-level `endpoint` (4-space indent).
_ROW = re.compile(
    r'^ {4}id: "(?P<id>[^"]+)",\s*\n\s*provider: "(?P<provider>[^"]+)",'
    r'[\s\S]*?^ {4}endpoint: "(?P<endpoint>[^"]+)"',
    re.MULTILINE,
)


def _seed_rows() -> list[tuple[str, str, str]]:
    rows = [(m["id"], m["provider"], m["endpoint"]) for m in _ROW.finditer(STORE.read_text(encoding="utf-8"))]
    assert rows, "could not parse any seed row from providerStore.ts"
    return rows


def test_seed_parser_finds_every_connection_row() -> None:
    assert {r[0] for r in _seed_rows()} == {
        "anthropic", "cursor", "openai", "ollama-local", "ollama-cloud", "openrouter",
    }


def test_fixed_endpoint_seed_rows_match_the_backend_catalogue_default() -> None:
    checked = []
    for row_id, provider, endpoint in _seed_rows():
        spec = OLLAMA_CLOUD if row_id == "ollama-cloud" else get_provider(provider)
        assert spec is not None, f"seed row {row_id!r} names unknown provider {provider!r}"
        if spec["endpoint"]["editable"]:
            continue
        checked.append(row_id)
        assert endpoint == spec["endpoint"]["default"], (
            f"{row_id}: frontend seed endpoint {endpoint!r} != catalogue {spec['endpoint']['default']!r}"
        )
    assert {"anthropic", "cursor", "openrouter", "ollama-cloud"} <= set(checked)
