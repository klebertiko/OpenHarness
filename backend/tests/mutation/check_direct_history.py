"""Targeted semantic mutations; invoke only inside the isolated backend copy.

Usage: OH_ISOLATED_E2E=1 python tests/mutation/check_direct_history.py
Reports actual results to mutation-direct-history.json; restores source in finally.
This is a finite set of regression faults, not a whole-repository mutation score.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
if os.environ.get("OH_ISOLATED_E2E") != "1" or not (root.parent / ".git").is_file():
    raise SystemExit("Use an isolated git worktree with OH_ISOLATED_E2E=1")
source = root / "routers" / "execution.py"
original = source.read_text(encoding="utf-8")
prefix, rest = original.split('@router.post("/direct")', 1)
direct, suffix = rest.split('@router.post("/{run_id}/control")', 1)
unit = ["tests/test_execution_provider_resolution.py", "-k", "history"]
disconnect = ["tests/e2e/test_direct_history_e2e.py", "-k", "disconnect"]
mutations = [
    ("different-log-id", 'id=run_id, harness_id="direct"', 'id="wrong-id", harness_id="direct"', unit),
    ("drop-replay-events", 'json.dumps({"source": "direct", "events": events})', 'json.dumps({"source": "direct", "events": []})', unit),
    ("lose-direct-source", 'json.dumps({"source": "direct", "events": events})', 'json.dumps({"source": "harness", "events": events})', unit),
    ("lose-verification", '"provider_verified": connection_id is not None', '"provider_verified": False', unit),
    ("failure-as-success", '"failed" if status == STATUS_ERROR else status', '"complete" if status == STATUS_ERROR else status', unit),
    ("missing-finish-time", 'finished.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)', 'finished.finished_at = None', unit),
    ("cancelled-write", 'anyio.CancelScope(shield=True)', 'anyio.CancelScope(shield=False)', disconnect),
]
report = {"source_sha256": hashlib.sha256(original.encode()).hexdigest(), "results": []}


def run(label, args):
    env = {**os.environ, "PYTHONPYCACHEPREFIX": str(root / ".mutation-pycache" / label)}
    result = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *args],
                            cwd=root, env=env, capture_output=True, text=True, timeout=90)
    (root / f"mutation-{label}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
    return result


try:
    baseline = run("baseline", ["tests/test_execution_provider_resolution.py", "tests/e2e/test_direct_history_e2e.py"])
    if baseline.returncode != 0:
        raise SystemExit("Baseline failed; inspect mutation-baseline.log")
    for name, old, new, args in mutations:
        if direct.count(old) != 1:
            raise RuntimeError(f"Mutation anchor drifted: {name}")
        source.write_text(prefix + '@router.post("/direct")' + direct.replace(old, new, 1)
                          + '@router.post("/{run_id}/control")' + suffix, encoding="utf-8")
        result = run(name, args)
        verdict = "killed" if result.returncode == 1 and " failed" in result.stdout else (
            "survived" if result.returncode == 0 else "invalid")
        report["results"].append({"mutation": name, "verdict": verdict, "exit_code": result.returncode})
        print(f"{name}: {verdict}", flush=True)
finally:
    source.write_text(original, encoding="utf-8")
    (root / "mutation-direct-history.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
if any(r["verdict"] != "killed" for r in report["results"]):
    raise SystemExit(1)
