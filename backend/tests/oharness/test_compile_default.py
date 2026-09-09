from pathlib import Path

from oharness.compile_skills_harness import compile_skills_harness
from oharness.validate import validate_dict

SKILLS_HARNESS = Path(r"D:\Development\src\skills-framework\skills\engineering\harness")


def test_compiled_default_validates():
    data = compile_skills_harness(SKILLS_HARNESS)
    assert data["manifest"]["id"] == "openharness.default.agile"
    assert "PO" in data["content"]["agents"] or any(
        "PO" in k for k in data["content"]["agents"]
    )
    r = validate_dict(data)
    assert r.ok, r.errors
