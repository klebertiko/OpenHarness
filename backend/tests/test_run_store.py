"""Durable history contracts; conftest isolates DB, token and secrets."""
from fastapi.testclient import TestClient
from main import app


async def start_stream(source):
    from starlette.requests import Request
    from database import SessionLocal
    from routers.execution import run_direct, DirectRequest, run_harness, ExecuteRequest
    request = Request({'type': 'http', 'app': app})
    async with SessionLocal() as db:
        if source == 'direct':
            return await run_direct(DirectRequest(instruction='hello', mode='mock'), request, db)
        return await run_harness(ExecuteRequest(graph_json={'nodes': [], 'edges': []}), request, db)


def test_completed_run_has_ordered_pages_and_recoverable_output():
    with TestClient(app) as client:
        response = client.post('/execute/direct', json={'instruction': 'hello', 'mode': 'mock'})
        run_id = response.headers['X-Execution-Id']
        detail = client.get(f'/execute/logs/{run_id}').json()
        assert detail['coverage'] == 'complete'
        first = client.get(f'/execute/logs/{run_id}/events?limit=2').json()
        second = client.get(f'/execute/logs/{run_id}/events?after={first["next_cursor"]}&limit=2').json()
        assert [e['sequence'] for e in first['events'] + second['events']] == [1, 2, 3, 4]
        artifacts = client.get(f'/execute/logs/{run_id}/artifacts').json()
        artifact = next(a for a in artifacts if a['kind'] == 'node_output')
        assert artifact['kind'] == 'node_output'
        assert artifact['version'] == 1
        saved = client.get(f'/execute/logs/{run_id}/artifacts/{artifact["id"]}').json()
        output = next(e['data']['output'] for e in detail['result']['events'] if e['event'] == 'node_done')
        assert saved['content'] == output
        assert saved['event_sequence'] > 0
    with TestClient(app) as reopened:
        assert reopened.get(f'/execute/logs/{run_id}').json()['coverage'] == 'complete'
        assert reopened.get(f'/execute/logs/{run_id}/artifacts').json() == artifacts


def test_event_is_visible_before_stream_finishes_and_close_is_not_success():
    with TestClient(app) as client:
        response = client.portal.call(start_stream, 'direct')
        run_id = response.headers['X-Execution-Id']
        client.portal.call(anext, response.body_iterator)
        detail = client.get(f'/execute/logs/{run_id}').json()
        assert detail['status'] == 'running'
        assert detail['coverage'] == 'partial'
        assert detail['result']['events'][0]['event'] == 'run_start'
        assert client.get(f'/execute/logs/{run_id}/events').json()['events'][0]['sequence'] == 1
        client.portal.call(response.body_iterator.aclose)
        closed = client.get(f'/execute/logs/{run_id}').json()
        assert closed['status'] != 'complete'
        assert closed['coverage'] == 'partial'


def test_process_exit_keeps_committed_events_and_startup_marks_interrupted():
    import os
    import subprocess
    import sys
    script = '''
import asyncio, os
from main import app
from database import init_db, SessionLocal
from routers.execution import run_direct, DirectRequest
from starlette.requests import Request
async def run():
    await init_db()
    async with SessionLocal() as db:
        response = await run_direct(DirectRequest(instruction='hello'), Request({'type': 'http', 'app': app}), db)
    await anext(response.body_iterator)
    print(response.headers['X-Execution-Id'], flush=True)
    os._exit(0)
asyncio.run(run())
'''
    process = subprocess.run([sys.executable, '-c', script], env=os.environ.copy(), capture_output=True, text=True, timeout=30)
    assert process.returncode == 0, process.stderr
    run_id = process.stdout.strip()
    with TestClient(app) as client:
        detail = client.get(f'/execute/logs/{run_id}').json()
        assert detail['status'] == 'interrupted'
        assert detail['coverage'] == 'partial'
        assert detail['last_sequence'] == 1
        assert detail['result']['events'][0]['event'] == 'run_start'


def test_harness_versions_outputs_redacts_secrets_and_replay_is_read_only(monkeypatch):
    from engine import _sse

    async def stream(*args, **kwargs):
        yield _sse('run_start', {'run_id': kwargs['run_id'], 'order': []})
        yield _sse('node_stream', {'node_id': 'a', 'chunk': 'sk-p'})
        yield _sse('tool_call', {'node_id': 'a', 'name': 'read'})
        yield _sse('node_stream', {'node_id': 'a', 'chunk': 'roj-' + 'x' * 40})
        yield _sse('node_stream', {'node_id': 'a', 'chunk': '\npassword=\n'})
        yield _sse('tool_call', {'node_id': 'a', 'name': 'read'})
        yield _sse('node_stream', {'node_id': 'a', 'chunk': 'opaquevalue12345678\n'})
        yield _sse('node_done', {'node_id': 'a', 'output': 'sk-proj-' + 'x' * 40})
        yield _sse('node_done', {'node_id': 'a', 'output': 'revised'})
        yield _sse('harness_done', {'status': 'complete'})

    monkeypatch.setattr('routers.execution.execute_harness', stream)
    with TestClient(app) as client:
        response = client.post('/execute/', json={'graph_json': {'nodes': [], 'edges': []}})
        run_id = response.headers['X-Execution-Id']
        path = f'/execute/logs/{run_id}'
        detail = client.get(path).json()
        assert detail['coverage'] == 'complete'
        assert 'sk-proj-' not in str(detail)
        text = ''.join(e['data'].get('chunk', '') for e in detail['result']['events'])
        assert 'sk-proj-' not in text
        assert 'sk-proj-' not in response.text
        assert 'opaquevalue12345678' not in response.text
        assert 'opaquevalue12345678' not in str(detail)
        assert 'x' * 40 not in response.text
        artifacts = client.get(path + '/artifacts').json()
        assert [a['version'] for a in artifacts] == [1, 2]
        assert client.get(path + '/artifacts/' + artifacts[1]['id']).json()['content'] == 'revised'
        for _ in range(2):
            assert client.get(path).json() == detail
            assert client.get(path + '/artifacts').json() == artifacts
        assert client.get('/execute/logs/other/artifacts/' + artifacts[0]['id']).status_code == 404
        assert client.get(path + '/events?after=-1').status_code == 422
        assert client.get(path + '/events?limit=501').status_code == 422
        assert client.get(path + '/events?after=500').json()['events'] == []


def test_close_after_output_without_terminal_is_not_success(monkeypatch):
    from adapters.base import AgentAdapter, AdapterResult
    from routers.execution import _parse_sse_chunk

    class Provider(AgentAdapter):
        async def invoke(self, prompt, config):
            return AdapterResult(content='ok')

        async def stream(self, prompt, config):
            yield 'ok'

    monkeypatch.setattr('routers.execution.get_adapter', lambda _: Provider())
    with TestClient(app) as client:
        response = client.portal.call(start_stream, 'direct')
        while True:
            chunk = client.portal.call(anext, response.body_iterator)
            if _parse_sse_chunk(chunk)['event'] == 'node_done':
                break
        client.portal.call(response.body_iterator.aclose)
        detail = client.get('/execute/logs/' + response.headers['X-Execution-Id']).json()
        assert detail['status'] != 'complete'
        assert detail['coverage'] == 'partial'


def test_partial_text_and_tool_chronology_are_durable_before_done(monkeypatch):
    from engine import _sse

    async def stream(*args, **kwargs):
        yield _sse('node_reason', {'node_id': 'a', 'chunk': 'thinking'})
        yield _sse('node_stream', {'node_id': 'a', 'chunk': 'Before tool'})
        yield _sse('tool_call', {'node_id': 'a', 'name': 'read'})
        yield _sse('node_stream', {'node_id': 'a', 'chunk': 'hello worlds'})

    monkeypatch.setattr('routers.execution.execute_harness', stream)
    with TestClient(app) as client:
        response = client.portal.call(start_stream, 'harness')
        run_id = response.headers['X-Execution-Id']
        from routers.execution import _parse_sse_chunk
        while True:
            chunk = client.portal.call(anext, response.body_iterator)
            if _parse_sse_chunk(chunk)['data'].get('chunk', '').startswith('hello world'):
                break
        detail = client.get(f'/execute/logs/{run_id}').json()
        events = detail['result']['events']
        tool_index = next(i for i, e in enumerate(events) if e['event'] == 'tool_call')
        before_tool = events[:tool_index]
        assert ''.join(e['data'].get('chunk', '') for e in before_tool if e['event'] == 'node_reason') == 'thinking'
        assert ''.join(e['data'].get('chunk', '') for e in before_tool if e['event'] == 'node_stream') == 'Before tool'
        assert events[-1]['data']['chunk'].startswith('hello world')
        client.portal.call(response.body_iterator.aclose)
        closed = client.get(f'/execute/logs/{run_id}').json()
        assert ''.join(e['data'].get('chunk', '') for e in closed['result']['events']).endswith('hello worlds')


def test_journal_and_artifact_routes_require_authentication():
    import httpx

    async def unauthenticated():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for path in ('/events', '/artifacts', '/artifacts/id'):
                response = await client.get('/execute/logs/id' + path)
                assert response.status_code == 401

    with TestClient(app) as client:
        client.portal.call(unauthenticated)
