import json
from pathlib import Path

from fastapi import APIRouter

from oharness.mock_run import plan_mock_run
from oharness.models import HarnessBundle
from oharness.validate import validate_dict

router = APIRouter(prefix="/bundles", tags=["bundles"])
DEFAULT = (
    Path(__file__).resolve().parent.parent / "oharness" / "fixtures" / "default-agile.oharness"
)


@router.get("/default")
def get_default():
    return json.loads(DEFAULT.read_text(encoding="utf-8"))


@router.post("/validate")
def validate_bundle(body: dict):
    result = validate_dict(body)
    return {"ok": result.ok, "errors": result.errors}


@router.post("/mock")
def mock_bundle(body: dict):
    result = validate_dict(body)
    if not result.ok:
        return {"ok": False, "steps": [], "errors": result.errors}
    bundle = HarnessBundle.model_validate(body)
    report = plan_mock_run(bundle)
    return {
        "ok": report.ok,
        "steps": [s.__dict__ for s in report.steps],
        "errors": getattr(report, "errors", []),
    }
