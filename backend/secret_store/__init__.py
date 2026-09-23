"""Sidecar secrets port — Memory / File / Keychain stores.

Select via ``OH_SECRETS=memory|file|keychain`` (see ``factory.build_secrets_store``).
``keyring`` is an optional dependency used only for ``keychain``.

This package is named ``secrets`` to match the plan path. That shadows the
stdlib module of the same name when ``backend/`` is on ``sys.path``. Starlette
and other deps do ``from secrets import token_hex``, so we re-export the
stdlib API alongside our store types.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_stdlib_secrets():
    cached = "_openharness_stdlib_secrets"
    if cached in sys.modules:
        return sys.modules[cached]

    candidates = [
        Path(sys.base_prefix) / "Lib" / "secrets.py",
        Path(sys.prefix) / "Lib" / "secrets.py",
    ]
    # uv / portable CPython layouts
    ver = f"python{sys.version_info.major}.{sys.version_info.minor}"
    candidates.extend(
        [
            Path(sys.base_prefix) / "lib" / ver / "secrets.py",
            Path(sys.prefix) / "lib" / ver / "secrets.py",
        ]
    )
    lib = next((p for p in candidates if p.is_file()), None)
    if lib is None:
        raise ImportError("could not locate stdlib secrets.py for re-export")

    spec = importlib.util.spec_from_file_location(cached, lib)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.modules[cached] = mod
    return mod


_std = _load_stdlib_secrets()
# Re-export stdlib surface used by Starlette / third parties.
SystemRandom = _std.SystemRandom
choice = _std.choice
randbelow = _std.randbelow
token_bytes = _std.token_bytes
token_hex = _std.token_hex
token_urlsafe = _std.token_urlsafe

from .base import SecretsStore
from .factory import build_secrets_store
from .file_store import FileSecrets
from .keychain import KeychainSecrets
from .memory import MemorySecrets

__all__ = [
    "SecretsStore",
    "MemorySecrets",
    "FileSecrets",
    "KeychainSecrets",
    "build_secrets_store",
    "SystemRandom",
    "choice",
    "randbelow",
    "token_bytes",
    "token_hex",
    "token_urlsafe",
]
