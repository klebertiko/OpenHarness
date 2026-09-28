import asyncio

import pytest

from sandbox.approval import ApprovalConflict, ToolApproval


@pytest.fixture()
def anyio_backend():
    return 'asyncio'


@pytest.mark.anyio
async def test_action_approval_is_bound_once_and_cannot_be_preapproved():
    approval = ToolApproval(asyncio.Event())
    assert approval.pending is None and approval.decision is None
    with pytest.raises(ApprovalConflict, match='^no_pending_call$'):
        approval.decide('one', 'approve', '')
    approval.begin('one')
    for wrong in ('other', None):
        with pytest.raises(ApprovalConflict, match='^call_id_mismatch$'):
            approval.decide(wrong, 'approve', '')
    approval.decide('one', 'approve', 'checked')
    with pytest.raises(ApprovalConflict, match='^already_decided$'):
        approval.decide('one', 'approve', '')
    assert await approval.wait() == {'decision': 'approve', 'note': 'checked'}
    approval.finish()
    approval.begin('two')
    with pytest.raises(ApprovalConflict, match='^already_decided$'):
        approval.decide('one', 'approve', '')
    approval.decide('two', 'reject', 'no')
    assert await approval.wait() == {'decision': 'reject', 'note': 'no'}


@pytest.mark.anyio
async def test_timeout_never_implies_approval():
    approval = ToolApproval(asyncio.Event())
    approval.begin('one')
    assert await approval.wait(timeout=0.001) is None
    approval.finish()
    assert approval.pending is None


def test_concurrent_action_and_invalid_decision_rejected():
    approval = ToolApproval(asyncio.Event())
    approval.begin('one')
    with pytest.raises(ApprovalConflict, match='^already_decided$'):
        approval.begin('two')
    with pytest.raises(ValueError, match='^invalid_argument$'):
        approval.decide('one', 'maybe', '')


@pytest.mark.anyio
async def test_default_deadline_is_ten_minutes_without_implied_approval(monkeypatch):
    async def deadline(awaitable, timeout):
        awaitable.close()
        assert timeout == 600
        raise asyncio.TimeoutError
    monkeypatch.setattr(asyncio,'wait_for',deadline)
    approval=ToolApproval(asyncio.Event())
    approval.begin('one')
    assert await approval.wait() is None
