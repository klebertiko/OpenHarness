"""SecretsStore protocol.

Values must never appear in logs, exception messages intended for clients,
or __repr__/__str__ of store instances. Callers that log must use refs only.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class SecretsStore(Protocol):
    def put(self, ref: str, value: str) -> None:
        """Store plaintext under ``ref``. Overwrites if the ref already exists."""

    def get(self, ref: str) -> str | None:
        """Return plaintext for ``ref``, or None if missing."""

    def delete(self, ref: str) -> None:
        """Remove ``ref`` if present. No-op if missing."""

    def exists(self, ref: str) -> bool:
        """True when ``ref`` is present."""
