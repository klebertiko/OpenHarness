"""Persistence of each conversation's permission mode (the pure policy lives in `permission`)."""
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChatPermission, WorkspaceTrust
from .permission import DEFAULT_MODE, MODES


async def get_thread_mode(db: AsyncSession, thread_id: str | None) -> str:
    """Stored mode for a conversation; unknown thread, no thread or a corrupt value -> `ask`."""
    if not thread_id:
        return DEFAULT_MODE
    row = await db.get(ChatPermission, thread_id)
    return row.mode if row is not None and row.mode in MODES else DEFAULT_MODE


async def set_thread_mode(db: AsyncSession, thread_id: str, mode: str) -> str:
    if mode not in MODES:
        raise ValueError('invalid_argument')
    row = await db.get(ChatPermission, thread_id)
    if row is None:
        db.add(ChatPermission(thread_id=thread_id, mode=mode))
    else:
        row.mode = mode
    await db.commit()
    return mode


async def is_workspace_trusted(db: AsyncSession, root: str | None) -> bool:
    """False unless this exact (already validated, resolved) workspace root was explicitly trusted."""
    if not root:
        return False
    row = await db.get(WorkspaceTrust, root)
    return bool(row and row.trusted)


async def set_workspace_trust(db: AsyncSession, root: str, trusted: bool) -> bool:
    row = await db.get(WorkspaceTrust, root)
    if row is None:
        db.add(WorkspaceTrust(root_path=root, trusted=trusted))
    else:
        row.trusted = trusted
    await db.commit()
    return trusted
