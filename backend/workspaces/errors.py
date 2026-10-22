"""Errors the Workspace Manager raises; the router maps each to an HTTP status and a stable ``code``."""
from __future__ import annotations


class WorkspaceError(Exception):
    """A refusal or failure with a machine-readable ``code`` the client can branch on."""

    def __init__(self, code: str, message: str, status: int = 400, **details):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, **self.details}
