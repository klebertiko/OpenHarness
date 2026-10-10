"""Chat permission mode: a pure policy seam, decided on the backend only.

`decide(mode, call, workspace)` answers one question for ONE tool call:

* ``"deny"``  - the call must not run and no person is asked (plan mode).
* ``"ask"``   - park on the run's approval gate, exactly as before.
* ``"allow"`` - the mode itself lets the call proceed without the gate.

For ``read``/``discover`` the mode never adds a gate (``"allow"`` means "the mode
has no objection"); the existing secret-path approval stays in the broker and
applies in every mode. Only ``exec`` is shaped by the mode.

There is deliberately no "bypass" mode, and an unknown mode is ``"ask"``.
The mode is stored per conversation by the sidecar; a run request can only
tighten it (`effective_mode`), never loosen it.
"""
import os
import re
from pathlib import Path, PureWindowsPath
from typing import Literal

from .exec import risk_hints
from .paths import PathViolation, resolve_in_root

Decision = Literal['ask', 'allow', 'deny']
# Ordered strictest -> laxest. The index is the "strictness rank".
MODES = ('plan', 'ask', 'auto_workspace')
DEFAULT_MODE = 'ask'

_SUFFIXES = ('.exe', '.cmd', '.bat', '.com', '.ps1', '.vbs', '.msc', '.sh')

# Never auto-approved: they take an arbitrary string/program to run, destroy
# data or settings, reach the network, or elevate. These still ASK.
_SHELLS_AND_LAUNCHERS = {
    'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'ash', 'busybox', 'cmd', 'command', 'powershell',
    'pwsh', 'wsl', 'bash.exe', 'osascript', 'cscript', 'wscript', 'mshta', 'rundll32', 'regsvr32', 'msiexec',
    'env', 'xargs', 'nohup', 'nice', 'timeout', 'watch', 'start', 'call', 'eval', 'exec', 'sudo', 'su', 'doas',
    'runas', 'find', 'awk', 'sed', 'make', 'cmake', 'invoke-expression', 'iex', 'invoke-command', 'start-process',
}
_INTERPRETER = re.compile(r'^(python[\d.]*w?|pypy[\d.]*|py|node[\d.]*|nodejs|deno|bun|ruby[\d.]*|perl[\d.]*|php[\d.]*|'
                          r'lua[\d.]*|tclsh|java|javaw|dotnet|osascript|groovy|julia|rscript|r)$')
_DESTRUCTIVE = {
    'rm', 'rmdir', 'del', 'erase', 'rd', 'format', 'mkfs', 'dd', 'shred', 'wipe', 'truncate', 'diskpart', 'fdisk',
    'parted', 'cipher', 'chmod', 'chown', 'chgrp', 'icacls', 'takeown', 'attrib', 'reg', 'regedit', 'sc', 'schtasks',
    'taskkill', 'kill', 'pkill', 'killall', 'shutdown', 'reboot', 'halt', 'poweroff', 'net', 'netsh', 'setx', 'crontab',
    'systemctl', 'launchctl', 'mount', 'umount', 'mv', 'move', 'ren', 'rename', 'remove-item',
}
_NETWORK = {
    'curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod', 'ftp', 'tftp', 'scp', 'sftp', 'ssh', 'rsync',
    'nc', 'ncat', 'netcat', 'telnet', 'socat', 'certutil', 'bitsadmin', 'aria2c', 'npx', 'pnpx', 'bunx', 'pipx', 'uvx',
    'gh', 'docker', 'kubectl', 'az', 'aws', 'gcloud', 'terraform',
    # package managers/build tools that download and run third-party code
    'pip', 'pip3', 'uv', 'poetry', 'pdm', 'conda', 'gem', 'bundle', 'composer', 'mvn', 'gradle', 'gradlew', 'cargo', 'go',
    'dotnet', 'brew', 'apt', 'apt-get', 'choco', 'winget', 'scoop',
}
DENYLIST = frozenset(_SHELLS_AND_LAUNCHERS | _DESTRUCTIVE | _NETWORK)

# Programs that fetch/execute third-party code or publish unless restricted to a
# short list of local subcommands. A program listed here with an argv[1] outside
# its set (or none at all) asks.
_SUBCOMMANDS = {
    'npm': {'test', 't', 'tst', 'run', 'run-script', 'ls', 'list', '--version', '-v'},
    'pnpm': {'test', 't', 'run', 'run-script', 'ls', 'list', '--version', '-v'},
    'yarn': {'test', 'run', 'list', '--version', '-v'},
    'git': {'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'grep', '--version'},
}
_GIT_UNSAFE_FLAGS = ('--output', '--ext-diff', '--textconv', '--upload-pack', '--receive-pack', '--exec', '--config', '-c')
_NPM_UNSAFE_FLAGS = ('--prefix', '--userconfig', '--globalconfig', '--registry')

_DRIVE = re.compile(r'^[A-Za-z]:')
_SCHEME = re.compile(r'^[A-Za-z][A-Za-z0-9+.-]*://')


def _normalize_program(name: str) -> str:
    base = name.strip().rstrip(' .').lower()
    for suffix in _SUFFIXES:
        if base.endswith(suffix) and len(base) > len(suffix):
            return base[:-len(suffix)]
    return base


def _is_denylisted(program: str) -> bool:
    return program in DENYLIST or bool(_INTERPRETER.match(program))


def _looks_like_path_escape(arg: str) -> bool:
    """True when an argument names something outside a relative, in-workspace path."""
    if not arg:
        return False
    if _SCHEME.match(arg) or arg.startswith('~'):
        return True
    for candidate in (arg, arg.partition('=')[2]):
        if not candidate:
            continue
        if _SCHEME.match(candidate) or candidate.startswith(('~', '/', '\\')) or _DRIVE.match(candidate):
            return True
        if any(part == '..' for part in re.split(r'[\\/]', candidate)):
            return True
    return False


def _arg_stays_in_root(root: Path, arg: str) -> bool:
    """An argument that happens to name an existing path must resolve inside the root (symlinks)."""
    for candidate in ([arg.partition('=')[2]] if arg.startswith('-') else [arg]):
        if not candidate:
            continue
        try:
            if not (root / candidate).exists() and not (root / candidate).is_symlink():
                continue
            resolve_in_root(root, candidate)
        except (PathViolation, OSError, ValueError):
            return False
    return True


def _allowed_exec(call, workspace) -> bool:
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
    if not program or _is_denylisted(program):
        return False
    if PureWindowsPath(call.cwd).drive or Path(call.cwd).is_absolute() or call.cwd.startswith(('/', '\\')):
        return False
    try:
        cwd = resolve_in_root(root, call.cwd)
    except (PathViolation, OSError, ValueError):
        return False
    if not cwd.is_dir():
        return False
    args = argv[1:]
    allowed_sub = _SUBCOMMANDS.get(program)
    if allowed_sub is not None:
        if not args or args[0].lower() not in allowed_sub:
            return False
        if program == 'git' and any(a == f or a.startswith(f + '=') for a in args for f in _GIT_UNSAFE_FLAGS):
            return False
        if program in {'npm', 'pnpm', 'yarn'} and any(a == f or a.startswith(f + '=') for a in args for f in _NPM_UNSAFE_FLAGS):
            return False
    if risk_hints(argv):
        return False
    for arg in args:
        if _looks_like_path_escape(arg) or not _arg_stays_in_root(cwd, arg):
            return False
    return True


def decide(mode, call, workspace) -> Decision:
    """Policy verdict for one validated tool call (`Exec`, `Read`, `Discover`)."""
    if getattr(call, 'name', None) != 'exec':
        return 'allow'
    if mode == 'plan':
        return 'deny'
    if mode == 'auto_workspace' and _allowed_exec(call, workspace):
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
