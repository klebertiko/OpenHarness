"""Workspace trust and hardened git, as the broker and the sidecar API apply them."""
import asyncio
import json
import os

import pytest
from fastapi.testclient import TestClient

from engine import RunControl
from main import app
from sandbox.broker import ToolBroker
from sandbox.schemas import ToolsRequest

THREAD = 'thread-trust'


@pytest.fixture()
def spy_run(monkeypatch):
    """Replace the process runner: record what the broker would execute, run nothing."""
    calls = []

    async def fake_run(argv, cwd, timeout_s=60, env=None):
        calls.append({'argv': list(argv), 'cwd': str(cwd), 'env': dict(env or {})})
        return {'ok': True, 'result': 'ok', 'exit_code': 0, 'timed_out': False, 'truncated': False, 'redactions': 0, 'duration_ms': 1}
    monkeypatch.setattr('sandbox.broker.run', fake_run)
    return calls


def repo(root):
    (root / '.git').mkdir(exist_ok=True)
    (root / '.git' / 'config').write_text('[core]\n\trepositoryformatversion = 0\n', encoding='utf-8')
    return root


def run_with(root, mode, argv, trusted=False, decision='approve'):
    control = RunControl('perm-trust')
    broker = ToolBroker(str(root), 'ollama', control, ToolsRequest(enabled=True), permission_mode=mode, workspace_trusted=trusted)

    async def collect():
        events = []
        async for event in broker.call('exec', {'argv': argv, 'cwd': '.', 'timeout_s': 20}, origin='preset'):
            events.append(event)
            if event['kind'] == 'tool_approval_required':
                control.tool_approval.decide(event['call_id'], decision, 'checked')
        return events
    return asyncio.run(collect())


def kinds(events):
    return [e['kind'] for e in events]


def test_auto_git_runs_with_the_hardened_argv_and_environment(tmp_path, spy_run):
    events = run_with(repo(tmp_path), 'auto_workspace', ['git', 'diff', '--stat'])
    assert kinds(events) == ['tool_call', 'tool_auto_approved', 'tool_result']
    (call,) = spy_run
    argv = call['argv']
    assert argv[0] == 'git' and argv.index('--no-pager') < argv.index('diff')
    assert {'core.fsmonitor=', 'core.pager=cat', 'diff.external='} <= {argv[i + 1] for i, t in enumerate(argv) if t == '-c'}
    assert '--no-ext-diff' in argv and '--no-textconv' in argv and argv[-1] == '--stat'
    assert call['env']['GIT_CONFIG_NOSYSTEM'] == '1' and call['env']['GIT_CONFIG_GLOBAL'] == os.devnull


def test_the_announced_args_stay_what_the_user_asked_for(tmp_path, spy_run):
    events = run_with(repo(tmp_path), 'auto_workspace', ['git', 'status'])
    assert events[0]['args']['argv'] == ['git', 'status']


def test_a_command_a_person_approved_runs_exactly_as_shown(tmp_path, spy_run):
    run_with(repo(tmp_path), 'ask', ['git', 'status'])
    assert spy_run[0]['argv'] == ['git', 'status'] and spy_run[0]['env'] == {}


def test_other_auto_programs_run_unchanged(tmp_path, spy_run):
    events = run_with(tmp_path, 'auto_workspace', ['ls', '-la'])
    assert 'tool_auto_approved' in kinds(events) and spy_run[0]['argv'] == ['ls', '-la'] and spy_run[0]['env'] == {}


def test_project_scripts_ask_in_an_untrusted_workspace(tmp_path, spy_run):
    events = run_with(tmp_path, 'auto_workspace', ['npm', 'test'], trusted=False)
    assert kinds(events)[:2] == ['tool_call', 'tool_approval_required'] and 'tool_auto_approved' not in kinds(events)


def test_project_scripts_run_without_asking_in_a_trusted_workspace_and_say_so(tmp_path, spy_run):
    events = run_with(tmp_path, 'auto_workspace', ['npm', 'test'], trusted=True)
    assert kinds(events) == ['tool_call', 'tool_auto_approved', 'tool_result']
    assert events[1]['reason'] == 'workspace' and spy_run[0]['argv'] == ['npm', 'test']


def test_trust_does_not_loosen_ask_or_plan(tmp_path, spy_run):
    assert 'tool_approval_required' in kinds(run_with(tmp_path, 'ask', ['npm', 'test'], trusted=True))
    assert kinds(run_with(tmp_path, 'plan', ['npm', 'test'], trusted=True)) == ['tool_call', 'tool_denied']


# -- API: workspace trust (false by default; only an explicit PUT sets it) ----
@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as client:
        client.post('/cowork/projects', json={'name': 'Trust', 'rootPath': str(tmp_path)})
        yield client


def trust(client, cwd, value=True):
    return client.put('/chat/tools/trust', json={'cwd': str(cwd), 'trusted': value})


def capabilities(client, tmp_path):
    client.put('/chat/tools/permission', json={'thread_id': THREAD, 'mode': 'auto_workspace'})
    response = client.post('/execute/direct', json={'instruction': '', 'mode': 'mock', 'cwd': str(tmp_path),
        'tools': {'enabled': True, 'summarize': False, 'thread_id': THREAD, 'preset': {'name': 'discover'}}})
    blocks = [b for b in response.text.strip().split('\n\n') if b.startswith('event: capabilities')]
    return json.loads(blocks[0].splitlines()[1][6:])


def test_a_workspace_is_untrusted_by_default(client, tmp_path):
    assert client.get('/chat/tools/trust', params={'cwd': str(tmp_path)}).json() == {'cwd': str(tmp_path.resolve()), 'trusted': False}


def test_trust_round_trips_and_can_be_revoked(client, tmp_path):
    assert trust(client, tmp_path).json()['trusted'] is True
    assert client.get('/chat/tools/trust', params={'cwd': str(tmp_path)}).json()['trusted'] is True
    assert trust(client, tmp_path, False).json()['trusted'] is False
    assert client.get('/chat/tools/trust', params={'cwd': str(tmp_path)}).json()['trusted'] is False


def test_trust_applies_only_to_registered_workspaces(client, tmp_path_factory):
    stranger = tmp_path_factory.mktemp('stranger')
    response = trust(client, stranger)
    assert response.status_code == 400 and response.json()['error'] == 'no-workspace'
    assert client.get('/chat/tools/trust', params={'cwd': str(stranger)}).status_code == 400


def test_trust_is_per_workspace(client, tmp_path, tmp_path_factory):
    other = tmp_path_factory.mktemp('other')
    client.post('/cowork/projects', json={'name': 'Other', 'rootPath': str(other)})
    trust(client, tmp_path)
    assert client.get('/chat/tools/trust', params={'cwd': str(other)}).json()['trusted'] is False


@pytest.mark.parametrize('payload', [{'cwd': 'x', 'trusted': 'yes'}, {'cwd': 'x', 'trusted': 1}, {'cwd': 'x'}, {'trusted': True},
                                     {'cwd': 'x', 'trusted': True, 'extra': 1}, {'cwd': '', 'trusted': True}])
def test_invalid_trust_updates_are_400(client, payload):
    response = client.put('/chat/tools/trust', json=payload)
    assert response.status_code == 400 and response.json()['error'] == 'invalid_argument'


def test_a_run_reports_the_stored_trust_of_its_workspace(client, tmp_path):
    assert capabilities(client, tmp_path)['workspace_trusted'] is False
    trust(client, tmp_path)
    assert capabilities(client, tmp_path)['workspace_trusted'] is True
    trust(client, tmp_path, False)
    assert capabilities(client, tmp_path)['workspace_trusted'] is False


def test_a_run_request_cannot_claim_trust(client, tmp_path):
    response = client.post('/execute/direct', json={'instruction': '', 'mode': 'mock', 'cwd': str(tmp_path),
        'tools': {'thread_id': THREAD, 'workspace_trusted': True, 'preset': {'name': 'discover'}}})
    assert response.status_code == 400 and response.json()['error'] == 'invalid_argument'
