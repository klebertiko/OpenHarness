"""Real sidecar, SSE, process and SQLite; only the external model is scripted."""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from test_direct_history_e2e import sidecar, register

pytestmark = pytest.mark.skipif(os.environ.get('OH_ISOLATED_E2E') != '1', reason='requires isolated E2E checkout')


def stream_events(response):
    name = None
    for line in response.iter_lines():
        if line.startswith('event: '):
            name = line[7:]
        elif line.startswith('data: '):
            yield {'event': name, 'data': json.loads(line[6:])}


def project(client, tmp_path):
    assert client.post('/cowork/projects', json={'name':'E2E tools','rootPath':str(tmp_path)}).status_code == 201


def body(tmp_path, argv, **extra):
    return {'instruction':'', 'mode':'local', 'connection_id':'e2e-local', 'cwd':str(tmp_path),
            'tools':{'enabled':True,'preset':{'name':'exec','argv':argv, **extra},'summarize':False}}


@pytest.fixture()
def provider():
    requests=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_POST(self):
            payload=json.loads(self.rfile.read(int(self.headers['Content-Length']))); requests.append(payload)
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            if len(requests)==1:
                delta={'tool_calls':[{'index':0,'id':'model-read','type':'function','function':{'name':'read_file','arguments':'{"path":"README.md"}'}}]}
            else:
                delta={'content':'I read the real file.'}
            chunks=[{'choices':[{'delta':delta}]},{'choices':[],'usage':{'total_tokens':10}}]
            self.wfile.write((''.join('data: '+json.dumps(c)+'\n\n' for c in chunks)+'data: [DONE]\n\n').encode())
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    try: yield f'http://127.0.0.1:{server.server_port}/v1',requests
    finally: server.shutdown(); server.server_close(); thread.join(timeout=5)


@pytest.mark.parametrize('decision',['approve','reject'])
def test_exec_approval_identity_and_replay(sidecar,provider,tmp_path,decision):
    client,_=sidecar; endpoint,requests=provider
    register(client,endpoint); project(client,tmp_path)
    argv=[sys.executable,'-c',"open('ran','w').write('yes'); print('sk-abcdefghijklmnopqrstuvwxyz0123')"]
    with client.stream('POST','/execute/direct',json=body(tmp_path,argv)) as response:
        assert response.status_code==200
        run_id=response.headers['X-Execution-Id']; observed=[]
        for event in stream_events(response):
            observed.append(event)
            if event['event']=='tool_approval_required':
                assert not (tmp_path/'ran').exists()
                assert argv==event['data']['args']['argv']
                mismatch=client.post(f'/execute/{run_id}/control',json={'action':'resume','decision':'approve','call_id':'wrong'})
                assert mismatch.status_code==409 and mismatch.json()['error']=='call_id_mismatch'
                approved=client.post(f'/execute/{run_id}/control',json={'action':'resume','decision':decision,
                    'call_id':event['data']['call_id'],'note':'token sk-abcdefghijklmnopqrstuvwxyz9999'})
                assert approved.status_code==200
    assert (tmp_path/'ran').exists()==(decision=='approve')
    assert not requests
    assert any(e['event']==('tool_result' if decision=='approve' else 'tool_denied') for e in observed)
    history=client.get('/execute/logs/'+run_id).json()
    assert history['status']=='complete'
    assert 'sk-abcdefghijklmnopqrstuvwxyz' not in json.dumps(history)
    assert any(e['event']=='tool_approval_decision' and '[redacted:' in e['data']['note'] for e in history['result']['events'])
    done=next(e['data'] for e in observed if e['event']=='node_done')
    assert done['tokens']==0 and done['provider_verified'] is False


@pytest.mark.parametrize('interrupt',['timeout','stop','disconnect'])
def test_exec_interrupt_reaps_child(sidecar,provider,tmp_path,interrupt):
    client,_=sidecar; endpoint,_=provider
    register(client,endpoint); project(client,tmp_path)
    child_code="import os,time; open('grandchild.pid','w').write(str(os.getpid())); time.sleep(30)"
    argv=[sys.executable,'-c',f"import os,time,subprocess,sys; open('child.pid','w').write(str(os.getpid())); subprocess.Popen([sys.executable,'-c',{child_code!r}]); time.sleep(30)"]
    observed=[]
    with client.stream('POST','/execute/direct',json=body(tmp_path,argv,timeout_s=1 if interrupt=='timeout' else 60)) as response:
        run_id=response.headers['X-Execution-Id']
        for event in stream_events(response):
            observed.append(event)
            if event['event']=='tool_approval_required':
                client.post(f'/execute/{run_id}/control',json={'action':'resume','decision':'approve','call_id':event['data']['call_id']})
                deadline=time.monotonic()+4
                while not (tmp_path/'grandchild.pid').exists() and time.monotonic()<deadline: time.sleep(.02)
                assert (tmp_path/'grandchild.pid').exists()
                if interrupt=='stop': client.post(f'/execute/{run_id}/control',json={'action':'stop'})
                elif interrupt=='disconnect': break
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        history=client.get('/execute/logs/'+run_id).json()
        if history['status']!='running': break
        time.sleep(.05)
    assert history['status']==('complete' if interrupt=='timeout' else 'stopped')
    for name in ('child.pid', 'grandchild.pid'):
        assert_dead(int((tmp_path/name).read_text()))
    if interrupt=='timeout':
        result=next(e['data'] for e in observed if e['event']=='tool_result')
        assert result['timed_out'] is True and result['exit_code'] is None


def assert_dead(pid):
    if os.name=='nt':
        import ctypes
        handle=ctypes.windll.kernel32.OpenProcess(0x1000,False,pid)
        if handle:
            code=ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(handle,ctypes.byref(code))
            ctypes.windll.kernel32.CloseHandle(handle)
            assert code.value!=259
    else:
        with pytest.raises(ProcessLookupError): os.kill(pid,0)


def test_http_model_reads_workspace_and_receives_tool_message(sidecar,provider,tmp_path):
    client,_=sidecar; endpoint,requests=provider
    register(client,endpoint); project(client,tmp_path)
    (tmp_path/'README.md').write_text('actual local bytes',encoding='utf-8')
    response=client.post('/execute/direct',json={'instruction':'read workspace','mode':'local','connection_id':'e2e-local',
        'cwd':str(tmp_path),'tools':{'enabled':True}})
    assert response.status_code==200
    assert len(requests)==2
    assert requests[-1]['messages'][-1]['role']=='tool'
    assert 'actual local bytes' in requests[-1]['messages'][-1]['content']
    history=client.get('/execute/logs/'+response.headers['X-Execution-Id']).json()
    assert history['status']=='complete'
    assert any(e['event']=='tool_result' and e['data']['result']=='actual local bytes' for e in history['result']['events'])
    done=next(e['data'] for e in history['result']['events'] if e['event']=='node_done')
    assert done['tokens']==20 and done['provider_verified'] is True
