"""CLI-first runtime selection with explicit API fallback."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping

from runtime.cli_probe import probe_cli

ProbeFn = Callable[[str], str | None]


@dataclass(frozen=True, slots=True)
class RuntimeChoice:
    kind: Literal["cli", "api"]
    name: str
    reason: str = ""


def _as_mapping(bundle_runtime: Any) -> Mapping[str, Any]:
    if bundle_runtime is None:
        return {}
    if isinstance(bundle_runtime, Mapping):
        return bundle_runtime
    # pydantic Runtime / similar
    preferred = getattr(bundle_runtime, "preferred", None)
    cli = getattr(bundle_runtime, "cli", None)
    return {"preferred": preferred, "cli": cli}


def select_runtime(
    bundle_runtime: Any,
    user_pref: str | None = None,
    *,
    probe: ProbeFn | None = None,
) -> RuntimeChoice:
    """
    Prefer an official CLI when the bundle/user asks for it and the binary exists.

    Probe failure (or preferred=api) → API choice plus a human-readable `reason`
    suitable for a UI toast when falling back from a missing CLI.
    """
    data = _as_mapping(bundle_runtime)
    preferred = (user_pref or data.get("preferred") or "cli").strip().lower()
    cli_name = (data.get("cli") or "claude")
    if isinstance(cli_name, str):
        cli_name = cli_name.strip() or "claude"
    else:
        cli_name = "claude"

    probe_fn = probe or probe_cli

    if preferred == "api":
        return RuntimeChoice(kind="api", name=cli_name if data.get("cli") else "api")

    # preferred cli (default when unset / "cli" / unknown non-api)
    path = probe_fn(cli_name)
    if path:
        return RuntimeChoice(kind="cli", name=cli_name, reason="")

    reason = (
        f"{cli_name} CLI not found on PATH; falling back to API. "
        "Install the CLI or switch the runtime preference to API."
    )
    return RuntimeChoice(kind="api", name=cli_name, reason=reason)
