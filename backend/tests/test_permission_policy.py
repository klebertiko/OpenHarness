"""Pure policy seam for the chat permission mode: decide(mode, call, workspace)."""
import os
import subprocess
import sys

import pytest

from sandbox.permission import MODES, decide, effective_mode
from sandbox.schemas import Discover, Exec, Read


def ex(*argv, cwd='.'):
    return Exec(argv=list(argv), cwd=cwd)


@pytest.fixture()
def ws(tmp_path):
    (tmp_path / 'sub').mkdir()
    (tmp_path / 'notes.txt').write_text('x', encoding='utf-8')
    return tmp_path


def link_dir_or_skip(link, target):
    """Directory symlink; on Windows without symlink rights, fall back to a junction (same resolve() semantics)."""
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except (OSError, NotImplementedError):
        pass
    if os.name == 'nt':
        done = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(target)], capture_output=True)
        if done.returncode == 0:
            return
    pytest.skip('neither symlinks nor junctions are available on this machine')


# -- modes other than auto_workspace ----------------------------------------
def test_modes_are_exactly_the_three_and_there_is_no_bypass():
    assert MODES == ('plan', 'ask', 'auto_workspace')


def test_ask_mode_asks_for_every_exec(ws):
    assert decide('ask', ex('git', 'status'), ws) == 'ask'
    assert decide('ask', ex('pytest'), ws) == 'ask'


def test_plan_mode_denies_exec_even_without_workspace(ws):
    assert decide('plan', ex('git', 'status'), ws) == 'deny'
    assert decide('plan', ex('git', 'status'), None) == 'deny'


@pytest.mark.parametrize('mode', ['plan', 'ask', 'auto_workspace'])
def test_read_only_tools_are_not_gated_by_the_mode(mode, ws):
    assert decide(mode, Read(path='notes.txt'), ws) == 'allow'
    assert decide(mode, Discover(), ws) == 'allow'


@pytest.mark.parametrize('mode', [None, '', 'bypass', 'AUTO_WORKSPACE', 'auto', 'yolo', 7, ['plan']])
def test_unknown_mode_falls_back_to_ask(mode, ws):
    assert decide(mode, ex('git', 'status'), ws) == 'ask'


# -- auto_workspace: what may run without a person ---------------------------
@pytest.mark.parametrize('argv', [('git', 'status'), ('git', 'diff', '--stat'), ('pytest', '-q'), ('npm', 'test'),
                                  ('npm', 'run', 'lint'), ('ls', 'sub'), ('cat', 'notes.txt'), ('tsc', '--noEmit')])
def test_auto_allows_ordinary_commands_inside_the_workspace(argv, ws):
    assert decide('auto_workspace', ex(*argv), ws) == 'allow'


def test_auto_allows_a_cwd_that_is_a_subdirectory(ws):
    assert decide('auto_workspace', ex('pytest', cwd='sub'), ws) == 'allow'


def test_auto_without_workspace_asks():
    assert decide('auto_workspace', ex('git', 'status'), None) == 'ask'


def test_auto_with_missing_workspace_directory_asks(tmp_path):
    assert decide('auto_workspace', ex('git', 'status'), tmp_path / 'gone') == 'ask'


@pytest.mark.parametrize('cwd', ['..', '../sibling', 'sub/../..', 'C:/', 'C:\\Windows', '/etc', '\\\\host\\share', 'nope', 'notes.txt'])
def test_auto_asks_when_cwd_leaves_or_misses_the_workspace(cwd, ws):
    assert decide('auto_workspace', ex('git', 'status', cwd=cwd), ws) == 'ask'


def test_auto_asks_when_cwd_is_a_symlink_out_of_the_workspace(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('outside')
    link_dir_or_skip(ws / 'escape', outside)
    assert decide('auto_workspace', ex('git', 'status', cwd='escape'), ws) == 'ask'


@pytest.mark.parametrize('arg', ['../secret', 'sub/../../secret', '..', '..\\secret', '--out=../x', '--file=sub/../../x',
                                 '/etc/passwd', 'C:\\Users\\x', 'c:/x', '\\\\host\\share\\f', '~/.ssh/id_rsa', '~',
                                 'file:///etc/passwd', 'https://example.com/x'])
def test_auto_asks_when_an_argument_escapes_the_workspace_or_reaches_the_network(arg, ws):
    assert decide('auto_workspace', ex('cat', arg), ws) == 'ask'


def test_auto_asks_when_an_argument_is_a_symlink_out_of_the_workspace(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('outside2')
    (outside / 'secret.txt').write_text('s', encoding='utf-8')
    link_dir_or_skip(ws / 'linked', outside)
    assert decide('auto_workspace', ex('cat', 'linked/secret.txt'), ws) == 'ask'


@pytest.mark.parametrize('program', ['sh', 'bash', 'zsh', 'dash', 'cmd', 'cmd.exe', 'CMD.EXE', 'powershell', 'powershell.exe', 'pwsh',
                                     'wsl', 'python', 'python3', 'python3.12', 'py', 'pythonw.exe', 'node', 'node.exe', 'deno', 'bun',
                                     'ruby', 'perl', 'php', 'osascript', 'wscript', 'mshta', 'env', 'sudo', 'xargs', 'nohup', 'start',
                                     sys.executable])
def test_auto_never_runs_shells_interpreters_or_launchers(program, ws):
    assert decide('auto_workspace', ex(program, '-c', 'print(1)'), ws) == 'ask'


@pytest.mark.parametrize('program', ['rm', 'rmdir', 'del', 'erase', 'rd', 'format', 'mkfs', 'dd', 'shred', 'chmod', 'chown',
                                     'icacls', 'diskpart', 'reg', 'taskkill', 'kill', 'shutdown'])
def test_auto_never_runs_destructive_programs(program, ws):
    assert decide('auto_workspace', ex(program, 'notes.txt'), ws) == 'ask'


@pytest.mark.parametrize('program', ['curl', 'wget', 'iwr', 'Invoke-WebRequest', 'ssh', 'scp', 'nc', 'ncat', 'telnet', 'certutil', 'ftp',
                                     'npx', 'pnpx', 'bunx'])
def test_auto_never_runs_network_fetchers(program, ws):
    assert decide('auto_workspace', ex(program, 'notes.txt'), ws) == 'ask'


@pytest.mark.parametrize('argv', [('npm', 'install'), ('npm', 'i', 'left-pad'), ('npm', 'exec', 'x'), ('npm', 'publish'), ('npm',),
                                  ('pnpm', 'dlx', 'x'), ('yarn', 'add', 'x'), ('git', 'push'), ('git', 'clone', 'x'),
                                  ('git', 'reset', '--hard'), ('git', '-c', 'core.pager=x', 'log'), ('git', 'diff', '--output=x'),
                                  ('git',)])
def test_auto_asks_for_package_manager_and_git_subcommands_outside_the_allowlist(argv, ws):
    assert decide('auto_workspace', ex(*argv), ws) == 'ask'


@pytest.mark.parametrize('program', ['./run.sh', 'bin/tool', '.\\tool.exe', 'sub/pytest', '../pytest', '/usr/bin/git', 'C:\\Git\\git.exe'])
def test_auto_requires_a_bare_program_name(program, ws):
    assert decide('auto_workspace', ex(program, 'status'), ws) == 'ask'


def test_auto_asks_when_a_known_risk_pattern_is_present(ws):
    assert decide('auto_workspace', ex('echo', 'rm -rf build'), ws) == 'ask'


# -- effective mode: a request can only tighten the stored mode ---------------
@pytest.mark.parametrize('stored,requested,expected', [
    ('ask', 'auto_workspace', 'ask'), ('plan', 'auto_workspace', 'plan'), ('plan', 'ask', 'plan'),
    ('auto_workspace', 'ask', 'ask'), ('auto_workspace', 'plan', 'plan'), ('auto_workspace', None, 'auto_workspace'),
    ('auto_workspace', 'auto_workspace', 'auto_workspace'), (None, 'auto_workspace', 'ask'), (None, None, 'ask'),
    ('bypass', 'auto_workspace', 'ask'), ('auto_workspace', 'bypass', 'ask'), ('', 'plan', 'plan'),
])
def test_effective_mode_is_never_laxer_than_stored_or_requested(stored, requested, expected):
    assert effective_mode(stored, requested) == expected
