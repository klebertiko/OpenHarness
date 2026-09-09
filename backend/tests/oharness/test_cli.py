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
