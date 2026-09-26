# Chat tools validation

The contract lives in `.harness/sprint-2026-09-18/story-CHAT-TOOLS-CONTRACT/contract.md`.
The backend owns `sandbox/`, `/chat/tools/{capabilities,discover,read}`, direct presets and the HTTP tool loop.
CLI tool locks remain unchanged. Process lifetime tracking is not filesystem/network isolation.

## Dependencies

Install `backend/requirements-test.txt` into the backend environment. It adds pytest-bdd,
mutmut 2.4.5 for native Windows, and pytest-timeout for mutation runs that otherwise wait on
a deliberately broken approval gate. Ordinary tests do not need a provider login or key.

## Regression and BDD

From `backend/`: `python -m pytest -q -p no:cacheprovider`.
The shared conftest selects fresh temporary SQLite/secrets locations before importing the app.
Contract features are copied into `tests/features/`: 11 read, 3 backend discovery, 20 exec scenarios.
CLI-lock BDD uses the external process runner seam; 19 exec scenarios use the real HTTP sidecar.
The remaining menu scenarios belong to frontend tests owned by Claude.

## E2E

Use a **linked isolated git worktree** containing a snapshot of the current backend source/tests,
not just the committed HEAD. Never copy `.venv`, live `data/`, secret stores, or environment files.
Set `OH_ISOLATED_E2E=1` in that process and run `python -m pytest -q -p no:cacheprovider tests/e2e`.
The fixture refuses a shared checkout and an occupied port 8001. It owns and stops only its own
uvicorn process; database/workspace are temporary. The HTTP model is a local scripted server.
This is backend E2E, not Playwright/UI coverage. Coordinate 8001/3001 through sprint STATUS.md.

## Mutation

Run mutmut only in isolated worktrees; `backend/mutmut_config.py` refuses the shared checkout.
Set `PYTHONIOENCODING=utf-8` and `PYTEST_ADDOPTS="--timeout=10 --timeout-method=thread"` for the
unit/API mutation runner. The per-test deadline catches mutants that leave approval gates parked;
reported killed counts therefore include tests failing by deadline. Do not use this 10s limit for
the full E2E suite. Mutmut 2's Windows process-output polling can otherwise wait indefinitely.

Scopes are `sandbox/` and `routers/chat_tools.py`; historical persistence is tested using a
documented patch scope in `routers/execution.py`. Report the exact scope and surviving mutants,
not a whole-project score. Targets: 90% paths/secrets, 70% remaining code. Syntax failures,
timeouts and suspicious results require inspection, not fabricated passes.

Do not edit a worktree's source or query it using mutmut maintenance commands while its run is
active. Read-only SQLite status queries are safe; `mutmut results/show` should wait for completion.
Fresh-context QA/ARCH/SEC approvals and frontend integration remain separate gates.
