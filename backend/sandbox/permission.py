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

_GIT_SAFE_SECTIONS = frozenset({'core', 'remote', 'branch', 'user', 'init', 'pull', 'push', 'fetch', 'submodule', 'color'})
# Keys that start a program, redirect the work tree/attributes or pull in more config.
_GIT_DANGEROUS_KEY = re.compile(
    r'^\s*(fsmonitor|hookspath|pager|editor|sshcommand|askpass|attributesfile|gitproxy|external|textconv|clean|smudge|process|'
    r'command|driver|helper|program|path|vcs|worktree|uploadpack|receivepack)\s*(=|$)', re.IGNORECASE)
_SECTION = re.compile(r'^\s*\[\s*([A-Za-z0-9.-]+)')

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


def _operand_stays_in_root(base: Path, arg: str) -> bool:
    """An operand that happens to name an existing path must resolve inside the root (symlinks)."""
    try:
        if not (base / arg).exists() and not (base / arg).is_symlink():
            return True
        resolve_in_root(base, arg)
        return True
    except (PathViolation, OSError, ValueError):
        return False


def _operand_ok(base: Path, arg: str, pattern: re.Pattern) -> bool:
    return (not arg.startswith('-') and pattern.match(arg) is not None and not _looks_like_path_escape(arg)
            and _operand_stays_in_root(base, arg))


def _shadowed(program: str, *directories: Path) -> bool:
    """A planted `<program>.exe/.cmd/...` in the workspace could be picked up instead of the real tool."""
    names = {program + suffix for suffix in _SHADOW_SUFFIXES}
    for directory in directories:
        try:
            if any(entry.lower() in names for entry in os.listdir(directory)):
                return True
        except OSError:
            return True
    return False


_YARN_CONFIGS = frozenset({'.yarnrc.yml', '.yarnrc'})


def _has_entry(names: frozenset, *directories: Path) -> bool:
    for directory in directories:
        try:
            if any(entry.lower() in names for entry in os.listdir(directory)):
                return True
        except OSError:
            return True
    return False


def _git_config_is_inert(root: Path) -> bool:
    """The repo's own .git/config must not be able to start programs (filters, textconv, hooks, includes...)."""
    git_dir = root / '.git'
    config = git_dir / 'config'
    try:
        if git_dir.is_symlink() or not git_dir.is_dir() or config.is_symlink() or not config.is_file() or config.stat().st_size > 65536:
            return False
        text = config.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line[0] in '#;':
            continue
        header = _SECTION.match(line)
        if header:
            if header.group(1).split('.')[0].lower() not in _GIT_SAFE_SECTIONS:
                return False
            line = line[line.find(']') + 1:].strip() if ']' in line else ''
            if not line:
                continue
        if _GIT_DANGEROUS_KEY.match(line):
            return False
    return True


def _git_ok(args: list[str], root: Path, cwd: Path) -> bool:
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


def _pytest_ok(args: list[str], trusted: bool, cwd: Path) -> bool:
    if not trusted:
        return False
    for arg in args:
        if arg in _PYTEST_FLAGS or _PYTEST_TB.match(arg):
            continue
        if not _operand_ok(cwd, arg, _PYTEST_NODE):
            return False
    return True


def _ls_ok(args: list[str], cwd: Path) -> bool:
    return all(_LS_FLAGS.match(arg) or _operand_ok(cwd, arg, re.compile(r'^[\w./\\ +@-]+$')) for arg in args)


def _allowed_exec(call, workspace, trusted: bool) -> bool:
    if workspace is None:
        return False
    try:
        root = Path(workspace).resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return False
    if not root.is_dir():
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
        cwd = resolve_in_root(root, call.cwd)
    except (PathViolation, OSError, ValueError):
        return False
    if not cwd.is_dir() or _shadowed(program, root, cwd):
        return False
    args = argv[1:]
    if program == 'git':
        return _git_ok(args, root, cwd)
    if program in _PACKAGE_MANAGERS:
        # Defense in depth: a yarn config in the root or cwd can redirect the binary even in a trusted workspace.
        if program == 'yarn' and _has_entry(_YARN_CONFIGS, root, cwd):
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
    env = {
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_PAGER': 'cat', 'GIT_TERMINAL_PROMPT': '0',
        'GIT_OPTIONAL_LOCKS': '0', 'GIT_CEILING_DIRECTORIES': str(Path(root).resolve().parent),
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
