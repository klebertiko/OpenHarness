"""Single-use decisions bound to the exact pending action, never inferred from text."""
import asyncio


class ApprovalConflict(ValueError):
    pass


class ToolApproval:
    def __init__(self, gate: asyncio.Event):
        self.gate = gate
        self.pending: str | None = None
        self.decision: dict | None = None
        self._consumed: set[str] = set()

    def begin(self, call_id: str) -> None:
        if self.pending is not None or call_id in self._consumed:
            raise ApprovalConflict('already_decided')
        self.pending, self.decision = call_id, None
        self.gate.clear()

    def decide(self, call_id: str | None, decision: str, note: str) -> None:
        if call_id in self._consumed or self.decision is not None:
            raise ApprovalConflict('already_decided')
        if self.pending is None:
            raise ApprovalConflict('no_pending_call')
        if call_id != self.pending:
            raise ApprovalConflict('call_id_mismatch')
        if decision not in {'approve', 'reject'}:
            raise ValueError('invalid_argument')
        self.decision = {'decision': decision, 'note': note}
        self._consumed.add(call_id)
        self.gate.set()

    async def wait(self, timeout: float = 600) -> dict | None:
        try:
            await asyncio.wait_for(self.gate.wait(), timeout)
        except asyncio.TimeoutError:
            return None
        return self.decision

    def finish(self) -> None:
        self.pending = self.decision = None
        self.gate.clear()
