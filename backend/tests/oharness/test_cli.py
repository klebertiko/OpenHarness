import json
import subprocess
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
BACKEND = Path(__file__).resolve().parents[2]


def run_validate(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "oharness", "validate", str(path)],
        cwd=BACKEND,
        capture_output=True,
        text=True,
    )


def test_cli_validate_ok():
    p = run_validate(FIXTURES / "valid-hello.oharness")
    assert p.returncode == 0
    out = json.loads(p.stdout)
    assert out["ok"] is True
    assert out["errors"] == []


def test_cli_validate_fail():
    p = run_validate(FIXTURES / "invalid-missing-manifest.oharness")
    assert p.returncode == 1
    out = json.loads(p.stdout)
    assert out["ok"] is False
    assert len(out["errors"]) > 0


def test_cli_validate_missing_file():
    p = run_validate(FIXTURES / "does-not-exist.oharness")
    assert p.returncode == 1
    assert p.stderr == ""
    out = json.loads(p.stdout)
    assert out["ok"] is False
    assert any("file not found" in e.lower() for e in out["errors"])


def test_cli_validate_ok_on_native_yaml_default_bundle():
    # The packaged default is now authored as YAML (ADR 0003) -- the CLI
    # must accept it exactly like the legacy-JSON fixtures above, with no
    # extension-based branching (ohm-yaml-migration.md P1 step 3).
    default_ohm = BACKEND / "oharness" / "fixtures" / "default-agile.ohm"
    p = run_validate(default_ohm)
    assert p.returncode == 0
    out = json.loads(p.stdout)
    assert out["ok"] is True
    assert out["errors"] == []
