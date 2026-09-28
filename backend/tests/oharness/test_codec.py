"""Tests for oharness.codec: the restricted YAML 1.2 profile, decode ->
normalize -> encode pipeline, and the P1 preservation contract
(ohm-yaml-migration.md, "Aceitacao e testes isolados").

Fixtures under ../../../../tests/fixtures/ohm/ are shared with the (not yet
implemented in this worktree) TypeScript codec -- kept format-real (.yaml/
.json/.ohm files, no Python-specific helpers) on purpose.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from oharness import codec
from oharness.mock_run import plan_mock_run
from oharness.models import HarnessBundle
from oharness.validate import validate_dict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent
SHARED_FIXTURES = REPO_ROOT / "tests" / "fixtures" / "ohm"
NEGATIVE_DIR = SHARED_FIXTURES / "negative"
GOLDEN_YAML = SHARED_FIXTURES / "golden.ohm"
GOLDEN_JSON = SHARED_FIXTURES / "golden.legacy.json"
PKG_FIXTURES = BACKEND_DIR / "oharness" / "fixtures"
DEFAULT_OHM = PKG_FIXTURES / "default-agile.ohm"
DEFAULT_LEGACY_JSON = PKG_FIXTURES / "default-agile.legacy.json"


# ---------------------------------------------------------------------------
# decode -> normalize -> encode roundtrip (P1 step 4 preservation contract)
# ---------------------------------------------------------------------------


def test_golden_yaml_roundtrip_is_idempotent_and_deterministic():
    raw = GOLDEN_YAML.read_bytes()
    decoded = codec.decode_bytes(raw)
    normalized = codec.normalize(decoded)

    # normalize(N) == N
    assert codec.normalize(normalized) == normalized

    encoded = codec.encode(normalized)
    # decode(encode(N)) == N
    assert codec.normalize(codec.decode_bytes(encoded)) == normalized
    # second export is byte-identical (deterministic canonical emission)
    assert codec.encode(codec.normalize(codec.decode_bytes(encoded))) == encoded


def test_golden_json_and_yaml_produce_the_same_normalized_model():
    yaml_model = codec.load_bytes(GOLDEN_YAML.read_bytes())
    json_model = codec.load_bytes(GOLDEN_JSON.read_bytes())
    assert yaml_model == json_model
    # the two source files also deliberately differ in top-level key order
    # (see scratchpad/make_golden.py) -- decode is order-independent.
    assert list(codec.decode_bytes(GOLDEN_JSON.read_bytes()).keys()) != list(
        codec.decode_bytes(GOLDEN_YAML.read_bytes()).keys()
    )


def test_golden_authoring_fields_survive_the_roundtrip():
    model = codec.load_bytes(GOLDEN_YAML.read_bytes())
    po = next(n for n in model["graph"]["nodes"] if n["id"] == "po")
    assert po["position"] == {"x": 0, "y": 120.5}
    assert po["data"]["bigId"] == 12345678901234567890
    assert po["data"]["flags"] == {"autoApprove": "on", "retries": "3", "empty": ""}
    assert [p["id"] for p in po["data"]["providers"]] == [
        "anthropic-primary",
        "openrouter-fallback",
    ]
    edge = next(e for e in model["graph"]["edges"] if e["id"] == "po-sm")
    assert edge["sourceHandle"] == "out"
    assert edge["targetHandle"] == "in"
    assert edge["data"] == {"signal": "Sprint-Ready: Story #1"}

    prompts = model["content"]["prompts"]
    assert prompts["CRLF_NOTE"] == "Windows-authored line one\r\nline two\r\n"
    assert prompts["GATES"] == "# Gates\n\nBlocking checkpoints.\n\nMultiple\nlines.\n"
    assert prompts["no_trailing_newline"] == "no trailing newline here"
    assert prompts["unicode"] == "caf\u00e9 \u2014 \u65e5\u672c\u8a9e \U0001F600"
    assert prompts["quoted_number_like"] == "0x1A"
    assert prompts["leading_space_block"] == "  leading space on first line\nsecond line\n"


def test_golden_graph_is_a_cycle_accepted_as_data_not_claimed_executable():
    """ADR 0003 "Limites e entrega": a cyclic graph must import/export fine
    as data, but P1 does not add loop execution. We only assert against the
    *existing*, untouched mock_run.py planner here -- never engine.py/
    execution.py, and never claim the cycle "works"."""
    model = codec.load_bytes(GOLDEN_YAML.read_bytes())
    bundle = HarnessBundle.model_validate(model)

    # decode/normalize/validate all accept the cycle as data:
    assert validate_dict(model).ok

    # ...but planning execution over it is explicitly not "ok":
    report = plan_mock_run(bundle)
    assert report.ok is False
    skipped = {s.nodeId for s in report.steps if s.status == "skipped"}
    assert {"sm", "gate-qa"} <= skipped


# ---------------------------------------------------------------------------
# Negative fixtures: one restricted-profile violation each
# ---------------------------------------------------------------------------

NEGATIVE_CASES = {
    "multi-document.yaml": "multiple yaml documents",
    "empty.yaml": "document is empty",
    "root-scalar.yaml": "document root must be a mapping",
    "root-sequence.yaml": "document root must be a mapping",
    "duplicate-keys.yaml": "duplicate key",
    "duplicate-keys-escaped.yaml": "duplicate key",
    "explicit-tag.yaml": "explicit tags are not allowed",
    "anchor-alias.yaml": "anchors are not allowed",
    "merge-key.yaml": "merge keys",
    "yaml-1.1-directive.yaml": "yaml 1.1",
    "non-interoperable-number.yaml": "non-interoperable numeric literal",
}


@pytest.mark.parametrize("filename", sorted(NEGATIVE_CASES))
def test_negative_fixture_is_rejected_with_expected_diagnostic(filename):
    path = NEGATIVE_DIR / filename
    assert path.is_file(), f"missing fixture: {path}"
    with pytest.raises(codec.CodecError) as excinfo:
        codec.decode_bytes(path.read_bytes())
    assert NEGATIVE_CASES[filename] in str(excinfo.value).lower()


def test_negative_fixtures_directory_has_no_stray_files():
    # guards against a fixture being added without a matching test case above
    on_disk = {p.name for p in NEGATIVE_DIR.glob("*.yaml")}
    assert on_disk == set(NEGATIVE_CASES)


# ---------------------------------------------------------------------------
# Resource limits: enforcement code path, exercised with scaled-down
# overrides rather than multi-megabyte fixtures (see codec.ResourceLimits
# docstring for the measurement this is based on).
# ---------------------------------------------------------------------------


def test_limit_max_bytes():
    limits = codec.ResourceLimits(max_bytes=5)
    with pytest.raises(codec.CodecError, match="exceeds 5 bytes"):
        codec.decode_bytes(b"a: 123456\n", limits=limits)


def test_limit_max_depth():
    limits = codec.ResourceLimits(max_depth=2)
    with pytest.raises(codec.CodecError, match="max depth 2"):
        codec.decode_bytes(b"a:\n  b:\n    c: 1\n", limits=limits)


def test_limit_max_syntax_nodes():
    limits = codec.ResourceLimits(max_syntax_nodes=3)
    with pytest.raises(codec.CodecError, match="100 nodes exceeds 3|exceeds 3 syntax nodes"):
        codec.decode_bytes(b"a: 1\nb: 2\nc: 3\n", limits=limits)


def test_limit_max_scalar_bytes():
    limits = codec.ResourceLimits(max_scalar_bytes=3)
    with pytest.raises(codec.CodecError, match="exceeds 3 bytes"):
        codec.decode_bytes(b"a: hello\n", limits=limits)


def test_limit_max_parse_seconds():
    limits = codec.ResourceLimits(max_parse_seconds=0.0)
    with pytest.raises(codec.CodecError, match="exceeded 0.0s"):
        codec.decode_bytes(b"a: 1\nb: 2\n", limits=limits)


def test_default_limits_clear_the_real_default_bundle_by_a_wide_margin():
    # codec.ResourceLimits' docstring claims the defaults are generous
    # relative to this repo's real fixture -- assert that claim rather than
    # just stating it.
    raw = DEFAULT_OHM.read_bytes()
    limits = codec.DEFAULT_LIMITS
    assert len(raw) < limits.max_bytes / 50


# ---------------------------------------------------------------------------
# Core YAML 1.2 scalar resolution, filtered to JSON-compatible values
# ---------------------------------------------------------------------------


def test_1_1_boolean_words_stay_strings_under_core_1_2():
    d = codec.decode_bytes(b"a: yes\nb: on\nc: no\nd: off\ne: Yes\nf: ON\n")
    assert d == {"a": "yes", "b": "on", "c": "no", "d": "off", "e": "Yes", "f": "ON"}


def test_mapping_keys_are_never_type_coerced():
    d = codec.decode_bytes(b"yes: 1\n123: 2\nnull: 3\n")
    assert set(d.keys()) == {"yes", "123", "null"}


def test_quoted_and_block_scalars_are_always_strings():
    d = codec.decode_bytes(b'a: "123"\nb: "true"\nc: |\n  456\n')
    assert d == {"a": "123", "b": "true", "c": "456\n"}


def test_big_integers_are_preserved_exactly_not_rounded():
    d = codec.decode_bytes(b"a: 12345678901234567890123456789\n")
    assert d["a"] == 12345678901234567890123456789


def test_yaml_1_2_leading_zero_is_decimal_not_1_1_octal():
    # YAML 1.1 treated a leading zero as an octal marker; 1.2's Core schema
    # does not -- "007" is decimal 7.
    d = codec.decode_bytes(b"a: 007\n")
    assert d["a"] == 7


def test_1_2_octal_and_hex_forms():
    d = codec.decode_bytes(b"a: 0o17\nb: 0x1F\n")
    assert d == {"a": 15, "b": 31}


# ---------------------------------------------------------------------------
# JSON is accepted through the same restricted parser (no extension branch)
# ---------------------------------------------------------------------------


def test_json_input_rejects_duplicate_keys_same_as_yaml():
    with pytest.raises(codec.CodecError, match="duplicate key"):
        codec.decode_bytes(b'{"a": 1, "a": 2}')


def test_default_legacy_json_and_default_yaml_normalize_the_same():
    yaml_model = codec.load_path(DEFAULT_OHM)
    json_model = codec.load_path(DEFAULT_LEGACY_JSON)
    assert yaml_model == json_model
    assert {n["id"] for n in yaml_model["graph"]["nodes"]} == {
        "PO", "SM", "BE", "FE", "QA", "ARCH", "TW", "SEC", "HITL",
    }


def test_legacy_oharness_extension_is_parsed_same_as_ohm():
    # extension never selects the parser (ohm-yaml-migration.md P1 step 3)
    hello = BACKEND_DIR / "tests" / "oharness" / "fixtures" / "valid-hello.oharness"
    model = codec.load_path(hello)
    assert model["manifest"]["id"] == "hello"


# ---------------------------------------------------------------------------
# encode(): canonical emission never aliases, always ends in one newline
# ---------------------------------------------------------------------------


def test_encode_never_emits_an_alias_or_anchor():
    model = codec.load_bytes(GOLDEN_YAML.read_bytes())
    out = codec.encode(model).decode("utf-8")
    for line in out.splitlines():
        stripped = line.strip()
        assert not stripped.startswith("*"), line
        assert " &" not in line and not stripped.startswith("&"), line


def test_encode_ends_with_exactly_one_trailing_newline():
    model = codec.load_bytes(GOLDEN_YAML.read_bytes())
    out = codec.encode(model)
    assert out.endswith(b"\n") and not out.endswith(b"\n\n")


def test_normalize_rejects_non_mapping_root():
    with pytest.raises(codec.CodecError, match="mapping"):
        codec.normalize(["not", "a", "mapping"])  # type: ignore[arg-type]


def test_normalize_rejects_schema_invalid_data_without_dropping_the_diagnostic():
    with pytest.raises(codec.CodecError) as excinfo:
        codec.normalize({"schemaVersion": "1.0.0"})
    assert "manifest" in str(excinfo.value).lower()
