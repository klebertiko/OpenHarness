import json
from fastapi.testclient import TestClient
import pytest
from main import app


def events(response):
    return [{'event': block.splitlines()[0][7:], 'data': json.loads(block.splitlines()[1][6:])}
            for block in response.text.strip().split('\n\n') if block.startswith('event: ')]


@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as client:
        client.post('/cowork/projects', json={'name': 'Preset', 'rootPath': str(tmp_path)})
        (tmp_path / 'README.md').write_text('hello from workspace', encoding='utf-8')
        yield client


def test_read_preset_without_instruction_or_model(client, tmp_path):
    response = client.post('/execute/direct', json={'instruction':'', 'mode':'mock', 'cwd':str(tmp_path),
        'tools': {'enabled': True, 'preset': {'name':'read','path':'README.md'}, 'summarize':False}})
    assert response.status_code == 200
    result = events(response)
    assert result[0]['event'] == 'capabilities'
    tool = next(e['data'] for e in result if e['event'] == 'tool_result')
    assert tool['result'] == 'hello from workspace' and tool['node_id'] == 'direct'
    done = next(e['data'] for e in result if e['event'] == 'node_done')
    assert done['provider_verified'] is False and done['tokens'] == 0
    history = client.get('/execute/logs/' + response.headers['x-execution-id']).json()
    assert history['result']['events'] == result


def test_mock_exec_cannot_create_a_file(client, tmp_path):
    response = client.post('/execute/direct', json={'instruction':'simulate', 'mode':'mock', 'cwd':str(tmp_path),
        'tools': {'enabled':True, 'preset': {'name':'exec','argv':['python','-c',"open('ran','w')"]}, 'summarize':False}})
    result = events(response)
    assert any(e['event'] == 'tool_result' and e['data']['simulated'] is True for e in result)
    assert not any(e['event'] == 'tool_approval_required' for e in result)
    assert not (tmp_path / 'ran').exists()


@pytest.mark.parametrize('preset', [{'name':'exec','argv':[]}, {'name':'exec','argv':['x'],'timeout_s':True},
    {'name':'exec','argv':['x'],'timeout_s':601}, {'name':'read','path':''}, {'name':'read','path':'x','truncate':'false'},
    {'name':'bad'}, {'name':'exec','argv':'python'}, {'name':'exec','argv':['x',2]}])
def test_invalid_presets_are_400(client, tmp_path, preset):
    response = client.post('/execute/direct', json={'instruction':'hi', 'mode':'mock','cwd':str(tmp_path),
        'tools':{'preset':preset}})
    assert response.status_code == 400 and response.json()['error'] == 'invalid_argument'


def test_no_workspace_never_executes_preset(client):
    response = client.post('/execute/direct', json={'instruction':'run', 'mode':'mock',
        'tools':{'preset':{'name':'read','path':'README.md'},'summarize':False}})
    result = events(response)
    assert result[0]['data']['reason'] == 'no-workspace'
    assert any(e['event']=='tool_denied' and e['data']['reason']=='policy' for e in result)
