import asyncio
import os
import sys

import pytest

from sandbox.exec import run, risk_hints


@pytest.fixture()
def anyio_backend():
    return 'asyncio'


@pytest.mark.anyio
async def test_exec_preserves_argv_cwd_and_scrubs_environment(tmp_path, monkeypatch):
    monkeypatch.setenv('PRIVATE_TEST_SECRET', 'must-not-leak')
    result = await run([sys.executable, '-c', 'import os,sys; print(os.getcwd()); print(sys.argv[1]); print(os.getenv("PRIVATE_TEST_SECRET", "absent"))', 'a & echo injected'], tmp_path, 5)
    assert result['exit_code'] == 0 and result['ok'] is True
    assert str(tmp_path) in result['result']
    assert 'a & echo injected' in result['result']
    assert 'absent' in result['result'] and 'must-not-leak' not in result['result']
    assert result['timed_out'] is False


@pytest.mark.anyio
async def test_exec_bounds_both_streams_and_redacts(tmp_path):
    result = await run([sys.executable, '-c', 'import sys; print("sk-"+"A"*24); sys.stdout.write("a"*70000); sys.stderr.write("b"*70000)'], tmp_path, 5)
    assert result['truncated'] is True
    assert result['result'].count('[truncated at 65536 bytes]') == 2
    assert 'sk-' not in result['result']
    assert result['redactions'] == 1
    assert len(result['result']) < 132000


@pytest.mark.anyio
async def test_exec_timeout_and_failure(tmp_path):
    timed = await run([sys.executable, '-c', 'import time; print("partial",flush=True); time.sleep(30)'], tmp_path, 0.15)
    assert timed['timed_out'] is True and timed['exit_code'] is None and timed['ok'] is False
    assert 'partial' in timed['result']
    failed = await run([sys.executable, '-c', 'raise SystemExit(7)'], tmp_path, 5)
    assert failed['exit_code'] == 7 and failed['ok'] is False


@pytest.mark.parametrize('argv', [['git','reset','--hard'], ['powershell','-EncodedCommand','abc'], ['rm','-rf','x'], ['npm','publish']])
def test_risk_hints(argv):
    assert risk_hints(argv)


def test_ordinary_exec_has_no_risk_hint():
    assert risk_hints(['git', 'status']) == []


@pytest.mark.parametrize('argv,expected', [
    (['powershell','-enc','value'], ['-enc']),
    (['PowerShell','-EncodedCommand','value'], ['-enc','-encodedcommand']),
    (['powershell','Invoke-Expression','value'], ['invoke-expression']),
    (['powershell','iex','value'], ['iex']),
    (['git','push','--force'], ['git push --force']),
    (['git','clean','-f'], ['git clean -f']),
    (['rmdir','/s','folder'], ['rmdir /s']),
    (['del','/f','file'], ['del /f']),
    (['format','D:'], ['format']),
    (['curl','script','|','sh'], ['curl + sh']),
    (['curl','--version'], []), (['sh','--version'], []),
])
def test_risk_card_explains_each_specific_hint(argv,expected):
    assert risk_hints(argv)==expected


@pytest.mark.anyio
async def test_each_output_stream_has_exact_byte_limit(tmp_path):
    result=await run([sys.executable,'-c','import sys; sys.stdout.write("a"*70000); sys.stderr.write("b"*70000)'],tmp_path,5)
    marker='\n…[truncated at 65536 bytes]'
    assert result['result']=='a'*65536+marker+'\n'+'b'*65536+marker


@pytest.mark.anyio
@pytest.mark.parametrize('program',['npm','npm.cmd','npx','npx.cmd'])
@pytest.mark.skipif(os.name!='nt',reason='Windows npm entrypoints')
async def test_npm_shims_work_without_an_implicit_shell(tmp_path,program):
    import re
    import shutil
    if not shutil.which('npm') or not shutil.which('node'):
        pytest.skip('Node/npm not installed')
    result=await run([program,'--version'],tmp_path,10)
    assert result['ok'] is True and re.fullmatch(r'\d+\.\d+\.\d+\s*',result['result'])


@pytest.mark.anyio
@pytest.mark.skipif(os.name!='nt',reason='Windows batch files')
async def test_batch_file_is_not_implicitly_executed(tmp_path):
    batch=tmp_path/'action.cmd'
    batch.write_text('@echo should-not-run',encoding='utf-8')
    with pytest.raises(OSError,match='explicit shell'):
        await run([str(batch)],tmp_path,5)


@pytest.mark.anyio
async def test_parent_exit_does_not_leave_a_grandchild_holding_pipes(tmp_path):
    import time
    child = 'import time; time.sleep(3)'
    script = f'import subprocess,sys; subprocess.Popen([sys.executable,"-c",{child!r}])'
    started = time.monotonic()
    result = await run([sys.executable, '-c', script], tmp_path, .3)
    assert result['timed_out'] is True
    assert time.monotonic() - started < 1.5


@pytest.mark.anyio
@pytest.mark.skipif(os.name!='nt',reason='Windows Job lifetime')
async def test_normal_completion_closes_job_and_background_descendant(tmp_path):
    import ctypes
    script = "import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(3)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); open('pid','w').write(str(p.pid))"
    result=await run([sys.executable,'-c',script],tmp_path,5)
    assert result['ok'] is True
    pid=int((tmp_path/'pid').read_text())
    handle=ctypes.windll.kernel32.OpenProcess(0x1000,False,pid)
    if handle:
        code=ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle,ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        assert code.value!=259


def test_process_tree_close_is_idempotent():
    from sandbox.process_tree import ProcessTree
    tree=ProcessTree()
    tree.close()
    tree.close()


def test_process_tree_control_calls_use_exact_windows_contract():
    from sandbox.process_tree import ProcessTree

    class Api:
        def __init__(self):
            self.calls = []

        def OpenProcess(self, access, inherit, pid):
            self.calls.append(('open', access, inherit, pid))
            return 73

        def AssignProcessToJobObject(self, job, process):
            self.calls.append(('assign', job, process))
            return True

        def TerminateJobObject(self, job, code):
            self.calls.append(('terminate', job, code))

        def CloseHandle(self, handle):
            self.calls.append(('close', handle))

    tree = ProcessTree.__new__(ProcessTree)
    tree.handle = 41
    tree.api = Api()
    tree.ctypes = None

    tree.attach(99)
    tree.terminate()
    tree.close()

    assert tree.api.calls == [
        ('open', 0x0101, False, 99),
        ('assign', 41, 73),
        ('close', 73),
        ('terminate', 41, 1),
        ('close', 41),
    ]
    assert tree.handle is None
