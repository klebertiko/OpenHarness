"""Bounded workspace metadata discovery. Content is fetched separately via read."""
import json
import os
from collections import deque
from pathlib import Path

from ruamel.yaml import YAML

from .paths import PathViolation, resolve_in_root
from .secrets import redact, requires_approval

_IGNORED = {'node_modules', '.git', '.venv', 'dist', 'build', 'target', '.next'}
_AGENTS = {'.claude': 'claude', '.agents': 'agents', '.codex': 'codex'}


def _metadata(path: Path) -> dict:
    with path.open('r', encoding='utf-8') as file:
        text = file.read(65536)
    if not text.startswith('---\n'):
        return {}
    try:
        result = YAML(typ='safe').load(text.split('---', 2)[1])
        return result if isinstance(result, dict) else {}
    except Exception:
        return {}


def discover(root: Path) -> dict:
    root = root.resolve()
    items, queue, seen = [], deque([(root, 0)]), set()
    scanned, truncated = 0, False
    while queue:
        directory, depth = queue.popleft()
        if directory in seen:
            continue
        if scanned >= 2000:
            truncated = True
            break
        seen.add(directory)
        scanned += 1
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    if entry.name.lower() in _IGNORED:
                        continue
                    requested = Path(entry.path)
                    try:
                        target = resolve_in_root(root, str(requested))
                    except PathViolation:
                        continue
                    if requires_approval(requested) or requires_approval(target):
                        continue
                    if target.is_dir():
                        if depth < 4:
                            # Bound queued directories too; do not enumerate an unbounded tree.
                            if scanned + len(queue) >= 2000:
                                truncated = True
                            else:
                                queue.append((target, depth + 1))
                        continue
                    if not target.is_file():
                        continue
                    relative = requested.relative_to(root)
                    parts = relative.parts
                    candidates = []
                    if entry.name == 'package.json':
                        try:
                            with target.open('r', encoding='utf-8') as file:
                                package = json.loads(file.read(262144))
                            scripts = package.get('scripts', {})
                            if isinstance(scripts, dict):
                                for name, command in scripts.items():
                                    if isinstance(command, str) and name and not name.startswith('-'):
                                        candidates.append({'kind': 'command', 'name': name, 'path': relative.as_posix(),
                                            'argv': ['npm', 'run', name], 'cwd': relative.parent.as_posix(), 'source': 'package-scripts'})
                        except (OSError, UnicodeError, ValueError, AttributeError):
                            continue
                    elif len(parts) == 4 and parts[0] in _AGENTS and parts[1] == 'skills' and parts[3] == 'SKILL.md':
                        meta = _metadata(target)
                        candidates.append({'kind': 'skill', 'name': str(meta.get('name') or parts[2]),
                            'description': str(meta.get('description') or ''), 'path': relative.as_posix(),
                            'source': _AGENTS[parts[0]] + '-skills'})
                    elif len(parts) == 3 and parts[:2] == ('.claude', 'commands') and relative.suffix == '.md':
                        meta = _metadata(target)
                        candidates.append({'kind': 'command', 'name': relative.stem, 'path': relative.as_posix(),
                            'description': str(meta.get('description') or ''), 'source': 'claude-commands'})
                    for item in candidates:
                        if len(items) >= 500:
                            return {'root': str(root), 'items': items, 'truncated': True, 'scanned_dirs': scanned}
                        items.append(json.loads(redact(json.dumps(item))[0]))
        except (OSError, UnicodeError):
            continue
    return {'root': str(root), 'items': items, 'truncated': truncated, 'scanned_dirs': scanned}
