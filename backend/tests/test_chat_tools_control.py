import pytest
from fastapi.testclient import TestClient
from engine import RunControl, RUNS
from main import app


@pytest.fixture()
def control():
    control = RunControl('approval-api')
    control.tool_mode = True
    with TestClient(app) as client:
        RUNS[control.run_id] = control
        try: yield client, control
        finally: RUNS.pop(control.run_id, None)


def test_control_refuses_preapproval_mismatch_and_replay(control):
    client, run = control
    url = f'/execute/{run.run_id}/control'
    body = {'action':'resume','decision':'approve','call_id':'c1','note':'checked'}
    assert client.post(url,json=body).json()=={'error':'no_pending_call','pending_call_id':None}
    run.tool_approval.begin('c1')
    for change in ({'call_id':'wrong'}, {'call_id':None}, {'action':'step','call_id':None,'decision':None}):
        response = client.post(url,json={**body,**change})
        assert response.status_code==409 and response.json()['error']=='call_id_mismatch'
        assert not run.gate.is_set()
    invalid = client.post(url,json={**body,'decision':'maybe'})
    assert invalid.status_code==400 and not run.gate.is_set()
    assert client.post(url,json=body).status_code==200
    assert run.tool_approval.decision=={'decision':'approve','note':'checked'}
    assert run.gate.is_set()
    replay=client.post(url,json=body)
    assert replay.status_code==409 and replay.json()['error']=='already_decided'


def test_stop_opens_gate_without_approving(control):
    client,run=control
    run.tool_approval.begin('c1')
    assert client.post(f'/execute/{run.run_id}/control',json={'action':'stop'}).status_code==200
    assert run.stop.is_set() and run.gate.is_set() and run.tool_approval.decision is None
