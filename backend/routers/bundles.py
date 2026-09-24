from pathlib import Path

from fastapi import APIRouter, HTTPException

from oharness import codec
from oharness.mock_run import plan_mock_run
from oharness.models import HarnessBundle
from oharness.validate import validate_dict

router = APIRouter(prefix="/bundles", tags=["bundles"])
DEFAULT = (
    Path(__file__).resolve().parent.parent / "oharness" / "fixtures" / "default-agile.ohm"
)


@router.get("/default")
def get_default():
    # The packaged default is authored as YAML (ADR 0003); this endpoint's
    # own contract stays JSON (ohm-yaml-migration.md P1 step 5), so it
    # decodes+normalizes via the shared codec and returns a plain dict that
    # FastAPI serializes as JSON, same as before.
    try:
        return codec.load_path(DEFAULT)
    except codec.CodecError as ex:  # pragma: no cover - packaged fixture is tested directly
        raise HTTPException(status_code=500, detail=f"default bundle is invalid: {ex}") from ex


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
