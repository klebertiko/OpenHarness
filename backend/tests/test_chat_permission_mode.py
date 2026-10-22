"""Permission mode wired into the broker and the sidecar API (enforced server-side)."""
import asyncio
import json
import sys

import pytest
from fastapi.testclient import TestClient

from engine import RunControl
from main import app
from sandbox.broker import ToolBroker
from sandbox.schemas import ToolsRequest

THREAD = 'thread-0001'


def sse(response):
    return [{'event': block.splitlines()[0][7:], 'data': json.loads(block.splitlines()[1][6:])}
            for block in response.text.strip().split('\n\n') if block.startswith('event: ')]


# -- broker: what each mode does with an exec call ---------------------------
def run_exec(root, mode, argv, decision='approve', cwd='.'):
    control = RunControl('perm-broker')
    broker = ToolBroker(str(root), 'ollama', control, ToolsRequest(enabled=True), permission_mode=mode)

    async def collect():
        events = []
        async for event in broker.call('exec', {'argv': argv, 'cwd': cwd, 'timeout_s': 20}, origin='preset'):
            events.append(event)
            if event['kind'] == 'tool_approval_required':
                control.tool_approval.decide(event['call_id'], decision, 'checked')
        return events
    return asyncio.run(collect())


def kinds(events):
    return [e['kind'] for e in events]


def test_ask_mode_is_unchanged_and_always_parks_on_the_gate(tmp_path):
    events = run_exec(tmp_path, 'ask', [sys.executable, '--version'])
    assert kinds(events) == ['tool_call', 'tool_approval_required', 'tool_approval_decision', 'tool_result']


def test_default_broker_mode_is_ask(tmp_path):
    control = RunControl('perm-default')
    broker = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True))
    assert broker.permission_mode == 'ask'


def test_plan_mode_refuses_exec_with_a_clear_message_and_never_runs_it(tmp_path):
    marker = tmp_path / 'ran'
    events = run_exec(tmp_path, 'plan', [sys.executable, '-c', f'open({str(marker)!r}, "w")'])
    assert kinds(events) == ['tool_call', 'tool_denied']
    assert events[-1]['reason'] == 'policy' and 'plan' in events[-1]['note'].lower() and 'read-only' in events[-1]['note'].lower()
    assert not marker.exists()


def test_plan_mode_still_reads_files(tmp_path):
    (tmp_path / 'README.md').write_text('hi', encoding='utf-8')
    control = RunControl('perm-read')
    broker = ToolBroker(str(tmp_path), 'ollama', control, ToolsRequest(enabled=True), permission_mode='plan')

    async def collect():
        return [event async for event in broker.call('read', {'path': 'README.md'}, origin='model')]
    events = asyncio.run(collect())
    assert kinds(events) == ['tool_call', 'tool_result'] and events[-1]['result'] == 'hi'


def test_auto_mode_runs_an_allowed_command_without_the_gate_and_records_why(tmp_path):
    (tmp_path / 'notes.txt').write_text('inside', encoding='utf-8')
    events = run_exec(tmp_path, 'auto_workspace', ['git', '--version'])
    assert kinds(events) == ['tool_call', 'tool_auto_approved', 'tool_result']
    call_id = events[0]['call_id']
    assert events[1] == {'kind': 'tool_auto_approved', 'call_id': call_id, 'mode': 'auto_workspace',
                         'reason': 'workspace'}
    assert events[2]['call_id'] == call_id


def test_auto_mode_still_asks_for_a_denylisted_program(tmp_path):
    events = run_exec(tmp_path, 'auto_workspace', [sys.executable, '-c', 'print(1)'])
    assert kinds(events) == ['tool_call', 'tool_approval_required', 'tool_approval_decision', 'tool_result']
    assert not any(e['kind'] == 'tool_auto_approved' for e in events)


def test_auto_mode_asks_when_the_command_leaves_the_workspace(tmp_path):
    (tmp_path / 'inner').mkdir()
    events = run_exec(tmp_path / 'inner', 'auto_workspace', ['git', '--version'], cwd='.')
    assert 'tool_auto_approved' in kinds(events)
    events = run_exec(tmp_path, 'auto_workspace', ['git', 'log', '../outside'], decision='reject')
    assert kinds(events) == ['tool_call', 'tool_approval_required', 'tool_approval_decision', 'tool_denied']


def test_unknown_broker_mode_behaves_like_ask(tmp_path):
    events = run_exec(tmp_path, 'bypass', ['git', '--version'])
    assert 'tool_approval_required' in kinds(events) and 'tool_auto_approved' not in kinds(events)


# -- API: the conversation's stored mode ------------------------------------
@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as client:
        client.post('/cowork/projects', json={'name': 'Perm', 'rootPath': str(tmp_path)})
        yield client


def set_mode(client, mode, thread=THREAD):
    return client.put('/chat/tools/permission', json={'thread_id': thread, 'mode': mode})


def direct(client, tmp_path, tools, extra=None):
    body = {'instruction': '', 'mode': 'mock', 'cwd': str(tmp_path),
            'tools': {'enabled': True, 'summarize': False, **tools}, **(extra or {})}
    return sse(client.post('/execute/direct', json=body))


def test_new_conversation_defaults_to_ask(client):
    assert client.get('/chat/tools/permission', params={'thread_id': 'brand-new'}).json() == {'thread_id': 'brand-new', 'mode': 'ask'}


def test_mode_round_trips_and_persists_per_thread(client):
    assert set_mode(client, 'auto_workspace').json() == {'thread_id': THREAD, 'mode': 'auto_workspace'}
    assert set_mode(client, 'plan', 'other-thread').status_code == 200
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == 'auto_workspace'
    assert client.get('/chat/tools/permission', params={'thread_id': 'other-thread'}).json()['mode'] == 'plan'


@pytest.mark.parametrize('payload', [{'thread_id': THREAD, 'mode': 'bypass'}, {'thread_id': THREAD, 'mode': 'yolo'},
                                     {'thread_id': THREAD, 'mode': None}, {'thread_id': THREAD}, {'mode': 'ask'},
                                     {'thread_id': '', 'mode': 'ask'}, {'thread_id': 'x' * 200, 'mode': 'ask'},
                                     {'thread_id': 'bad id!', 'mode': 'ask'}, {'thread_id': THREAD, 'mode': 'ask', 'extra': 1}])
def test_invalid_mode_updates_are_400_and_change_nothing(client, payload):
    set_mode(client, 'plan')
    response = client.put('/chat/tools/permission', json=payload)
    assert response.status_code == 400 and response.json()['error'] == 'invalid_argument'
    assert client.get('/chat/tools/permission', params={'thread_id': THREAD}).json()['mode'] == 'plan'


def effective(events):
    return next(e['data'] for e in events if e['event'] == 'capabilities')['permission_mode']


def test_a_run_uses_the_stored_mode_of_its_thread(client, tmp_path):
    set_mode(client, 'auto_workspace')
    assert effective(direct(client, tmp_path, {'thread_id': THREAD, 'preset': {'name': 'discover'}})) == 'auto_workspace'


@pytest.mark.parametrize('stored,requested,expected', [('ask', 'auto_workspace', 'ask'), ('plan', 'auto_workspace', 'plan'),
                                                       ('plan', 'ask', 'plan'), ('auto_workspace', 'plan', 'plan')])
def test_a_request_cannot_pick_a_mode_laxer_than_the_stored_one(client, tmp_path, stored, requested, expected):
    set_mode(client, stored)
    events = direct(client, tmp_path, {'thread_id': THREAD, 'permission_mode': requested, 'preset': {'name': 'discover'}})
    assert effective(events) == expected


def test_a_request_without_a_thread_cannot_escape_ask(client, tmp_path):
    set_mode(client, 'auto_workspace')
    events = direct(client, tmp_path, {'permission_mode': 'auto_workspace', 'preset': {'name': 'discover'}})
    assert effective(events) == 'ask'
    events = direct(client, tmp_path, {'thread_id': 'never-configured', 'permission_mode': 'auto_workspace', 'preset': {'name': 'discover'}})
    assert effective(events) == 'ask'


def test_a_request_cannot_name_a_bypass_mode(client, tmp_path):
    response = client.post('/execute/direct', json={'instruction': '', 'mode': 'mock', 'cwd': str(tmp_path),
        'tools': {'thread_id': THREAD, 'permission_mode': 'bypass', 'preset': {'name': 'discover'}}})
    assert response.status_code == 400 and response.json()['error'] == 'invalid_argument'


def test_plan_stored_mode_denies_exec_even_if_the_request_asks_for_auto(client, tmp_path):
    set_mode(client, 'plan')
    events = direct(client, tmp_path, {'thread_id': THREAD, 'permission_mode': 'auto_workspace',
                                       'preset': {'name': 'exec', 'argv': ['git', '--version']}})
    denied = next(e['data'] for e in events if e['event'] == 'tool_denied')
    assert denied['reason'] == 'policy' and 'read-only' in denied['note'].lower()
    assert not any(e['event'] in {'tool_result', 'tool_auto_approved', 'tool_approval_required'} for e in events)


def test_the_decision_is_recorded_in_the_run_history(client, tmp_path):
    set_mode(client, 'plan')
    response = client.post('/execute/direct', json={'instruction': '', 'mode': 'mock', 'cwd': str(tmp_path),
        'tools': {'thread_id': THREAD, 'summarize': False, 'preset': {'name': 'exec', 'argv': ['git', '--version']}}})
    history = client.get('/execute/logs/' + response.headers['x-execution-id']).json()
    assert [e['event'] for e in history['result']['events']] == [e['event'] for e in sse(response)]
