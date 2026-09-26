"""Automation forms reject inputs the actual UTC scheduler cannot execute."""
import pytest
from pydantic import ValidationError
from starlette.testclient import TestClient
from main import app
from routers.automations import JobCreate, JobUpdate

@pytest.mark.parametrize("model", [JobCreate, JobUpdate])
@pytest.mark.parametrize("name", ["", "  ", "\t\n"])
def test_blank_names_rejected(model, name):
    with pytest.raises(ValidationError):
        model(name=name)

@pytest.mark.parametrize("cron", ["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 7", "*/0 * * * *", "10-2 * * * *", "* * * * MON", "* * * * ?", "1,,2 * * * *", "*/-1 * * * *", "*,1 * * * *"])
@pytest.mark.parametrize("model", [JobCreate, JobUpdate])
def test_invalid_scheduler_expressions_rejected(model, cron):
    with pytest.raises(ValidationError):
        model(name="Job", cron=cron)

@pytest.mark.parametrize("cron", [None, "* * * * *", "*/5 0-23 1,15 * 0-6", "0 9 * * 1-5", "59 23 31 12 6"])
def test_supported_cron_and_on_demand_remain_valid(cron):
    assert JobCreate(name="  Example  ", cron=cron).name == "Example"
    assert JobUpdate(cron=cron).cron == cron

def test_api_rejects_invalid_update_and_supports_clearing_schedule():
    with TestClient(app) as client:
        created = client.post("/automations/", json={"name":"Validation fixture", "cron":None})
        assert created.status_code == 201
        job_id = created.json()["id"]
        bad = client.put(f"/automations/{job_id}", json={"cron":"60 * * * *"})
        assert bad.status_code == 422
        assert client.get(f"/automations/{job_id}").json()["cron"] is None
        good = client.put(f"/automations/{job_id}", json={"name":"  Updated  ", "cron":"0 9 * * 1-5"})
        assert good.status_code == 200 and good.json()["name"] == "Updated"
        cleared = client.put(f"/automations/{job_id}", json={"cron":None})
        assert cleared.status_code == 200 and cleared.json()["cron"] is None
