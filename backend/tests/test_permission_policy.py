"""Pure policy seam for the chat permission mode: decide(mode, call, workspace, trusted)."""
import os
import subprocess
import sys

import pytest

from sandbox.permission import MODES, decide, effective_mode, hardened_git
from sandbox.schemas import Discover, Exec, Read

SAFE_GIT_CONFIG = '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://example.com/x.git\n[branch "main"]\n\tremote = origin\n'


def ex(*argv, cwd='.'):
    return Exec(argv=list(argv), cwd=cwd)


@pytest.fixture()
def ws(tmp_path):
    (tmp_path / 'sub').mkdir()
    (tmp_path / 'notes.txt').write_text('x', encoding='utf-8')
    (tmp_path / '.git').mkdir()
    (tmp_path / '.git' / 'config').write_text(SAFE_GIT_CONFIG, encoding='utf-8')
    return tmp_path


def auto(call, workspace, trusted=False):
    return decide('auto_workspace', call, workspace, trusted=trusted)


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
    assert decide('ask', ex('pytest'), ws, trusted=True) == 'ask'


def test_plan_mode_denies_exec_even_without_workspace(ws):
    assert decide('plan', ex('git', 'status'), ws) == 'deny'
    assert decide('plan', ex('git', 'status'), None) == 'deny'


@pytest.mark.parametrize('mode', ['plan', 'ask', 'auto_workspace'])
def test_read_only_tools_are_not_gated_by_the_mode(mode, ws):
    assert decide(mode, Read(path='notes.txt'), ws) == 'allow'
    assert decide(mode, Discover(), ws) == 'allow'


@pytest.mark.parametrize('mode', [None, '', 'bypass', 'AUTO_WORKSPACE', 'auto', 'yolo', 7, ['plan']])
def test_unknown_mode_falls_back_to_ask(mode, ws):
    assert decide(mode, ex('git', 'status'), ws, trusted=True) == 'ask'


# -- auto_workspace, untrusted workspace: only read-only git and listings ----
@pytest.mark.parametrize('argv', [('git', 'status'), ('git', 'status', '--porcelain', '-b'), ('git', 'diff', '--stat'), ('git', 'diff', 'HEAD~1', '--', 'notes.txt'),
                                  ('git', 'log', '--oneline', '-5'), ('git', 'log', 'main..feature'), ('git', 'show', 'HEAD'),
                                  ('git', 'rev-parse', '--show-toplevel'), ('git', 'ls-files'), ('git', '--version'),
                                  ('ls',), ('ls', 'sub'), ('ls', '-la'), ('pwd',)])
def test_auto_allows_read_only_commands_in_an_untrusted_workspace(argv, ws):
    assert auto(ex(*argv), ws) == 'allow'


def test_auto_allows_a_cwd_that_is_a_subdirectory(ws):
    assert auto(ex('ls', cwd='sub'), ws) == 'allow'


def test_auto_without_workspace_asks():
    assert auto(ex('git', 'status'), None) == 'ask'


def test_auto_with_missing_workspace_directory_asks(tmp_path):
    assert auto(ex('git', 'status'), tmp_path / 'gone') == 'ask'


@pytest.mark.parametrize('cwd', ['..', '../sibling', 'sub/../..', 'C:/', 'C:\\Windows', '/etc', '\\\\host\\share', 'nope', 'notes.txt'])
def test_auto_asks_when_cwd_leaves_or_misses_the_workspace(cwd, ws):
    assert auto(ex('ls', cwd=cwd), ws) == 'ask'


def test_auto_asks_when_cwd_is_a_symlink_out_of_the_workspace(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('outside')
    link_dir_or_skip(ws / 'escape', outside)
    assert auto(ex('ls', cwd='escape'), ws) == 'ask'


@pytest.mark.parametrize('arg', ['../secret', 'sub/../../secret', '..', '..\\secret', '--out=../x', '--file=sub/../../x',
                                 '/etc/passwd', 'C:\\Users\\x', 'c:/x', '\\\\host\\share\\f', '~/.ssh/id_rsa', '~',
                                 'file:///etc/passwd', 'https://example.com/x',
                                 # a value glued to a flag, a doubled '=' and mixed separators
                                 '-o../x', '-la../x', '-o/etc/x', '--a=b=../x', '--a=b=/etc/x', 'a=..\\x', 'x:../y'])
def test_auto_asks_when_an_argument_escapes_the_workspace_or_reaches_the_network(arg, ws):
    assert auto(ex('ls', arg), ws) == 'ask'
    assert auto(ex('git', 'diff', arg), ws) == 'ask'


def test_auto_asks_when_an_argument_is_a_symlink_out_of_the_workspace(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp('outside2')
    (outside / 'secret.txt').write_text('s', encoding='utf-8')
    link_dir_or_skip(ws / 'linked', outside)
    assert auto(ex('ls', 'linked/secret.txt'), ws) == 'ask'


# -- git: read-only subcommands only; nothing that can start another program --
@pytest.mark.parametrize('argv', [
    ('git', 'grep', 'needle'), ('git', 'grep', '-Ovim', 'x'), ('git', 'grep', '-O', 'sh', 'x'), ('git', 'grep', '--open-files-in-pager=sh', 'x'),
    ('git', 'blame', 'notes.txt'), ('git',), ('git', 'push'), ('git', 'clone', 'x'), ('git', 'fetch'), ('git', 'reset', '--hard'),
    ('git', 'checkout', 'x'), ('git', 'config', 'core.pager', 'sh'), ('git', 'branch', '-D', 'x'), ('git', 'stash'),
    ('git', '-c', 'core.pager=x', 'log'), ('git', '--exec-path=x', 'log'), ('git', '-C', '..', 'log'),
    ('git', 'diff', '--output=x'), ('git', 'diff', '--ext-diff'), ('git', 'log', '--textconv'), ('git', 'diff', '--no-index', 'a', 'b'),
    ('git', 'log', '--format=%H', '-p'), ('git', 'show', '--pretty=x'), ('git', 'status', '--ignore-submodules=x'),
    ('git', 'diff', '-O', 'orderfile'), ('git', 'diff', '--upload-pack=x'),
])
def test_auto_asks_for_git_that_can_run_other_programs_or_write(argv, ws):
    assert auto(ex(*argv), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('config', [
    '[filter "lfs"]\n\tclean = sh -c x\n', '[diff "x"]\n\ttextconv = sh\n', '[diff]\n\texternal = sh\n', '[core]\n\tfsmonitor = sh\n',
    '[core]\n\thooksPath = ../hooks\n', '[core]\n\tpager = sh\n', '[include]\n\tpath = ../evil\n', '[includeIf "gitdir:/"]\n\tpath = x\n',
    '[merge "x"]\n\tdriver = sh\n', '[core]\n\tsshCommand = sh\n', '[credential]\n\thelper = sh\n',
])
def test_auto_asks_for_git_when_the_repo_config_can_execute_programs(config, ws):
    (ws / '.git' / 'config').write_text(SAFE_GIT_CONFIG + config, encoding='utf-8')
    assert auto(ex('git', 'status'), ws, trusted=True) == 'ask'


def test_auto_asks_for_git_without_a_repo_config_at_the_workspace_root(tmp_path):
    assert auto(ex('git', 'status'), tmp_path) == 'ask'


def test_auto_asks_for_git_when_dot_git_is_a_file(tmp_path):
    (tmp_path / '.git').write_text('gitdir: ../elsewhere', encoding='utf-8')
    assert auto(ex('git', 'status'), tmp_path) == 'ask'


# -- workspace trust: repo-defined code runs unprompted only when trusted ----
@pytest.mark.parametrize('argv', [('npm', 'test'), ('npm', 'run', 'lint'), ('npm', 'run-script', 'build'), ('pnpm', 'test'), ('pnpm', 'run', 'x'),
                                  ('yarn', 'test'), ('yarn', 'run', 'build:prod'), ('pytest',), ('pytest', '-q'), ('pytest', '-q', '-x', 'tests/test_a.py::test_b')])
def test_project_scripts_ask_until_the_workspace_is_trusted(argv, ws):
    assert auto(ex(*argv), ws, trusted=False) == 'ask'
    assert auto(ex(*argv), ws, trusted=True) == 'allow'


@pytest.mark.parametrize('argv', [
    ('npm', 'test', '--script-shell=bash'), ('npm', 'test', '--node-options=--require=x'), ('npm', 'test', '--'), ('npm', 'test', 'x'),
    ('npm', 'run', 'lint', '--', '--fix'), ('npm', 'run', 'lint', '--script-shell=sh'), ('npm', 'run', '--script-shell=sh', 'lint'),
    ('npm', 'run'), ('npm', 'run', '-x'), ('npm', 'run', 'a', 'b'), ('npm', 'run', '../x'), ('npm', 'run', 'a;b'),
    ('pnpm', 'test', '--x'), ('yarn', 'test', 'x'), ('npm', '--version', 'x'), ('npm', 'ls'), ('npm', 'exec', 'x'),
    ('npm', 'install'), ('npm', 'i', 'left-pad'), ('npm', 'publish'), ('npm',), ('pnpm', 'dlx', 'x'), ('yarn', 'add', 'x'), ('yarn',),
    ('pytest', '-p', 'evil'), ('pytest', '-c', 'x.ini'), ('pytest', '--rootdir=/x'), ('pytest', '--basetemp=../x'), ('pytest', '--pyargs', 'os'),
    ('pytest', '-o', 'x=y'), ('pytest', '-qp', 'evil'), ('pytest', '--import-mode=x'), ('pytest', '--confcutdir=..'),
])
def test_project_scripts_never_take_flags_or_extra_arguments(argv, ws):
    assert auto(ex(*argv), ws, trusted=True) == 'ask'


# -- explicit program allowlist: anything else asks, trusted or not ----------
@pytest.mark.parametrize('program', [
    'wmic', 'msbuild', 'pcalua', 'explorer', 'schtasks', 'forfiles', 'cscript', 'regsvr32', 'installutil', 'cmstp', 'bash', 'sh', 'zsh', 'cmd',
    'cmd.exe', 'CMD.EXE', 'powershell', 'powershell.exe', 'pwsh', 'wsl', 'python', 'python3', 'python3.12', 'py', 'pythonw.exe', 'node', 'node.exe',
    'deno', 'bun', 'ruby', 'perl', 'php', 'osascript', 'env', 'sudo', 'xargs', 'nohup', 'start', 'find', 'make', 'tsc', 'cargo', 'go', 'pip', 'uv',
    'cat', 'head', 'tail', 'type', 'echo', 'rm', 'rmdir', 'del', 'format', 'dd', 'chmod', 'icacls', 'reg', 'taskkill', 'kill', 'shutdown', 'mv',
    'curl', 'wget', 'iwr', 'ssh', 'scp', 'nc', 'certutil', 'npx', 'pnpx', 'bunx', 'docker', 'gh', 'az', 'code', 'cursor', 'vim', 'unknown-tool',
    sys.executable,
])
def test_auto_asks_for_every_program_that_is_not_on_the_allowlist(program, ws):
    assert auto(ex(program, 'notes.txt'), ws, trusted=False) == 'ask'
    assert auto(ex(program, 'notes.txt'), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('program', ['./run.sh', 'bin/tool', '.\\tool.exe', 'sub/pytest', '../pytest', '/usr/bin/git', 'C:\\Git\\git.exe', '~/git'])
def test_auto_requires_a_bare_program_name(program, ws):
    assert auto(ex(program, 'status'), ws, trusted=True) == 'ask'


@pytest.mark.parametrize('planted', ['git.exe', 'git.cmd', 'git.bat', 'git', 'GIT.EXE'])
def test_auto_asks_when_the_workspace_can_shadow_the_program(planted, ws):
    # shutil.which() on Windows looks in the current directory first.
    (ws / planted).write_text('', encoding='utf-8')
    assert auto(ex('git', 'status'), ws) == 'ask'


def test_auto_asks_when_the_cwd_can_shadow_the_program(ws):
    (ws / 'sub' / 'pytest.cmd').write_text('', encoding='utf-8')
    assert auto(ex('pytest', cwd='sub'), ws, trusted=True) == 'ask'


# -- hardened git: the neutral configuration the broker runs auto git with ---
def test_hardened_git_disables_repo_controlled_execution(tmp_path):
    argv, env = hardened_git(['git', 'diff', '--stat', 'a.txt'], tmp_path)
    assert argv[0] == 'git'
    pairs = {argv[i + 1] for i, token in enumerate(argv) if token == '-c'}
    assert {'core.fsmonitor=', 'core.pager=cat', 'diff.external=', f'core.hooksPath={os.devnull}'} <= pairs
    assert '--no-pager' in argv and '--no-optional-locks' in argv
    sub = argv.index('diff')
    assert argv.index('--no-ext-diff') > sub and argv.index('--no-textconv') > sub
    assert argv[-2:] == ['--stat', 'a.txt'] and argv.index('--no-textconv') < argv.index('--stat')
    assert env['GIT_CONFIG_NOSYSTEM'] == '1' and env['GIT_CONFIG_GLOBAL'] == os.devnull
    assert env['GIT_PAGER'] == 'cat' and env['GIT_TERMINAL_PROMPT'] == '0' and env['GIT_OPTIONAL_LOCKS'] == '0'
    assert env['GIT_CEILING_DIRECTORIES'] == str(tmp_path.resolve().parent)
    assert 'GIT_EXTERNAL_DIFF' not in env  # the run's environment is scrubbed; nothing inherited reaches git


@pytest.mark.parametrize('sub,diffy', [('status', False), ('rev-parse', False), ('ls-files', False), ('log', True), ('show', True), ('diff', True)])
def test_hardened_git_only_adds_diff_flags_where_the_subcommand_accepts_them(sub, diffy, tmp_path):
    argv, _ = hardened_git(['git', sub], tmp_path)
    assert ('--no-ext-diff' in argv) is diffy and ('--no-textconv' in argv) is diffy


def test_hardened_git_leaves_other_programs_alone(tmp_path):
    assert hardened_git(['ls', '-la'], tmp_path) == (['ls', '-la'], {})


# -- effective mode: a request can only tighten the stored mode ---------------
@pytest.mark.parametrize('stored,requested,expected', [
    ('ask', 'auto_workspace', 'ask'), ('plan', 'auto_workspace', 'plan'), ('plan', 'ask', 'plan'),
    ('auto_workspace', 'ask', 'ask'), ('auto_workspace', 'plan', 'plan'), ('auto_workspace', None, 'auto_workspace'),
    ('auto_workspace', 'auto_workspace', 'auto_workspace'), (None, 'auto_workspace', 'ask'), (None, None, 'ask'),
    ('bypass', 'auto_workspace', 'ask'), ('auto_workspace', 'bypass', 'ask'), ('', 'plan', 'plan'),
])
def test_effective_mode_is_never_laxer_than_stored_or_requested(stored, requested, expected):
    assert effective_mode(stored, requested) == expected


# -- SEC round-2 regression: package-manager `--version` bypasses trust -------
def test_yarn_version_in_untrusted_workspace_must_ask_when_yarnrc_present(ws):
    """Yarn Berry's global shim re-executes the JS named by `yarnPath` in a
    workspace `.yarnrc.yml` for EVERY subcommand, including `--version`.
    `_package_manager_ok` allows `['--version']` regardless of `trusted`, so an
    untrusted repo gets no-prompt code execution. This must be `ask`, not `allow`."""
    (ws / '.yarnrc.yml').write_text('yarnPath: ./.evil.cjs\n', encoding='utf-8')
    (ws / '.evil.cjs').write_text('// repo-controlled code yarn would run\n', encoding='utf-8')
    assert auto(ex('yarn', '--version'), ws, trusted=False) == 'ask'


@pytest.mark.parametrize('argv', [('npm', '--version'), ('npm', '-v'), ('pnpm', '--version'), ('pnpm', '-v'), ('yarn', '--version'), ('yarn', '-v')])
def test_every_package_manager_invocation_needs_trust_even_for_version(argv, ws):
    # npm/pnpm/yarn shims read repo-controlled files (.yarnrc.yml yarnPath, .npmrc...) before any subcommand.
    assert auto(ex(*argv), ws, trusted=False) == 'ask'
    assert auto(ex(*argv), ws, trusted=True) == 'allow'


@pytest.mark.parametrize('where,name', [('.', '.yarnrc.yml'), ('.', '.yarnrc'), ('.', '.YARNRC.YML'), ('sub', '.yarnrc.yml'), ('sub', '.yarnrc')])
@pytest.mark.parametrize('argv', [('yarn', 'test'), ('yarn', 'run', 'build'), ('yarn', '--version')])
def test_yarn_asks_even_in_a_trusted_workspace_when_a_yarnrc_can_redirect_the_binary(where, name, argv, ws):
    (ws / where / name).write_text('yarnPath: ./.evil.cjs', encoding='utf-8')
    cwd = 'sub' if where == 'sub' else '.'
    assert auto(ex(*argv, cwd=cwd), ws, trusted=True) == 'ask'


def test_a_yarnrc_does_not_affect_other_programs(ws):
    (ws / '.yarnrc.yml').write_text('yarnPath: ./.evil.cjs', encoding='utf-8')
    assert auto(ex('npm', 'test'), ws, trusted=True) == 'allow'
    assert auto(ex('git', 'status'), ws) == 'allow'
