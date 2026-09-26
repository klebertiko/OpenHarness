"""Sidecar secret storage adapters.

Select the adapter with ``OH_SECRETS=memory|file|keychain``.
"""

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
]