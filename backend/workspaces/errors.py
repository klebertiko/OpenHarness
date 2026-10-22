"""Errors the Workspace Manager raises; the router maps each to an HTTP status and a stable ``code``."""
from __future__ import annotations

import re

# A quoted token holding a path separator ('C:/Users/a b/x', "/home/u/my dir"), then bare drive, UNC and POSIX absolute paths.
_QUOTED = re.compile(r"""(['"])(?!refs/)[^'"\r\n]*[\\/][^'"\r\n]*\1""")
_DRIVE = re.compile(r"(?<!\w)[A-Za-z]:[\\/][^\s'\"]*")
_UNC = re.compile(r"\\\\[^\s'\"]+")
_POSIX = re.compile(r"(?<![\w./:-])/[^\s'\"]+")


def scrub_paths(text: str) -> str:
    """Replace filesystem paths in git's stderr with ``<path>`` so an error never tells a client where things live.

    Ref names such as ``refs/heads/x`` are not absolute paths and stay readable.
    """
    text = _QUOTED.sub(lambda m: f"{m.group(1)}<path>{m.group(1)}", text)
    return _POSIX.sub("<path>", _UNC.sub("<path>", _DRIVE.sub("<path>", text)))


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
