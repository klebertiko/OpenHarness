"""Chat permission mode: a pure policy seam, decided on the backend only.

`decide(mode, call, workspace, trusted)` answers one question for ONE tool call:

* ``"deny"``  - the call must not run and no person is asked (plan mode).
* ``"ask"``   - park on the run's approval gate, exactly as before.
* ``"allow"`` - the mode itself lets the call proceed without the gate.

For ``read``/``discover`` the mode never adds a gate (``"allow"`` means "the mode
has no objection"); the existing secret-path approval stays in the broker and
applies in every mode. Only ``exec`` is shaped by the mode.

``auto_workspace`` is an EXPLICIT ALLOWLIST, not a denylist: a program that is not
listed below asks, however harmless it looks.

* read-only ``git`` (a short subcommand/flag list, run through `hardened_git`),
  ``ls`` and ``pwd`` run without asking in any workspace;
* anything that executes code the repository defines (``npm|pnpm|yarn`` in ANY form, even
  ``--version``, and ``pytest``) runs without asking ONLY when the workspace is *trusted* (an explicit,
  stored, per-workspace user decision), and only with no flags or extra arguments.

There is deliberately no "bypass" mode, and an unknown mode is ``"ask"``. The mode
is stored per conversation by the sidecar; a run request can only tighten it
(`effective_mode`), never loosen it.
"""
import os
import re
import shutil
import subprocess
from pathlib import Path, PureWindowsPath
from typing import Literal

from .paths import PathViolation, resolve_in_root

Decision = Literal['ask', 'allow', 'deny']
# Ordered strictest -> laxest. The index is the "strictness rank".
MODES = ('plan', 'ask', 'auto_workspace')
DEFAULT_MODE = 'ask'

_SUFFIXES = ('.exe', '.cmd', '.bat', '.com', '.ps1', '.vbs', '.msc', '.sh')
# What shutil.which() / PATHEXT may pick up from the current directory on Windows.
_SHADOW_SUFFIXES = ('', '.exe', '.cmd', '.bat', '.com', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msc')

_DRIVE = re.compile(r'^[A-Za-z]:')
_SCHEME = re.compile(r'^[A-Za-z][A-Za-z0-9+.-]*://')
# '..' used as a path segment, glued to a flag ('-o../x'), after '=' / ':' or before a separator.
_DOTDOT_BEFORE_SEP = re.compile(r'\.\.[\\/]')
_DOTDOT_AT_END = re.compile(r'(^|[\\/=:,]|^-[A-Za-z])\.\.$')

PROGRAM_ALLOWLIST = frozenset({'git', 'ls', 'pwd', 'npm', 'pnpm', 'yarn', 'pytest'})
_PACKAGE_MANAGERS = frozenset({'npm', 'pnpm', 'yarn'})

_GIT_SUBCOMMANDS = frozenset({'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'describe'})
_GIT_FLAGS = frozenset({
    '--', '--stat', '--shortstat', '--numstat', '--name-only', '--name-status', '--oneline', '--short', '--porcelain', '-s', '-b', '--branch',
    '--cached', '--staged', '--no-color', '--graph', '--decorate', '--abbrev-commit', '-p', '--patch', '--show-toplevel', '--abbrev-ref',
    '--is-inside-work-tree', '--git-dir', '--tags', '--always',
})
_GIT_COUNT_FLAG = re.compile(r'^(-\d{1,4}|-n\d{1,4}|--max-count=\d{1,4})$')
_GIT_OPERAND = re.compile(r'^[A-Za-z0-9_@{}^~:./+\\-]+$')
_DIFFY_SUBCOMMANDS = frozenset({'diff', 'log', 'show'})

# `section.key` names (lowercased by git; the subsection, if any, is the middle part) the repo's own
# .git/config may set. Anything else - filters, drivers, textconv, hooks, includes, aliases, unknown keys - is refused.
_GIT_CONFIG_ALLOWED = re.compile(
    r'^(?:'
    r'core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|symlinks|precomposeunicode|autocrlf|eol|safecrlf|longpaths|protectntfs|trustctime)'
    r'|user\.(?:name|email)'
    r'|init\.defaultbranch'
    r'|pull\.(?:rebase|ff)'
    r'|push\.default'
    r'|fetch\.prune'
    r'|color\.ui'
    r'|remote\..+\.(?:url|pushurl|fetch|push)'
    r'|branch\..+\.(?:remote|merge|rebase|description)'
    r'|submodule\..+\.(?:url|active|branch)'
    r')$')
# Files inside .git that make git read configuration or objects from somewhere else (worktrees, linked repos).
_GIT_EXE = shutil.which('git')  # resolved once, at import: the policy never searches PATH while deciding
_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
_GIT_REDIRECTS = ('commondir', 'config.worktree', 'gitdir')
# An attribute that binds a path to a driver (clean/smudge/textconv/merge/diff program defined in some config).
_GIT_DRIVER_ATTR = re.compile(r'(?:^|\s)(?:filter|diff|merge)\s*=', re.IGNORECASE)

_SCRIPT_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$')
_PYTEST_FLAGS = frozenset({'-q', '-qq', '-v', '-vv', '-x', '-s', '--lf', '--ff', '--co', '--collect-only', '--no-header', '-rA'})
_PYTEST_TB = re.compile(r'^--tb=(short|long|line|no|auto|native)$')
_PYTEST_NODE = re.compile(r'^[\w./\\:\[\]-]+$')
_LS_FLAGS = re.compile(r'^-[A-Za-z]{1,6}$')


def _normalize_program(name: str) -> str:
    base = name.strip().rstrip(' .').lower()
    for suffix in _SUFFIXES:
        if base.endswith(suffix) and len(base) > len(suffix):
            return base[:-len(suffix)]
    return base


def _looks_like_path_escape(arg: str) -> bool:
    """True when an argument names something outside a relative, in-workspace path
    (including a value glued to a flag or repeated '=')."""
    if not arg:
        return False
    if _DOTDOT_BEFORE_SEP.search(arg) or _DOTDOT_AT_END.search(arg):
        return True
    candidates = {arg}
    parts = arg.split('=')
    candidates.update('='.join(parts[i:]) for i in range(1, len(parts)))  # value after the 1st, 2nd... '='
    candidates.update(parts[1:])
    glued = re.sub(r'^-{1,2}[A-Za-z0-9-]*?(?=[./\\~])', '', arg)  # '-o/x', '-o../x'
    candidates.add(glued)
    for candidate in candidates:
        if not candidate:
            continue
        if (_SCHEME.match(candidate) or candidate.startswith(('~', '/', '\\')) or _DRIVE.match(candidate)
                or any(part == '..' for part in re.split(r'[\\/]', candidate))):
            return True
    return False


def _inside(root: str, candidate: str) -> str | None:
    """CodeQL's path-injection sanitizer, in one place: normalize, then require containment in `root`
    (an already-normalized real path) BEFORE the value is used. Every filesystem call in this module only
    receives what this returns; a candidate outside the root yields None and is never touched."""
    normalized = os.path.normpath(candidate)
    prefix = root if root.endswith(os.sep) else root + os.sep
    if normalized == root or normalized.startswith(prefix):
        return normalized
    return None


def _join_inside(root: str, relative: str) -> str | None:
    return _inside(root, os.path.join(root, relative))


def _real_inside(root: str, path: str) -> str | None:
    """Follow symlinks/junctions of an already-contained path and require the target to stay inside `root`."""
    return _inside(root, os.path.realpath(path))


def _operand_stays_in_root(base: str, arg: str) -> bool:
    """An operand that happens to name an existing path must resolve inside the base (symlinks)."""
    full = _join_inside(base, arg)
    if full is None:
        return False
    # realpath of a missing path is just the normalized path, so this is also True for operands that do not exist.
    return _real_inside(base, full) is not None


def _operand_ok(base: str, arg: str, pattern: re.Pattern) -> bool:
    return (not arg.startswith('-') and pattern.match(arg) is not None and not _looks_like_path_escape(arg)
            and _operand_stays_in_root(base, arg))


def _entries(root: str, directory: str) -> list[str] | None:
    safe = _inside(root, directory)
    if safe is None:
        return None
    try:
        return os.listdir(safe)
    except OSError:
        return None


def _shadowed(program: str, root: str, *directories: str) -> bool:
    """A planted `<program>.exe/.cmd/...` in the workspace could be picked up instead of the real tool."""
    names = {program + suffix for suffix in _SHADOW_SUFFIXES}
    for directory in directories:
        entries = _entries(root, directory)
        if entries is None or any(entry.lower() in names for entry in entries):
            return True
    return False


_YARN_CONFIGS = frozenset({'.yarnrc.yml', '.yarnrc'})


def _chain(root: str, cwd: str) -> list[str]:
    """cwd and every parent up to and including the workspace root (never above it)."""
    chain = [cwd]
    while chain[-1] != root:
        parent = os.path.dirname(chain[-1])
        if parent == chain[-1] or _inside(root, parent) is None:
            break
        chain.append(parent)
    return chain


def _has_entry(names: frozenset, root: str, *directories: str) -> bool:
    for directory in directories:
        entries = _entries(root, directory)
        if entries is None or any(entry.lower() in names for entry in entries):
            return True
    return False


def _git_attributes_are_inert(git_dir: str) -> bool:
    """`.git/info/attributes` must not bind any path to a filter/diff/merge driver. Absent is fine."""
    path = os.path.join(git_dir, 'info', 'attributes')
    try:
        if not os.path.lexists(path):
            return True
        if os.path.islink(path) or not os.path.isfile(path) or os.stat(path).st_size > 65536:
            return False
        with open(path, encoding='utf-8', errors='replace') as handle:
            return not any(_GIT_DRIVER_ATTR.search(line) for line in handle if not line.lstrip().startswith('#'))
    except OSError:
        return False


def _is_link(path: str) -> bool:
    isjunction = getattr(os.path, 'isjunction', None)
    return os.path.islink(path) or bool(isjunction and isjunction(path))


def _git_objects_are_local(git_dir: str) -> bool:
    """No alternates and no linked object store: object reads must stay inside the workspace."""
    objects = os.path.join(git_dir, 'objects')
    if os.path.lexists(objects) and (_is_link(objects) or not os.path.isdir(objects)):
        return False
    return not os.path.lexists(os.path.join(objects, 'info', 'alternates'))


def _git_config_keys(config: str, git_dir: str) -> list[str] | None:
    """Every key git itself parses out of `config`, or None when git cannot parse it. `git config -f --list`
    only reads; with --no-includes it follows nothing and a hostile file cannot make it start a program."""
    git = _GIT_EXE
    if git is None:
        return None
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith('GIT_')}
    env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_TERMINAL_PROMPT': '0'})
    try:
        # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
        # argv is a list (no shell); git is the executable resolved once at import; the call only parses the file.
        done = subprocess.run([git, 'config', '--file', config, '--no-includes', '--null', '--list'], cwd=git_dir, env=env,  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
                              capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    if done.returncode != 0:
        return None
    try:
        text = done.stdout.decode('utf-8')
    except UnicodeDecodeError:
        return None
    return [entry.split('\n', 1)[0] for entry in text.split('\0') if entry]


def _git_config_is_inert(root: str) -> bool:
    """Everything git would read for this repo must be unable to start programs (filters, textconv, hooks, includes...).

    Fail-closed: besides `.git/config`, any redirection (`commondir`, `config.worktree`, `gitdir` inside `.git`),
    `objects/info/alternates`, or `info/attributes` driver binding makes the repo unverifiable, so the caller asks
    instead of auto-approving. `.git/config` is parsed by git (a line parser diverges from it: several headers on one
    line, a BOM) and every key must be on an allowlist.
    """
    git_dir = _join_inside(root, '.git')
    config = _join_inside(root, os.path.join('.git', 'config'))
    if git_dir is None or config is None:
        return False
    try:
        if os.path.islink(git_dir) or not os.path.isdir(git_dir) or os.path.islink(config) or not os.path.isfile(config) or os.stat(config).st_size > 65536:
            return False
        if any(os.path.lexists(os.path.join(git_dir, name)) for name in _GIT_REDIRECTS):
            return False
        if not _git_attributes_are_inert(git_dir) or not _git_objects_are_local(git_dir):
            return False
    except OSError:
        return False
    keys = _git_config_keys(config, git_dir)
    return keys is not None and all(_GIT_CONFIG_ALLOWED.match(key) for key in keys)


def _git_ok(args: list[str], root: str, cwd: str) -> bool:
    if args in (['--version'], ['-v']):
        return True
    if not args or args[0] not in _GIT_SUBCOMMANDS or not _git_config_is_inert(root):
        return False
    for arg in args[1:]:
        if arg in _GIT_FLAGS or _GIT_COUNT_FLAG.match(arg):
            continue
        if not _operand_ok(cwd, arg, _GIT_OPERAND):
            return False
    return True


def _package_manager_ok(args: list[str], trusted: bool) -> bool:
    # Every invocation, `--version` included, needs trust: the shims read repo-controlled files
    # (yarn's `.yarnrc.yml` `yarnPath` re-executes a script from the repo for ANY subcommand).
    if not trusted:
        return False
    if args in (['--version'], ['-v']):
        return True
    # Exactly `<pm> test` or `<pm> run <script>`: no flags, no `--`, no extra arguments.
    if args == ['test']:
        return True
    return len(args) == 2 and args[0] in ('run', 'run-script') and _SCRIPT_NAME.match(args[1]) is not None


def _pytest_ok(args: list[str], trusted: bool, cwd: str) -> bool:
    if not trusted:
        return False
    for arg in args:
        if arg in _PYTEST_FLAGS or _PYTEST_TB.match(arg):
            continue
        if not _operand_ok(cwd, arg, _PYTEST_NODE):
            return False
    return True


def _ls_ok(args: list[str], cwd: str) -> bool:
    return all(_LS_FLAGS.match(arg) or _operand_ok(cwd, arg, re.compile(r'^[\w./\\ +@-]+$')) for arg in args)


def _allowed_exec(call, workspace, trusted: bool) -> bool:
    if workspace is None:
        return False
    try:
        root = os.path.realpath(str(workspace))
    except (OSError, RuntimeError, ValueError):
        return False
    if not os.path.isdir(root):
        return False
    argv = list(call.argv)
    program_raw = argv[0]
    if any(sep in program_raw for sep in ('/', '\\')) or _DRIVE.match(program_raw) or program_raw.startswith('~'):
        return False
    program = _normalize_program(program_raw)
    if program not in PROGRAM_ALLOWLIST:
        return False
    if PureWindowsPath(call.cwd).drive or Path(call.cwd).is_absolute() or call.cwd.startswith(('/', '\\')):
        return False
    try:
        # Lexical, reserved-name and symlink checks first; the contained real path is then re-verified below.
        resolved = resolve_in_root(Path(root), call.cwd)
    except (PathViolation, OSError, ValueError):
        return False
    cwd = _real_inside(root, str(resolved))
    if cwd is None or not os.path.isdir(cwd) or _shadowed(program, root, root, cwd):
        return False
    args = argv[1:]
    if program == 'git':
        return _git_ok(args, root, cwd)
    if program in _PACKAGE_MANAGERS:
        # Defense in depth: a yarn config anywhere from the cwd up to the root (yarn searches upward) can redirect the binary even in a trusted workspace.
        if program == 'yarn' and _has_entry(_YARN_CONFIGS, root, *_chain(root, cwd)):
            return False
        return _package_manager_ok(args, trusted)
    if program == 'pytest':
        return _pytest_ok(args, trusted, cwd)
    if program == 'ls':
        return _ls_ok(args, cwd)
    return not args  # pwd


def hardened_git(argv: list[str], root) -> tuple[list[str], dict[str, str]]:
    """Argv and extra environment for an auto-approved `git`: a neutral configuration so the
    repository's own config (fsmonitor, pager, external diff, textconv, hooks) cannot start a
    program. Other programs are returned untouched."""
    if not argv or _normalize_program(argv[0]) != 'git':
        return list(argv), {}
    head = ['git', '-c', 'core.fsmonitor=', '-c', 'core.pager=cat', '-c', 'diff.external=',
            '-c', f'core.hooksPath={os.devnull}', '--no-pager', '--no-optional-locks']
    rest = list(argv[1:])
    if rest and rest[0] in _DIFFY_SUBCOMMANDS:
        rest[1:1] = ['--no-ext-diff', '--no-textconv']
    real_root = os.path.realpath(str(root))
    git_dir = os.path.join(real_root, '.git')
    env = {
        # Pinned so git never follows `.git/commondir`, a `.git` file or a parent repo to a config we did not verify.
        'GIT_DIR': git_dir, 'GIT_COMMON_DIR': git_dir, 'GIT_WORK_TREE': real_root,
        # Attributes (filter=/diff=) come from the empty tree, not from the working tree's .gitattributes (git >= 2.42; older git ignores it).
        'GIT_ATTR_SOURCE': _EMPTY_TREE,
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_PAGER': 'cat', 'GIT_TERMINAL_PROMPT': '0',
        'GIT_OPTIONAL_LOCKS': '0', 'GIT_CEILING_DIRECTORIES': os.path.dirname(real_root),
    }
    return head + rest, env


def decide(mode, call, workspace, trusted: bool = False) -> Decision:
    """Policy verdict for one validated tool call (`Exec`, `Read`, `Discover`)."""
    if getattr(call, 'name', None) != 'exec':
        return 'allow'
    if mode == 'plan':
        return 'deny'
    if mode == 'auto_workspace' and _allowed_exec(call, workspace, bool(trusted)):
        return 'allow'
    return 'ask'


def _rank(mode) -> int:
    return MODES.index(mode) if isinstance(mode, str) and mode in MODES else MODES.index(DEFAULT_MODE)


def effective_mode(stored, requested=None) -> str:
    """The stricter of the conversation's stored mode and the one a request names.

    Unknown or missing values count as ``ask`` (a request naming a mode the
    backend does not know is never laxer than the default).
    """
    if requested is None:
        return MODES[_rank(stored)]
    return MODES[min(_rank(stored), _rank(requested))]
