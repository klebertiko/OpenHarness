"""In-memory SecretsStore for tests and ephemeral process-lifetime fallback."""

from __future__ import annotations


class MemorySecrets:
    def __init__(self) -> None:
        self._data: dict[str, str] = {}

    def put(self, ref: str, value: str) -> None:
        self._data[ref] = value

    def get(self, ref: str) -> str | None:
        return self._data.get(ref)

    def delete(self, ref: str) -> None:
        self._data.pop(ref, None)

    def exists(self, ref: str) -> bool:
        return ref in self._data

    def __repr__(self) -> str:
        return f"MemorySecrets(n={len(self._data)})"
