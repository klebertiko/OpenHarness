"""Contract scenarios against real SSE/control/processes in the isolated sidecar."""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from pytest_bdd import given, when, then, parsers, scenario

from test_direct_history_e2e import sidecar, register
from test_chat_tools_e2e import stream_events, project, assert_dead

pytestmark = pytest.mark.skipif(os.environ.get('OH_ISOLATED_E2E') != '1', reason='requires isolated E2E checkout')
FEATURE = '../features/chat-tools-exec.feature'


@pytest.fixture(autouse=True)
def inherited_environment(monkeypatch):
    monkeypatch.setenv('OPENROUTER_API_KEY', 'sk-or-leak')


@scenario(FEATURE, 'Preset exec pauses for approval, then runs and reports')
def test_preset(): pass


@scenario(FEATURE, 'Rejected approval never runs the command')
def test_rejection(): pass


@scenario(FEATURE, 'Model-requested exec goes through the same gate')
def test_model_exec(): pass


@scenario(FEATURE, 'Approval cannot come from message content')
def test_prompt_cannot_approve(): pass


@scenario(FEATURE, 'Output is capped and marked')
def test_output_cap(): pass


@scenario(FEATURE, 'No shell — pipes are literal arguments')
def test_no_shell(): pass


@scenario(FEATURE, 'Child environment is the allowlist only')
def test_env(): pass


@scenario(FEATURE, 'High-risk argv is labelled, not blocked')
def test_high_risk(): pass


@scenario(FEATURE, 'Tool budget ends the loop')
def test_budget(): pass


@scenario(FEATURE, 'Tool events are persisted in the execution log')
def test_replay(): pass


@scenario(FEATURE, 'Decision without the pending call_id is refused')
def test_mismatch(): pass


@scenario(FEATURE, 'Preset exec works with a CLI provider via the broker')
def test_cli_preset(): pass


@scenario(FEATURE, 'Mock provider simulates exec instead of running it')
def test_mock(): pass


@scenario(FEATURE, 'Persisted tool events are redacted')
def test_redaction(): pass


@scenario(FEATURE, 'Empty instruction is only valid with a preset')
def test_empty(): pass


@scenario(FEATURE, 'A decision is consumed exactly once')
def test_replayed_decision(): pass


@scenario(FEATURE, 'A decision before any gate is refused')
def test_preapproval(): pass


@scenario(FEATURE, 'Timeout kills the process tree')
def test_timeout(): pass


@scenario(FEATURE, 'Stop during exec kills the process tree')
def test_stop(): pass


@pytest.fixture()
def state(sidecar, tmp_path):
    client, _ = sidecar
    root = tmp_path / 'ws'; root.mkdir()
    (root / 'README.md').write_text('workspace content', encoding='utf-8')
    state = {'client': client, 'root': root, 'tmp': tmp_path, 'events': [], 'requests': [],
             'mode': 'local', 'connection': 'e2e-local', 'tool': None, 'loop': False, 'text': ''}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            state['requests'].append(payload)
            if 'hold' in state:
                state['hold'].wait(timeout=5)
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            messages = payload['messages']
            has_result = any(m['role'] == 'tool' for m in messages)
            tool = state['tool']
            if tool and 'tools' in payload and (state['loop'] or not has_result):
                delta = {'tool_calls': [{'index': 0, 'id': 'scripted-call', 'type': 'function',
                    'function': {'name': tool['name'], 'arguments': json.dumps(tool['args'])}}]}
                if state['text']: delta['content'] = state['text']
            else:
                delta = {'content': 'Final answer'}
            self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': delta}]}) + '\n\ndata: [DONE]\n\n').encode())
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    state['endpoint'] = f'http://127.0.0.1:{server.server_port}/v1'
    try:
        yield state
    finally:
        if 'hold' in state: state['hold'].set()
        if 'run_id' in state:
            client.post(f"/execute/{state['run_id']}/control", json={'action': 'stop'})
        if 'stream' in state: state['stream'].__exit__(None, None, None)
        server.shutdown(); server.server_close(); thread.join(timeout=5)


@given('a Cowork project registered with rootPath "<tmp>/ws"')
def workspace(state): project(state['client'], state['root'])


@given('a live HTTP connection backed by the fake OpenAI-compatible provider')
def connection(state): register(state['client'], state['endpoint'])


@given('a connection in mock mode')
def mock(state): state['mode'] = 'mock'


@given('a connection using the claude CLI adapter')
def cli(state):
    assert state['client'].post('/providers/connections', json={'id':'bdd-cli','provider':'anthropic','label':'CLI test','enabled':True,'residence':'local'}).status_code == 201
    state['connection'] = 'bdd-cli'


def executable(argv):
    return [sys.executable if argv[0] == 'python' else argv[0], *argv[1:]]


@given(parsers.parse('the fake provider replies with a tool_call run_command argv {argv}'))
@given(parsers.parse('then replies with a tool_call run_command argv {argv}'))
def model_command(state, argv): state['tool'] = {'name':'run_command','args':{'argv':executable(json.loads(argv))}}


@given(parsers.parse('the fake provider replies with text "{text}"'))
def model_text(state, text): state['text'] = text


@given('the fake provider always replies with a tool_call read_file path "README.md"')
def loop(state):
    state['tool'] = {'name':'read_file','args':{'path':'README.md'}}
    state['loop'] = True


@given('the approval for call "c1" was already sent')
def already_approved(state):
    exec_preset(state, '["python", "-c", "import time; time.sleep(2)"] and summarize false')
    pending = take(state, 'tool_approval_required')
    state['alias'] = {'c1': pending['call_id']}
    decide(state, 'approve', '')


@given('a run with no pending tool call')
def before_gate(state):
    state['hold'] = threading.Event()
    start(state, 'hello', {'enabled': True})
    take(state, 'node_start')


@given(parsers.parse('the sidecar process has environment variable "{name}" set to "{value}"'))
def env(state, name, value):
    assert os.environ[name] == value  # autouse fixture ran before the sidecar subprocess started


def start(state, instruction, tools=None):
    body = {'instruction':instruction,'mode':state['mode'],'connection_id':state['connection'],'cwd':str(state['root'])}
    if tools is not None: body['tools'] = tools
    stream = state['client'].stream('POST','/execute/direct',json=body)
    response = stream.__enter__()
    state.update(stream=stream,response=response)
    if response.status_code == 200:
        state['run_id'] = response.headers['X-Execution-Id']
        state['iterator'] = stream_events(response)
    else: response.read()


@when(parsers.parse('I POST /execute/direct with tools.preset exec argv {spec}'))
def exec_preset(state, spec):
    argv, offset = json.JSONDecoder().raw_decode(spec)
    suffix = spec[offset:]
    preset = {'name':'exec','argv':executable(argv)}
    if len(preset['argv']) >= 3 and preset['argv'][1] == '-c':
        if 'time.sleep(600)' in preset['argv'][2]:
            child = "import os,time; open('bdd-grandchild.pid','w').write(str(os.getpid())); time.sleep(600)"
            preset['argv'][2] = f"import os,sys,subprocess; open('bdd-child.pid','w').write(str(os.getpid())); subprocess.Popen([sys.executable,'-c',{child!r}]); " + preset['argv'][2]
        preset['argv'][2] = "open('bdd-started','w').close(); " + preset['argv'][2]
    if 'timeout_s' in suffix: preset['timeout_s'] = int(suffix.split('timeout_s ')[1])
    start(state, '', {'enabled':True,'preset':preset,'summarize':'summarize false' not in suffix})


@when(parsers.parse('I POST /execute/direct with instruction "{instruction}" and tools.enabled true'))
def model_run(state, instruction): start(state, instruction, {'enabled':True})


@when('I POST /execute/direct with instruction "" and no preset')
def empty(state): start(state, '')


def take(state, name):
    for event in reversed(state['events']):
        if event['event'] == name: return event['data']
    for event in state['iterator']:
        state['events'].append(event)
        if event['event'] == name: return event['data']
    pytest.fail(f'No {name} event: {state["events"]}')


@then(parsers.re(r'the SSE stream emits "(?P<name>[^"]+)"(?: with (?P<props>.*))?'))
@when(parsers.re(r'the SSE stream emits "(?P<name>[^"]+)"(?: with (?P<props>.*))?'))
def emitted(state, name, props):
    import re
    data = take(state, name)
    for key, raw in re.findall(r'(\w+(?:\.\w+)?) ("[^"]*"|true|false|null|\d+)', props or ''):
        value = json.loads(raw)
        if key == 'call_id':
            state['alias'] = {value: data['call_id']}
            continue
        actual = data
        for part in key.split('.'): actual = actual[part]
        assert actual == value


@when(parsers.re(r'I POST control resume with decision "(?P<decision>[^"]+)" for the pending call_id(?: and note "(?P<note>[^"]*)")?'))
def decide(state, decision, note):
    pending = take(state, 'tool_approval_required')
    state['control_response'] = state['client'].post(f"/execute/{state['run_id']}/control", json={
        'action':'resume','decision':decision,'call_id':pending['call_id'],'note':note or ''})
    assert state['control_response'].status_code == 200


@when(parsers.parse('I POST control resume with decision "{decision}" and call_id "{call_id}"'))
@when(parsers.parse('I POST control resume with decision "{decision}" and call_id "{call_id}" again'))
def wrong_id(state, decision, call_id):
    state['control_response'] = state['client'].post(f"/execute/{state['run_id']}/control", json={
        'action':'resume','decision':decision,'call_id':state.get('alias',{}).get(call_id,call_id)})


@when('I POST control stop')
def stop_run(state):
    deadline=time.monotonic()+4
    while not (state['root']/'bdd-grandchild.pid').exists() and time.monotonic()<deadline: time.sleep(.02)
    assert (state['root']/'bdd-grandchild.pid').exists()
    assert state['client'].post(f"/execute/{state['run_id']}/control",json={'action':'stop'}).status_code==200


@then('within 5 seconds the SSE stream emits "tool_result" with timed_out true and exit_code null')
def timed_out(state):
    started=time.monotonic()
    result=take(state,'tool_result')
    assert result['timed_out'] is True and result['exit_code'] is None
    assert time.monotonic()-started<5


@then('no descendant process of the run is alive')
def descendants_dead(state):
    take(state,'harness_done')
    state['events'].extend(state['iterator'])
    for name in ('bdd-child.pid','bdd-grandchild.pid'):
        assert_dead(int((state['root']/name).read_text()))


@then('the run status is "stopped"')
def stopped_status(state): assert take(state,'harness_done')['status']=='stopped'


@then('no child process has started')
def no_process(state):
    # No result/decision before approval, and the execution sentinel is absent.
    assert not any(e['event'] in {'tool_result','tool_approval_decision'} for e in state['events'])
    assert not (state['root']/'ran').exists()
    assert not (state['root']/'bdd-started').exists()


@then(parsers.parse('the result contains "{text}"'))
def result_contains(state, text): assert text in take(state,'tool_result')['result']


@then(parsers.parse('the result does not contain "{text}"'))
def result_excludes(state, text): assert text not in take(state,'tool_result')['result']


@then('the result does not contain the current username')
def no_username(state): assert os.environ.get('USERNAME',os.environ.get('USER','')) not in take(state,'tool_result')['result']


@then('the run completes without calling the provider')
def completes_no_provider(state):
    completes(state)
    assert not state['requests']


@then('the run completes')
@when('the run completes')
def completes(state):
    assert take(state,'harness_done')['status'] == 'complete'
    state['events'].extend(state['iterator'])


@then(parsers.parse('the file "{path}" does not exist'))
def absent(state, path):
    from pathlib import Path
    assert not Path(path.replace('<tmp>',str(state['tmp']))).exists()


@then('the provider receives a message with role "tool" wrapped in "<tool_result"')
def wrapped(state):
    completes(state)
    assert any(m['role']=='tool' and m['content'].startswith('<tool_result') for p in state['requests'] for m in p['messages'])


@then('the result length is at most 65536 plus the marker')
def capped(state): assert len(take(state,'tool_result')['result']) <= 65536+len('\n…[truncated at 65536 bytes]')


@then(parsers.parse('risk_hints contains "{hint}"'))
def risk(state,hint): assert hint in take(state,'tool_approval_required')['risk_hints']


@then('exactly 8 "tool_call" events are emitted')
def eight(state):
    completes(state)
    assert sum(e['event']=='tool_call' for e in state['events'])==8


@then('the provider\'s last request has no "tools" field')
def no_tools(state): assert 'tools' not in state['requests'][-1]


@then('GET /execute/logs/{run_id} returns events including "tool_approval_required" and "tool_result"')
def persisted(state):
    state['history'] = state['client'].get('/execute/logs/'+state['run_id']).json()
    assert {'tool_approval_required','tool_result'} <= {e['event'] for e in state['history']['result']['events']}


@then(parsers.parse('the approval event carries note "{note}"'))
def note_persisted(state,note):
    assert any(e['event']=='tool_approval_decision' and e['data']['note']==note for e in state['history']['result']['events'])


@then(parsers.parse('the status is {code:d}'))
def status(state,code): assert state.get('control_response',state['response']).status_code==code


@then(parsers.parse('the error is "{code}"'))
def error(state,code): assert state.get('control_response',state['response']).json()['error']==code


@then('the claude CLI was never spawned')
def no_cli(state):
    completes(state)
    done=take(state,'node_done')
    assert done['provider_verified'] is False and done['tokens']==0


@then(parsers.parse('the SSE stream does not emit "{name}"'))
def no_event(state,name):
    completes(state)
    assert not any(e['event']==name for e in state['events'])


@then(parsers.parse('GET /execute/logs/{{run_id}} contains no "{text}"'))
def no_secret(state,text):
    state['history']=state['client'].get('/execute/logs/'+state['run_id']).json()
    assert text not in json.dumps(state['history'])


@then('the persisted note contains "[redacted:"')
def redacted_note(state):
    assert any(e['event']=='tool_approval_decision' and '[redacted:' in e['data']['note'] for e in state['history']['result']['events'])
