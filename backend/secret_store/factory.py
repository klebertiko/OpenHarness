"""Build a SecretsStore from ``OH_SECRETS`` (keychain | file | memory)."""

from __future__ import annotations

import os
from pathlib import Path

from .base import SecretsStore
from .file_store import FileSecrets
from .memory import MemorySecrets


def _default_file_root() -> Path:
    override = os.environ.get("OH_SECRETS_DIR")
    if override:
        return Path(override)
    return Path.home() / ".openharness" / "secrets"


def build_secrets_store(mode: str | None = None) -> SecretsStore:
    """Return the store selected by ``OH_SECRETS`` (default: ``memory``).

    Values:
    - ``memory`` — process-lifetime only (tests / ephemeral)
    - ``file`` — Fernet file store under ``OH_SECRETS_DIR`` or ``~/.openharness/secrets``
    - ``keychain`` — OS keychain via optional ``keyring`` (see ``KeychainSecrets``)
    """
    selected = (mode if mode is not None else os.environ.get("OH_SECRETS", "memory")).strip().lower()
    if selected in ("", "memory", "mem"):
        return MemorySecrets()
    if selected == "file":
        return FileSecrets(_default_file_root())
    if selected in ("keychain", "keyring", "os"):
        from .keychain import KeychainSecrets

        return KeychainSecrets()
    raise ValueError(
        f"Unknown OH_SECRETS={selected!r}; expected keychain, file, or memory"
    )
