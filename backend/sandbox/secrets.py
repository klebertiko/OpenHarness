"""Conservative file approval rules and deterministic output redaction."""
from fnmatch import fnmatchcase
import os
from pathlib import Path
import re

_NAMES = (".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.kdbx",
          "id_rsa*", "id_ed25519*", "*secret*", "*credential*")
_PATTERNS = {
    "private_key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z ]*PRIVATE KEY-----)?",
    "openrouter": r"sk-or-[A-Za-z0-9-]{20,}",
    "openai": r"sk-[A-Za-z0-9]{20,}",
    "aws": r"AKIA[0-9A-Z]{16}",
    "github": r"ghp_[A-Za-z0-9]{36}",
    "slack": r"xox[abprs]-[A-Za-z0-9-]{10,}",
    "assignment": r"(?i:api[_-]?key|token|secret|password)\s*[=:]\s*\S{8,}",
}
_SECRET = re.compile("|".join(f"(?P<{kind}>{pattern})" for kind, pattern in _PATTERNS.items()))


def requires_approval(path: Path) -> bool:
    parts = path.as_posix().lower().split("/")
    if any(part in {".ssh", ".aws", "secrets"} for part in parts):
        return True
    if any(fnmatchcase(parts[-1], pattern) for pattern in _NAMES):
        return True
    if "/".join(parts[-2:]) == ".git/config":
        return True
    if os.environ.get("OH_SECRETS", "").strip().lower() == "file":
        store = os.environ.get("OH_SECRETS_DIR")
        if store and path.resolve().is_relative_to(Path(store).resolve()):
            return True
    return False


def redact(text: str) -> tuple[str, int]:
    return _SECRET.subn(lambda match: f"[redacted:{match.lastgroup}]", text)
