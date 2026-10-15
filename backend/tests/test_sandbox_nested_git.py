"""A repository nested below the inert root repo must not run anything it defines (issue #121).

The workspace root has a valid, inert ``.git``. A ``sub/`` directory holds a second repository (a work tree, a
work tree registered as a gitlink in the root, or a bare one) whose config, ``info/attributes``,
``.gitattributes`` and hooks name programs; the user's own global git config is hostile too. Each program drops
a marker file. ``git status|diff|log`` runs through the production path (``ToolBroker.call`` -> ``decide`` ->
``hardened_git`` -> ``sandbox.exec.run``) with ``cwd`` in ``sub/``, and no marker may appear.
"""
import asyncio
import os
import shutil
import sys

import pytest

from engine import RunControl
from sandbox import broker as broker_module
from sandbox.exec import run
from sandbox.permission import decide, hardened_git
from sandbox.schemas import Exec, ToolsRequest

pytestmark = pytest.mark.skipif(shutil.which('git') is None, reason='git is not installed')

PAYLOAD = "import pathlib, sys\npathlib.Path(sys.argv[1], sys.argv[2]).write_text('ran', encoding='utf-8')\n"
AUTHOR = 'A <a@example.com> 1700000000 +0000'
# Fixture building must not read the developer's own git configuration.
SETUP_ENV = {'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_TERMINAL_PROMPT': '0'}
KINDS = ['worktree', 'gitlink', 'submodule', 'bare']
COMMANDS = {'status': ['git', 'status'], 'diff': ['git', 'diff'], 'log': ['git', 'log']}


def git(cwd, *args, env=None):
    """Setup-only git, through the same runner the broker uses (no direct subprocess in the tests)."""
    argv = ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', *args]
    result = asyncio.run(run(argv, cwd, 30, env={**SETUP_ENV, **(env or {})}))
    assert result['ok'], f'git {args} failed: {result["result"]}'
    return result['result'].strip()


def posix(path):
    return os.fspath(path).replace('\\', '/')


class Bench:
    """Payload commands, one marker label each, all kept outside the workspace."""

    def __init__(self, tmp_path, name='nested'):
        self.markers = tmp_path / f'markers-{name}'
        self.markers.mkdir()
        self.script = tmp_path / f'payload-{name}.py'
        self.script.write_text(PAYLOAD, encoding='utf-8')

    def cmd(self, label):
        return f'"{posix(sys.executable)}" "{posix(self.script)}" "{posix(self.markers)}" {label}'

    def program(self, label):
        """A single executable path (`gpg.program` is spawned directly, not through a shell)."""
        path = self.script.parent / (self.script.stem + '-' + label)
        path.write_text(f'#!/bin/sh\n{self.cmd(label)}\n', encoding='utf-8', newline='\n')
        path.chmod(0o755)
        return posix(path)

    def fired(self):
        return sorted(entry.name for entry in self.markers.iterdir())

    def reset(self):
        for entry in self.markers.iterdir():
            entry.unlink()


def hostile_config(bench, prefix=''):
    c = bench.cmd
    return (
        '[core]\n'
        f'\tfsmonitor = {c(prefix + "core.fsmonitor")}\n'
        f'\tpager = {c(prefix + "core.pager")}\n'
        f'\tsshCommand = {c(prefix + "core.sshCommand")}\n'
        f'\teditor = {c(prefix + "core.editor")}\n'
        '[safe]\n\tbareRepository = all\n'
        f'[diff]\n\texternal = {c(prefix + "diff.external")}\n'
        f'[diff "d"]\n\ttextconv = {c(prefix + "diff.d.textconv")}\n\tcommand = {c(prefix + "diff.d.command")}\n'
        f'[filter "x"]\n\tprocess = {c(prefix + "filter.process")}\n\trequired = false\n'
        f'[filter "y"]\n\tclean = {c(prefix + "filter.clean")}\n\tsmudge = {c(prefix + "filter.smudge")}\n'
        f'[pager]\n\tstatus = {c(prefix + "pager.status")}\n\tdiff = {c(prefix + "pager.diff")}\n'
        f'\tlog = {c(prefix + "pager.log")}\n'
        f'[log]\n\tshowSignature = true\n[gpg]\n\tprogram = {bench.program(prefix + "gpg.program")}\n'
        f'[credential]\n\thelper = {c(prefix + "credential.helper")}\n'
    )


def plant(bench, repo_dir, git_dir):
    """Make a repository hostile: config, attributes, hooks and a commit that carries a signature."""
    with open(git_dir / 'config', 'a', encoding='utf-8', newline='\n') as handle:
        handle.write(hostile_config(bench))
    attributes = 'b.txt filter=y diff=d\nc.txt filter=x diff=d\n'
    (git_dir / 'info').mkdir(exist_ok=True)
    (git_dir / 'info' / 'attributes').write_text(attributes, encoding='utf-8')
    if repo_dir is not None:
        (repo_dir / '.gitattributes').write_text(attributes, encoding='utf-8')
    hooks = git_dir / 'hooks'
    hooks.mkdir(exist_ok=True)
    for name in ('fsmonitor-watchman', 'post-index-change', 'pre-commit', 'post-checkout', 'reference-transaction',
                 'post-rewrite', 'post-merge', 'pre-push'):
        (hooks / name).write_text(f'#!/bin/sh\n{bench.cmd("hook." + name)}\n', encoding='utf-8', newline='\n')
    # A commit with a gpgsig header: `log.showSignature` makes `git log` start `gpg.program` to verify it.
    pin = {'GIT_DIR': str(git_dir)}
    tree = git(git_dir, 'rev-parse', 'HEAD^{tree}', env=pin)
    parent = git(git_dir, 'rev-parse', 'HEAD', env=pin)
    raw = (f'tree {tree}\nparent {parent}\nauthor {AUTHOR}\ncommitter {AUTHOR}\n'
           'gpgsig -----BEGIN PGP SIGNATURE-----\n \n iQEz\n -----END PGP SIGNATURE-----\n\nsigned nested commit\n')
    carrier = git_dir.parent / 'signed-commit.raw'
    carrier.write_bytes(raw.encode('utf-8'))
    signed = git(git_dir, 'hash-object', '-t', 'commit', '-w', str(carrier), env=pin)
    carrier.unlink()
    git(git_dir, 'update-ref', 'HEAD', signed, env=pin)


def make_seed(tmp_path):
    """A one-commit repository that the bare and submodule kinds clone from."""
    seed = tmp_path / 'seed'
    seed.mkdir()
    git(seed, 'init', '-q')
    for name in ('b.txt', 'c.txt'):
        (seed / name).write_text('one\n', encoding='utf-8')
    git(seed, 'add', 'b.txt', 'c.txt')
    git(seed, 'commit', '-q', '-m', 'nested commit')
    return seed


def make_workspace(tmp_path, kind, bench):
    """Root repo (inert config, one commit, a dirty tracked file, a hostile .gitattributes) plus `sub/` of `kind`."""
    root = tmp_path / 'ws'
    root.mkdir()
    git(root, 'init', '-q')
    (root / 'a.txt').write_text('one\n', encoding='utf-8')
    git(root, 'add', 'a.txt')
    git(root, 'commit', '-q', '-m', 'root commit')
    sub = root / 'sub'
    if kind == 'bare':
        git(tmp_path, 'clone', '-q', '--bare', str(make_seed(tmp_path)), str(sub))
        plant(bench, None, sub)
    elif kind == 'submodule':
        # The real layout: `sub/.git` is a file and the submodule's config lives in the root's `.git/modules/sub`.
        git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', str(make_seed(tmp_path)), 'sub')
        git(root, 'commit', '-q', '-m', 'add submodule')
        plant(bench, sub, root / '.git' / 'modules' / 'sub')
        for name in ('b.txt', 'c.txt'):
            (sub / name).write_text('two\n', encoding='utf-8')
    else:
        sub.mkdir()
        git(sub, 'init', '-q')
        for name in ('b.txt', 'c.txt'):
            (sub / name).write_text('one\n', encoding='utf-8')
        git(sub, 'add', 'b.txt', 'c.txt')
        git(sub, 'commit', '-q', '-m', 'nested commit')
        if kind == 'gitlink':
            # `ignore = none` in the (work tree controlled) .gitmodules must not bring the submodule scan back.
            (root / '.gitmodules').write_text('[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tignore = none\n', encoding='utf-8')
            git(root, 'add', 'sub', '.gitmodules')
            git(root, 'commit', '-q', '-m', 'register nested repo')
        plant(bench, sub, sub / '.git')
        for name in ('b.txt', 'c.txt'):  # same size: git must hash the content (and so run a clean filter)
            (sub / name).write_text('two\n', encoding='utf-8')
    (root / 'a.txt').write_text('two\n', encoding='utf-8')
    # A filter binding in the workspace's own work tree, with no driver defined in anything the verified repo reads.
    (root / '.gitattributes').write_text('a.txt filter=y diff=d\n', encoding='utf-8')
    bench.reset()  # building the fixture may itself trip a hook; only what the broker runs counts
    return root


def run_auto(root, argv, cwd='sub'):
    """The production path: broker -> decide -> hardened_git -> exec.run, in auto_workspace mode."""
    control = RunControl('nested-git')
    broker = broker_module.ToolBroker(str(root), 'ollama', control, ToolsRequest(enabled=True), permission_mode='auto_workspace')

    async def collect():
        return [event async for event in broker.call('exec', {'argv': argv, 'cwd': cwd, 'timeout_s': 30}, origin='preset')]
    return asyncio.run(collect())


def run_unguarded(cwd, argv, env=None):
    """Plain git with no hardening at all: proves the payloads are armed (the repo would run them)."""
    return asyncio.run(run(argv, cwd, 30, env=dict(SETUP_ENV) if env is None else env))


@pytest.fixture(scope='module', params=KINDS)
def nested(request, tmp_path_factory):
    """One workspace per kind for the whole module: the hardened commands are read-only (no optional locks)."""
    tmp = tmp_path_factory.mktemp('nested-' + request.param)
    bench = Bench(tmp)
    return make_workspace(tmp, request.param, bench), bench


@pytest.fixture()
def hostile_global_config(tmp_path, monkeypatch):
    """The user's own ~/.gitconfig names programs too. Returns its bench so a test can see what it ran."""
    home = tmp_path / 'home'
    home.mkdir()
    bench = Bench(tmp_path, 'global')
    (home / '.gitconfig').write_text(hostile_config(bench, 'global.'), encoding='utf-8')
    for name in ('HOME', 'USERPROFILE', 'XDG_CONFIG_HOME'):
        monkeypatch.setenv(name, str(home))
    return bench


@pytest.fixture(params=['empty-tree', 'ignored'])
def attr_source(request, monkeypatch):
    """`GIT_ATTR_SOURCE` as production sets it, or dropped: git < 2.42 does not know the variable."""
    if request.param == 'ignored':
        real = broker_module.hardened_git

        def without_attr_source(argv, root):
            cmd, env = real(argv, root)
            env.pop('GIT_ATTR_SOURCE', None)
            return cmd, env
        monkeypatch.setattr(broker_module, 'hardened_git', without_attr_source)
    return request.param


# -- (1) and (2): nothing the nested repository defines runs, through the production path -------------
@pytest.mark.parametrize('command', sorted(COMMANDS))
def test_nested_repository_programs_never_run_under_auto_approved_git(nested, command, attr_source, hostile_global_config):
    root, bench = nested
    bench.reset()
    assert decide('auto_workspace', Exec(argv=COMMANDS[command], cwd='sub'), root) == 'allow'
    events = run_auto(root, COMMANDS[command])
    assert [e['kind'] for e in events] == ['tool_call', 'tool_auto_approved', 'tool_result']
    result = events[-1]
    assert bench.fired() == [], f'programs of the nested repository ran: {bench.fired()}'
    assert hostile_global_config.fired() == [], f'programs of the global config ran: {hostile_global_config.fired()}'
    assert result['ok'] is True, result['result']
    # The root repository answered, not the nested one.
    if command == 'log':
        assert 'root commit' in result['result'] and 'nested commit' not in result['result']
    else:
        assert 'a.txt' in result['result']


@pytest.mark.parametrize('kind', ['worktree', 'bare'])
def test_the_payloads_are_armed_when_git_runs_unhardened_inside_the_nested_repository(kind, tmp_path):
    bench = Bench(tmp_path)
    root = make_workspace(tmp_path, kind, bench)
    for argv in COMMANDS.values():
        run_unguarded(root / 'sub', argv)
    fired = set(bench.fired())
    assert 'gpg.program' in fired  # `git log` verifying the signed commit (every kind)
    if kind == 'worktree':
        assert {'core.fsmonitor', 'filter.process', 'filter.clean'} <= fired


@pytest.mark.parametrize('kind', ['gitlink', 'submodule'])
def test_the_payloads_are_armed_for_a_submodule_scan_when_git_runs_unhardened(kind, tmp_path):
    bench = Bench(tmp_path)
    root = make_workspace(tmp_path, kind, bench)
    run_unguarded(root, COMMANDS['status'])  # from the root: git itself starts a status inside the submodule
    assert {'filter.process'} <= set(bench.fired())


def test_the_global_config_payloads_are_armed_when_git_is_not_pinned_away_from_it(tmp_path, hostile_global_config):
    bench = Bench(tmp_path)
    root = make_workspace(tmp_path, 'worktree', bench)
    run_unguarded(root, COMMANDS['status'], env={'GIT_CONFIG_NOSYSTEM': '1'})
    assert 'global.core.fsmonitor' in hostile_global_config.fired()


# -- the argv that keeps git out of nested repositories -----------------------------------
@pytest.mark.parametrize('sub', ['status', 'diff'])
def test_hardened_git_never_lets_git_start_a_status_inside_a_submodule(sub, tmp_path):
    argv, _ = hardened_git(['git', sub, '--stat'] if sub == 'diff' else ['git', sub, '-s'], tmp_path)
    assert '--ignore-submodules=dirty' in argv
    assert argv.index('--ignore-submodules=dirty') == argv.index(sub) + 1


@pytest.mark.parametrize('sub', ['log', 'show', 'rev-parse', 'ls-files', 'describe'])
def test_hardened_git_leaves_commands_that_never_scan_the_work_tree_without_the_submodule_flag(sub, tmp_path):
    argv, _ = hardened_git(['git', sub], tmp_path)
    assert not any(token.startswith('--ignore-submodules') for token in argv)


# -- defense in depth: if the environment pins were ever lost, a bare repo is still not discovered ----------
@pytest.mark.parametrize('command', sorted(COMMANDS))
def test_an_implicit_bare_repository_is_refused_even_if_the_directory_pins_were_lost(command, tmp_path):
    bench = Bench(tmp_path)
    root = make_workspace(tmp_path, 'bare', bench)
    argv, env = hardened_git(COMMANDS[command], root)
    assert 'safe.bareRepository=explicit' in argv
    lost = {key: value for key, value in env.items() if key not in ('GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE')}
    result = asyncio.run(run(argv, root / 'sub', 30, env=lost))
    assert bench.fired() == [], f'programs of the nested repository ran: {bench.fired()}'
    assert result['ok'] is False  # git refused to use it: an implicit discovery is not allowed
