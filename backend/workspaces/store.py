"""Atomic JSON state for the Workspace Manager (managed-worktree registry and the selected workspace).

Deliberately not an ORM table: the ORM schema belongs to the persistence layer other work is changing, and this state is small,
local and rebuildable (the registry only *adds* information; git's own worktree list stays the source of truth for what exists).
Writes go to a temp file in the same directory and are swapped in with ``os.replace``, so a crash leaves the old file or the new
one, never half of one.
"""
from __future__ import annotations

import json
import os
import secrets
import threading
from pathlib import Path
from typing import Any, Callable, TypeVar

T = TypeVar("T")
VERSION = 1
_LOCKS: dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


def _empty() -> dict[str, Any]:
    return {"version": VERSION, "workspaces": {}, "selected": None}


def _lock_for(path: Path) -> threading.RLock:
    key = os.path.normcase(os.path.abspath(path))
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


def _well_formed(state: Any) -> bool:
    return (isinstance(state, dict) and state.get("version") == VERSION and isinstance(state.get("workspaces"), dict)
            and (state.get("selected") is None or isinstance(state.get("selected"), dict)))


class StateStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = _lock_for(self.path)

    def _load(self) -> dict[str, Any]:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return _empty()
        try:
            state = json.loads(raw)
        except ValueError:
            state = None
        if not _well_formed(state):
            self._set_aside()
            return _empty()
        return state

    def _set_aside(self) -> None:
        """Keep an unreadable file for inspection instead of overwriting or deleting it."""
        try:
            os.replace(self.path, self.path.with_name(f"{self.path.name}.corrupt-{secrets.token_hex(3)}"))
        except OSError:
            pass

    def _write(self, state: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
        try:
            with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(state, handle, indent=2, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise

    def read(self) -> dict[str, Any]:
        with self._lock:
            return self._load()

    def mutate(self, change: Callable[[dict[str, Any]], T]) -> T:
        """Load, apply ``change`` to the state, write it back. If ``change`` raises, nothing is written."""
        with self._lock:
            state = self._load()
            result = change(state)
            self._write(state)
            return result
