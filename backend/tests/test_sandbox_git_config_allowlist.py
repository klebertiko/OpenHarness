"""The auto-approved git allowlist for a repository's own `.git/config` (issue #117).

Every key admitted to ``_GIT_CONFIG_ALLOWED`` needs proof that it carries no program, no path outside the
workspace and no URL that git would contact, and a key that takes free text is also bound to a value grammar.
Three kinds of evidence live here:

* a table of keys (any spelling of the case) the policy admits, with the value that makes each one real;
* the same keys with hostile values, and the sibling keys that stay refused (they name programs, paths or URLs);
* real git: a real ``git clone`` (full and ``--filter=blob:none``) goes through the production path
  (``ToolBroker.call`` -> ``decide`` -> ``hardened_git`` -> ``sandbox.exec.run``), and a promisor remote is
  never contacted by a read-only command (the lazy fetch is the one effect ``remote.*.promisor`` adds).
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

# Fixture building must not read the developer's own git configuration.
SETUP_ENV = {'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_TERMINAL_PROMPT': '0'}
PAYLOAD = "import pathlib, sys\npathlib.Path(sys.argv[1], sys.argv[2]).write_text('ran', encoding='utf-8')\n"


def git(cwd, *args, env=None):
    """Setup-only git, through the same runner the broker uses (no direct subprocess in the tests)."""
    argv = ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', *args]
    result = asyncio.run(run(argv, cwd, 30, env={**SETUP_ENV, **(env or {})}))
    assert result['ok'], f'git {args} failed: {result["result"]}'
    return result['result'].strip()


def make_upstream(tmp_path, name='upstream'):
    """A one-commit repository that serves partial clones."""
    up = tmp_path / name
    up.mkdir()
    git(up, 'init', '-q')
    git(up, 'config', 'uploadpack.allowFilter', 'true')
    git(up, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
    (up / 'f.txt').write_text('hello from the promisor\n', encoding='utf-8')
    git(up, 'add', 'f.txt')
    git(up, 'commit', '-q', '-m', 'first commit')
    return up


def make_repo(tmp_path, name='ws'):
    root = tmp_path / name
    root.mkdir()
    git(root, 'init', '-q')
    (root / 'a.txt').write_text('one\n', encoding='utf-8')
    git(root, 'add', 'a.txt')
    git(root, 'commit', '-q', '-m', 'root commit')
    return root


def with_config(root, text):
    with open(root / '.git' / 'config', 'a', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    return root


def verdict(root, *argv):
    return decide('auto_workspace', Exec(argv=list(argv or ('git', 'status')), cwd='.'), root)


def run_auto(root, argv):
    """The production path: broker -> decide -> hardened_git -> exec.run, in auto_workspace mode."""
    control = RunControl('git-config-allowlist')
    broker = broker_module.ToolBroker(str(root), 'ollama', control, ToolsRequest(enabled=True), permission_mode='auto_workspace')

    async def collect():
        return [event async for event in broker.call('exec', {'argv': argv, 'cwd': '.', 'timeout_s': 30}, origin='preset')]
    return asyncio.run(collect())


def run_hardened(root, argv, env=None):
    """hardened_git with no policy in front of it: what auto-approved git would do if the allowlist were bypassed."""
    cmd, pins = hardened_git(argv, root)
    return asyncio.run(run(cmd, root, 30, env={**SETUP_ENV, **pins, **(env or {})}))


def run_unguarded(cwd, argv):
    return asyncio.run(run(argv, cwd, 30, env=dict(SETUP_ENV)))


def packs(root):
    return sorted(os.listdir(root / '.git' / 'objects' / 'pack'))


# -- (1) admitted keys: a repo with this in its config is auto-approved --------------------------------
ADMITTED = [
    # core: boolean switches that only change how git caches or lists the work tree
    ('core.fscache', '[core]\n\tfscache = true\n'),
    ('core.fscache bare', '[core]\n\tfscache\n'),
    ('core.fscache any case', '[CORE]\n\tFsCache = FALSE\n'),
    ('core.untrackedCache true', '[core]\n\tuntrackedCache = true\n'),
    ('core.untrackedCache keep', '[core]\n\tuntrackedCache = keep\n'),
    ('core.untrackedCache any case', '[Core]\n\tUNTRACKEDCACHE = False\n'),
    ('core.sparseCheckout', '[core]\n\tsparseCheckout = true\n'),
    ('core.sparseCheckout any case', '[core]\n\tSparseCheckout = no\n'),
    # written by the VS Code git extension: a ref name that only that extension reads
    ('branch.*.vscode-merge-base', '[branch "main"]\n\tvscode-merge-base = origin/main\n'),
    ('branch.*.vscode-merge-base nested name', '[branch "feature/x"]\n\tvscode-merge-base = upstream/release/1.2\n'),
    # partial clone: what `git clone --filter=` writes
    ('remote.*.promisor', '[remote "origin"]\n\tpromisor = true\n'),
    ('remote.*.partialclonefilter blob:none', '[remote "origin"]\n\tpartialclonefilter = blob:none\n'),
    ('remote.*.partialclonefilter blob:limit', '[remote "origin"]\n\tpartialclonefilter = blob:limit=1m\n'),
    ('remote.*.partialclonefilter tree', '[remote "origin"]\n\tpartialclonefilter = tree:0\n'),
    ('remote.*.promisor any case', '[Remote "Origin"]\n\tPromisor = TRUE\n\tPartialCloneFilter = blob:none\n'),
    # gc: counters, switches and expiry dates; none names a program
    ('gc.auto', '[gc]\n\tauto = 0\n'),
    ('gc.autoPackLimit', '[gc]\n\tautoPackLimit = 50\n'),
    ('gc.autoDetach', '[gc]\n\tautoDetach = false\n'),
    ('gc.bigPackThreshold', '[gc]\n\tbigPackThreshold = 2g\n'),
    ('gc.writeCommitGraph', '[gc]\n\twriteCommitGraph = true\n'),
    ('gc.aggressiveDepth', '[gc]\n\taggressiveDepth = 50\n'),
    ('gc.aggressiveWindow', '[gc]\n\taggressiveWindow = 250\n'),
    ('gc.packRefs', '[gc]\n\tpackRefs = notbare\n'),
    ('gc.pruneExpire', '[gc]\n\tpruneExpire = 2.weeks.ago\n'),
    ('gc.pruneExpire never', '[gc]\n\tpruneExpire = never\n'),
    ('gc.reflogExpire', '[gc]\n\treflogExpire = 90.days.ago\n'),
    ('gc.reflogExpireUnreachable', '[gc]\n\treflogExpireUnreachable = now\n'),
    ('gc.worktreePruneExpire', '[gc]\n\tworktreePruneExpire = 3.months.ago\n'),
    ('gc any case', '[GC]\n\tAUTO = 256\n'),
    # lfs: the one key an LFS installation leaves in .git/config besides filter.lfs.* (which stays refused)
    ('lfs.repositoryformatversion', '[lfs]\n\trepositoryformatversion = 0\n'),
]


@pytest.mark.parametrize('config', [text for _, text in ADMITTED], ids=[name for name, _ in ADMITTED])
def test_a_repo_config_with_this_inert_key_is_auto_approved(config, tmp_path):
    root = with_config(make_repo(tmp_path), config)
    assert verdict(root, 'git', 'status') == 'allow'
    assert verdict(root, 'git', 'log') == 'allow'


# -- (2) the same keys with a value that could carry code, a path or a URL ------------------------------
HOSTILE_VALUES = [
    ('core.fscache program', '[core]\n\tfscache = sh -c x\n'),
    ('core.fscache subst', '[core]\n\tfscache = $(id)\n'),
    ('core.fscache newline', '[core]\n\tfscache = "true\\nx"\n'),
    ('core.untrackedCache program', '[core]\n\tuntrackedCache = !sh\n'),
    ('core.untrackedCache suffix', '[core]\n\tuntrackedCache = keepx\n'),
    ('core.sparseCheckout path', '[core]\n\tsparseCheckout = /etc/passwd\n'),
    ('core.sparseCheckout newline', '[core]\n\tsparseCheckout = "true\\n[core]"\n'),
    ('vscode-merge-base option', '[branch "main"]\n\tvscode-merge-base = --upload-pack=sh\n'),
    ('vscode-merge-base shell', '[branch "main"]\n\tvscode-merge-base = $(sh)\n'),
    ('vscode-merge-base space', '[branch "main"]\n\tvscode-merge-base = "origin/main sh"\n'),
    ('vscode-merge-base windows path', '[branch "main"]\n\tvscode-merge-base = C:\\\\secrets\n'),
    ('vscode-merge-base semicolon', '[branch "main"]\n\tvscode-merge-base = "origin/main;sh"\n'),
    ('vscode-merge-base newline', '[branch "main"]\n\tvscode-merge-base = "origin/main\\nx"\n'),
    ('vscode-merge-base empty', '[branch "main"]\n\tvscode-merge-base =\n'),
    ('promisor program', '[remote "origin"]\n\tpromisor = ext::sh -c x\n'),
    ('promisor word', '[remote "origin"]\n\tpromisor = maybe\n'),
    ('filter sparse path', '[remote "origin"]\n\tpartialclonefilter = sparse:path=/etc/passwd\n'),
    ('filter sparse oid', '[remote "origin"]\n\tpartialclonefilter = sparse:oid=HEAD:.sparse\n'),
    ('filter combine', '[remote "origin"]\n\tpartialclonefilter = combine:blob:none+tree:0\n'),
    ('filter object type', '[remote "origin"]\n\tpartialclonefilter = object:type=blob\n'),
    ('filter trailing program', '[remote "origin"]\n\tpartialclonefilter = "blob:none;sh"\n'),
    ('filter limit text', '[remote "origin"]\n\tpartialclonefilter = blob:limit=abc\n'),
    ('filter newline', '[remote "origin"]\n\tpartialclonefilter = "blob:none\\n[core]"\n'),
    ('filter empty', '[remote "origin"]\n\tpartialclonefilter =\n'),
    ('gc.auto program', '[gc]\n\tauto = "6700; sh"\n'),
    ('gc.auto subst', '[gc]\n\tauto = $(id)\n'),
    ('gc.autoDetach word', '[gc]\n\tautoDetach = sh\n'),
    ('gc.bigPackThreshold path', '[gc]\n\tbigPackThreshold = ../../x\n'),
    ('gc.packRefs word', '[gc]\n\tpackRefs = sh\n'),
    ('gc.pruneExpire program', '[gc]\n\tpruneExpire = "now; sh"\n'),
    ('gc.reflogExpire subst', '[gc]\n\treflogExpire = $(id)\n'),
    ('gc.worktreePruneExpire path', '[gc]\n\tworktreePruneExpire = /etc\n'),
    ('lfs.repositoryformatversion path', '[lfs]\n\trepositoryformatversion = ../../x\n'),
    ('lfs.repositoryformatversion other', '[lfs]\n\trepositoryformatversion = 1\n'),
]


@pytest.mark.parametrize('config', [text for _, text in HOSTILE_VALUES], ids=[name for name, _ in HOSTILE_VALUES])
def test_an_admitted_key_with_a_hostile_value_still_asks(config, tmp_path):
    root = with_config(make_repo(tmp_path), config)
    assert verdict(root, 'git', 'status') == 'ask'


# -- (3) siblings of the admitted keys: they name a program, a path or a URL, so they stay refused -----------
STILL_REFUSED = [
    # core: program, hook directory, pager, editor, ssh, ignore/attribute files
    '[core]\n\tfsmonitor = true\n', '[core]\n\tfsmonitor = sh\n', '[core]\n\thooksPath = ../hooks\n', '[core]\n\tpager = sh\n',
    '[core]\n\teditor = sh\n', '[core]\n\tsshCommand = sh\n', '[core]\n\tattributesFile = ../x\n', '[core]\n\texcludesFile = ../x\n',
    '[core]\n\tsparseCheckoutCone = true\n', '[core]\n\tuntrackedCacheX = true\n', '[core]\n\tfscachee = true\n',
    '[core "x"]\n\tfscache = true\n', '[core "x"]\n\tuntrackedCache = true\n',
    # remote: programs run for the transport, and everything that makes a read-only command contact a server
    '[remote "origin"]\n\tuploadpack = sh\n', '[remote "origin"]\n\treceivepack = sh\n', '[remote "origin"]\n\tvcs = x\n',
    '[remote "origin"]\n\tproxy = http://x\n', '[remote "origin"]\n\tpromisorx = true\n', '[remote]\n\tpromisor = true\n',
    '[remote "origin"]\n\tserveroption = x\n', '[remote "origin"]\n\ttagopt = --tags\n',
    # extensions are not part of what a partial clone writes (git 2.53 writes only the remote keys)
    '[extensions]\n\tpartialClone = origin\n', '[extensions]\n\tworktreeConfig = true\n', '[extensions]\n\tobjectFormat = sha256\n',
    # gc: a program, a pattern subsection, and everything unknown
    '[gc]\n\trecentObjectsHook = sh\n', '[gc]\n\trecentobjectshook = sh -c x\n', '[gc "refs/heads/*"]\n\treflogExpire = never\n',
    '[gc]\n\tunknownNewKey = 1\n', '[gc]\n\tcruftPacks = true\n', '[gc]\n\tlogExpiry = 1.day.ago\n', '[gc "x"]\n\tauto = 0\n',
    '[maintenance]\n\tauto = false\n', '[maintenance]\n\tstrategy = incremental\n',
    # lfs: endpoints, storage, transfer programs, per-URL access hints
    '[lfs]\n\turl = https://example.com/lfs\n', '[lfs]\n\tpushurl = https://example.com/lfs\n', '[lfs]\n\tstorage = ../elsewhere\n',
    '[lfs]\n\tconcurrenttransfers = 8\n', '[lfs]\n\tstandalonetransferurl = https://x\n',
    '[lfs "customtransfer.x"]\n\tpath = sh\n', '[lfs "customtransfer.x"]\n\targs = -c x\n',
    '[lfs "https://example.com/x.git/info/lfs"]\n\taccess = basic\n', '[lfs "extension.x"]\n\tclean = sh\n',
    '[filter "lfs"]\n\tprocess = git-lfs filter-process\n', '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n',
    '[lfs]\n\trepositoryformatversion = 0\n[filter "lfs"]\n\tsmudge = git-lfs smudge -- %f\n',
    # keys that make a transport allowed, rewrite a URL or run something else, whatever the table above says
    '[protocol]\n\tallow = always\n', '[protocol "file"]\n\tallow = always\n', '[url "x"]\n\tinsteadOf = y\n', '[alias]\n\tst = !sh\n',
    '[credential]\n\thelper = sh\n', '[uploadpack]\n\tpackObjectsHook = sh\n', '[receive]\n\tdenyCurrentBranch = ignore\n',
    '[include]\n\tpath = x\n', '[diff]\n\texternal = sh\n', '[diff "x"]\n\tcommand = sh\n', '[merge "x"]\n\tdriver = sh\n',
]


@pytest.mark.parametrize('config', STILL_REFUSED)
def test_sibling_keys_that_can_run_code_or_leave_the_workspace_stay_refused(config, tmp_path):
    root = with_config(make_repo(tmp_path), config)
    assert verdict(root, 'git', 'status') == 'ask'


def test_one_refused_key_next_to_admitted_ones_still_asks(tmp_path):
    root = with_config(make_repo(tmp_path), '[core]\n\tfscache = true\n\tuntrackedCache = true\n[gc]\n\tauto = 0\n'
                                            '[remote "origin"]\n\tpromisor = true\n\tuploadpack = sh\n')
    assert verdict(root, 'git', 'status') == 'ask'


# -- (4) real git: every admitted key at once, then a real clone, through the production path ---------------
def test_a_repo_with_every_admitted_key_runs_read_only_git_through_the_production_path(tmp_path):
    root = make_repo(tmp_path)
    with_config(root, ''.join(text for name, text in ADMITTED if ' any case' not in name and 'bare' not in name
                              and name not in ('lfs.repositoryformatversion', 'gc.pruneExpire never')))
    (root / '.git' / 'info').mkdir(exist_ok=True)
    (root / '.git' / 'info' / 'sparse-checkout').write_text('/*\n', encoding='utf-8')
    (root / 'a.txt').write_text('two\n', encoding='utf-8')
    for argv in (['git', 'status'], ['git', 'diff'], ['git', 'log', '--oneline'], ['git', 'show', '--stat'], ['git', 'rev-parse', 'HEAD'],
                 ['git', 'ls-files']):
        assert decide('auto_workspace', Exec(argv=argv, cwd='.'), root) == 'allow', argv
        events = run_auto(root, argv)
        assert [e['kind'] for e in events] == ['tool_call', 'tool_auto_approved', 'tool_result'], argv
        assert events[-1]['ok'] is True, events[-1]['result']


def test_a_real_git_clone_is_auto_approved_and_answers_read_only_commands(tmp_path):
    up = make_upstream(tmp_path)
    clone = tmp_path / 'clone'
    git(tmp_path, 'clone', '-q', up.as_uri(), str(clone))
    config = (clone / '.git' / 'config').read_text(encoding='utf-8')
    assert 'url = ' in config and 'fetch = ' in config  # the clone really wrote a remote
    assert verdict(clone, 'git', 'status') == 'allow'
    log = run_auto(clone, ['git', 'log', '--oneline'])
    assert log[-1]['ok'] is True and 'first commit' in log[-1]['result']
    shown = run_auto(clone, ['git', 'show', 'HEAD:f.txt'])
    assert shown[-1]['ok'] is True and 'hello from the promisor' in shown[-1]['result']


@pytest.fixture()
def partial_clone(tmp_path):
    """`git clone --filter=blob:none --no-checkout`: the history is there, the blob of f.txt is not."""
    up = make_upstream(tmp_path)
    clone = tmp_path / 'partial'
    git(tmp_path, 'clone', '-q', '--filter=blob:none', '--no-checkout', up.as_uri(), str(clone))
    config = (clone / '.git' / 'config').read_text(encoding='utf-8')
    assert 'promisor = true' in config and 'partialclonefilter = blob:none' in config, config
    return up, clone


def test_a_real_partial_clone_is_auto_approved_and_runs_through_the_production_path(partial_clone):
    _, clone = partial_clone
    for argv in (['git', 'status'], ['git', 'log', '--oneline'], ['git', 'rev-parse', 'HEAD'], ['git', 'ls-files']):
        assert decide('auto_workspace', Exec(argv=argv, cwd='.'), clone) == 'allow', argv
        events = run_auto(clone, argv)
        assert [e['kind'] for e in events] == ['tool_call', 'tool_auto_approved', 'tool_result'], argv
        assert events[-1]['ok'] is True, events[-1]['result']
    assert 'first commit' in run_auto(clone, ['git', 'log', '--oneline'])[-1]['result']


def test_the_control_git_without_hardening_does_fetch_the_missing_blob_from_the_promisor(partial_clone):
    """Proves the next test is not vacuous: an unhardened read-only command contacts the promisor remote."""
    _, clone = partial_clone
    before = packs(clone)
    shown = run_unguarded(clone, ['git', '--no-pager', 'show', 'HEAD:f.txt'])
    assert shown['ok'] is True and 'hello from the promisor' in shown['result']
    assert packs(clone) != before


def test_auto_approved_git_never_lazy_fetches_from_a_promisor_remote(partial_clone):
    _, clone = partial_clone
    before = packs(clone)
    events = run_auto(clone, ['git', 'show', 'HEAD:f.txt'])
    assert events[-1]['ok'] is False  # the blob is missing and nothing is allowed to go and get it
    assert 'hello from the promisor' not in events[-1]['result']
    assert packs(clone) == before  # no object arrived


def test_hardened_git_blocks_the_promisor_transport_even_for_a_hostile_remote_program(tmp_path, partial_clone):
    """If the allowlist were bypassed: `remote.*.uploadpack` is the program git starts for a local promisor."""
    _, clone = partial_clone
    markers = tmp_path / 'markers'
    markers.mkdir()
    script = tmp_path / 'payload.py'
    script.write_text(PAYLOAD, encoding='utf-8')
    program = f'"{sys.executable.replace(chr(92), "/")}" "{script.as_posix()}" "{markers.as_posix()}" uploadpack'
    with_config(clone, f'[remote "origin"]\n\tuploadpack = {program}\n')
    run_unguarded(clone, ['git', '--no-pager', 'show', 'HEAD:f.txt'])
    assert [e.name for e in markers.iterdir()] == ['uploadpack']  # armed: unhardened git starts it
    (markers / 'uploadpack').unlink()
    result = run_hardened(clone, ['git', 'show', 'HEAD:f.txt'])
    assert result['ok'] is False
    assert list(markers.iterdir()) == []


def test_a_partial_clone_that_points_outside_the_workspace_is_not_read_through_the_promisor(tmp_path, partial_clone):
    """`remote.*.url` is already admitted; with `promisor` it would have become a read of another repository."""
    up, clone = partial_clone
    other = tmp_path / 'secrets'
    other.mkdir()
    git(other, 'init', '-q')
    (other / 'secret.txt').write_text('outside the workspace\n', encoding='utf-8')
    git(other, 'add', 'secret.txt')
    git(other, 'commit', '-q', '-m', 'secret')
    git(other, 'config', 'uploadpack.allowFilter', 'true')
    git(other, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
    git(clone, 'config', 'remote.origin.url', other.as_posix())
    outside_blob = git(other, 'rev-parse', 'HEAD:secret.txt')
    before = packs(clone)
    result = run_hardened(clone, ['git', 'cat-file', '-p', outside_blob])
    assert result['ok'] is False
    assert 'outside the workspace' not in result['result']
    assert packs(clone) == before


# -- (5) the hardened argv carries the guards the promisor key depends on --------------------------------------
def test_hardened_git_denies_every_transport_and_turns_lazy_fetch_off(tmp_path):
    argv, env = hardened_git(['git', 'status'], tmp_path)
    pairs = {argv[i + 1] for i, token in enumerate(argv) if token == '-c'}
    assert 'protocol.allow=never' in pairs
    assert env['GIT_NO_LAZY_FETCH'] == '1'


# -- (6) `.git` as a file (a linked worktree) stays `ask` --------------------------------------------------------
def test_a_linked_worktree_whose_dot_git_is_a_file_still_asks_and_points_outside_the_workspace(tmp_path):
    main = make_repo(tmp_path, 'main')
    linked = tmp_path / 'linked'
    git(main, 'worktree', 'add', '-q', str(linked), '-b', 'side')
    assert (linked / '.git').is_file()
    pointer = (linked / '.git').read_text(encoding='utf-8').strip()
    assert pointer.startswith('gitdir:')
    target = os.path.realpath(pointer.split(':', 1)[1].strip())
    assert os.path.commonpath([os.path.realpath(linked), target]) != os.path.realpath(linked)  # outside the workspace
    assert verdict(linked, 'git', 'status') == 'ask'
    assert verdict(linked, 'git', 'log') == 'ask'
    # the pin that keeps git inside the workspace cannot name this repository either, so there is no safe way to run it
    assert run_hardened(linked, ['git', 'status'])['ok'] is False
