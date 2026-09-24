import json
import pytest
from pytest_bdd import scenario, given, when, then
from fastapi.testclient import TestClient
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_shared import CliRunResult
from main import app
from test_chat_tools_presets import events


@scenario('features/chat-tools-exec.feature', 'CLI adapters keep their locked argv')
def test_cli_tools_remain_locked(): pass


@pytest.fixture()
def state(tmp_path, monkeypatch):
    state = {'root':tmp_path,'calls':[]}
    async def runner(argv, **kwargs):
        state['calls'].append((argv,kwargs))
        return CliRunResult(0,json.dumps({'result':'response','usage':{'input_tokens':2,'output_tokens':3}}),'')
    adapter = ClaudeCliAdapter(runner=runner)
    monkeypatch.setattr('providers.resolution.get_adapter',lambda name:adapter)
    monkeypatch.setattr('adapters.cli_claude.find_cli',lambda name:'claude.exe')
    with TestClient(app) as client:
        state['client']=client
        yield state


@given('a Cowork project registered with rootPath "<tmp>/ws"')
def workspace(state):
    assert state['client'].post('/cowork/projects',json={'name':'CLI BDD','rootPath':str(state['root'])}).status_code==201


@given('a live HTTP connection backed by the fake OpenAI-compatible provider')
def replaced_background(state):
    # This scenario explicitly replaces the feature's HTTP connection with a CLI below.
    pass


@given('a connection using the claude CLI adapter')
def cli(state):
    app.state.provider_connections['cli-bdd']={'id':'cli-bdd','provider':'anthropic','enabled':True,'residence':'local'}


@when('I POST /execute/direct with instruction "hi" and tools.enabled true')
def run(state):
    response=state['client'].post('/execute/direct',json={'instruction':'hi','mode':'local','connection_id':'cli-bdd','cwd':str(state['root']),'tools':{'enabled':True}})
    assert response.status_code==200
    state['events']=events(response)


@then('the SSE stream emits "capabilities" with reason "cli-adapter" and tools.exec false')
def capabilities(state):
    caps=next(e['data'] for e in state['events'] if e['event']=='capabilities')
    assert caps['reason']=='cli-adapter' and caps['tools']['exec'] is False


@then('the spawned argv contains "--tools" followed by ""')
def tools_locked(state):
    argv=state['calls'][0][0]
    assert argv[argv.index('--tools')+1]==''


@then('the spawned argv contains "--strict-mcp-config"')
def mcp_locked(state):
    argv,kwargs=state['calls'][0]
    assert '--strict-mcp-config' in argv
    assert str(kwargs['cwd'])==str(state['root'])
    assert 'hi' not in argv and 'hi' in kwargs['stdin']
