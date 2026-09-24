"""BDD over real HTTP and a restarted sidecar, run only in an isolated checkout.

OH_ISOLATED_E2E=1 enables this suite. Only the external model is a local fixture;
the resolver, streaming router, database, authentication and history are real.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("OH_ISOLATED_E2E") != "1", reason="requires isolated E2E checkout"
)


@pytest.fixture()
def sidecar(tmp_path):
    assert (Path(__file__).resolve().parents[3] / '.git').is_file(), 'E2E requires a linked isolated worktree'
    # Refuse an occupied integration port; never stop somebody else's server.
    with socket.socket() as check:
        check.bind(("127.0.0.1", 8001))
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'e2e.db').as_posix()}",
           "OH_SECRETS": "memory", "OH_SIDECAR_TOKEN": "isolated-e2e-token"}
    process = None
    log = (tmp_path / "server.log").open("w", encoding="utf-8")
    client = httpx.Client(base_url="http://127.0.0.1:8001", timeout=10,
                         headers={"Authorization": "Bearer isolated-e2e-token"})

    def stop():
        nonlocal process
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process = None

    def start():
        nonlocal process
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"],
            cwd=Path(__file__).resolve().parents[2], env=env, stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            assert process.poll() is None, "isolated sidecar exited; inspect server.log"
            try:
                if client.get("/health").status_code == 200:
                    return
            except httpx.TransportError:
                pass
            time.sleep(0.05)
        pytest.fail("isolated sidecar did not become healthy")

    def restart():
        stop()
        start()

    try:
        start()
        yield client, restart
    finally:
        stop()
        client.close()
        log.close()


@pytest.fixture()
def model_server():
    release = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert self.path == "/v1/chat/completions"
            prompt = payload["messages"][-1]["content"]
            self.send_response(401 if prompt == "fail" else 200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if prompt == "fail":
                return
            chunk = {"choices": [{"delta": {"content": "persistent HTTP response"}}]}
            try:
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()
                if prompt == "hold":
                    extra = {'choices': [{'delta': {'content': ' and a second chunk'}}]}
                    self.wfile.write(f'data: {json.dumps(extra)}\n\n'.encode())
                    self.wfile.flush()
                    release.wait(timeout=15)
                self.wfile.write(b"data: [DONE]\n\n")
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1"
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def register(client, endpoint):
    response = client.post("/providers/connections", json={
        "id": "e2e-local", "provider": "ollama", "label": "Isolated model fixture",
        "residence": "local", "enabled": True, "endpoint": endpoint, "defaultModel": "fixture-model",
    })
    assert response.status_code == 201


def test_given_completed_direct_run_when_server_restarts_then_history_survives(sidecar, model_server):
    client, restart = sidecar
    register(client, model_server)
    response = client.post("/execute/direct", json={
        "instruction": "reply", "mode": "local", "connection_id": "e2e-local",
    })
    assert response.status_code == 200
    run_id = response.headers["X-Execution-Id"]
    before = client.get(f"/execute/logs/{run_id}").json()
    assert before["status"] == "complete"
    done = next(e["data"] for e in before["result"]["events"] if e["event"] == "node_done")
    assert done["output"] == "persistent HTTP response"
    assert done["connection_id"] == "e2e-local" and done["provider_verified"] is True
    restart()
    assert client.get(f"/execute/logs/{run_id}").json() == before
    assert any(r["id"] == run_id and r["source"] == "direct" for r in client.get("/execute/logs").json())


@pytest.mark.parametrize("action", ["stop", "disconnect"])
def test_given_running_direct_stream_when_interrupted_then_history_is_stopped(sidecar, model_server, action):
    client, _ = sidecar
    register(client, model_server)
    with client.stream("POST", "/execute/direct", json={
        "instruction": "hold", "mode": "local", "connection_id": "e2e-local",
    }) as response:
        assert response.status_code == 200
        run_id = response.headers["X-Execution-Id"]
        lines = response.iter_lines()
        for line in lines:
            if "and a second chunk" in line:
                break
        running = client.get(f"/execute/logs/{run_id}").json()
        assert running["status"] == "running" and running["source"] == "direct"
        assert running['result'] == {'source': 'direct', 'events': []}
        assert running['finished_at'] is None
        if action == "stop":
            assert client.post(f"/execute/{run_id}/control", json={"action": "stop"}).status_code == 200
            list(lines)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        history = client.get(f"/execute/logs/{run_id}").json()
        if history["status"] != "running":
            break
        time.sleep(0.05)
    assert history["status"] == "stopped"
    assert history["finished_at"] is not None
    assert next(e["data"] for e in history["result"]["events"] if e["event"] == "harness_done")["status"] == "stopped"
    stopped = next(e['data'] for e in history['result']['events'] if e['event'] == 'run_stopped')
    assert stopped == {'at_node': 'direct'}
    terminal = next(e['data'] for e in history['result']['events'] if e['event'] == 'harness_done')
    assert terminal['total_tokens'] == len('persistent HTTP response and a second chunk') // 4
    assert terminal['nodes_run'] == 0
    assert 0 < terminal['elapsed_ms'] < 20000
    assert not any(e["data"].get("provider_verified") for e in history["result"]["events"])
    assert not any(r["run_id"] == run_id for r in client.get("/execute/active").json())
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        summary = client.get('/usage/summary').json()
        if summary['totalTokens']:
            break
        time.sleep(.02)
    assert summary['bySource'][0]['source'] == 'direct'
    assert summary['bySource'][0]['tokensTotal'] == terminal['total_tokens']
    assert summary['byConnection'][0]['provider'] == 'ollama'
    assert summary['byConnection'][0]['connectionId'] == 'e2e-local'
