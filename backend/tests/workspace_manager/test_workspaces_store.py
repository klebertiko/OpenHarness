"""The Workspace Manager's own state file: atomic, corruption-tolerant, safe under concurrent writers."""
from __future__ import annotations

import json
import os
import threading

import pytest

from workspaces.store import StateStore


def test_a_missing_file_reads_as_empty_state(tmp_path):
    state = StateStore(tmp_path / "state.json").read()
    assert state == {"version": 1, "workspaces": {}, "selected": None}


def test_updates_persist_across_instances(tmp_path):
    path = tmp_path / "data" / "state.json"
    StateStore(path).mutate(lambda s: s["workspaces"].setdefault("repo1", {}).update({"ws-a": {"path": "p"}}))
    assert StateStore(path).read()["workspaces"]["repo1"]["ws-a"] == {"path": "p"}


def test_a_failing_mutation_writes_nothing(tmp_path):
    store = StateStore(tmp_path / "state.json")
    store.mutate(lambda s: s.update(selected={"repo_key": "r", "id": "ws-a"}))

    def boom(state):
        state["selected"] = None
        raise RuntimeError("no")

    with pytest.raises(RuntimeError):
        store.mutate(boom)
    assert store.read()["selected"] == {"repo_key": "r", "id": "ws-a"}


def test_a_failed_write_keeps_the_previous_file_and_leaves_no_temp(tmp_path, monkeypatch):
    path = tmp_path / "state.json"
    store = StateStore(path)
    store.mutate(lambda s: s.update(selected={"repo_key": "r", "id": "ws-a"}))
    before = path.read_bytes()

    def broken_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", broken_replace)
    with pytest.raises(OSError):
        store.mutate(lambda s: s.update(selected=None))
    monkeypatch.undo()
    assert path.read_bytes() == before
    assert [p.name for p in tmp_path.iterdir()] == ["state.json"]


def test_a_corrupt_file_is_set_aside_and_state_restarts_empty(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{ not json", encoding="utf-8")
    assert StateStore(path).read()["workspaces"] == {}
    assert any(p.name.startswith("state.json.corrupt") for p in tmp_path.iterdir())


@pytest.mark.parametrize("payload", ["[]", '{"version": 99}', '{"version": 1, "workspaces": []}', '{"version": 1, "workspaces": {}, "selected": 5}'])
def test_a_file_with_the_wrong_shape_is_treated_as_corrupt(tmp_path, payload):
    path = tmp_path / "state.json"
    path.write_text(payload, encoding="utf-8")
    assert StateStore(path).read() == {"version": 1, "workspaces": {}, "selected": None}


def test_concurrent_writers_do_not_lose_updates(tmp_path):
    store = StateStore(tmp_path / "state.json")

    def register(n):
        store.mutate(lambda s: s["workspaces"].setdefault("repo", {}).update({f"ws-{n}": {"n": n}}))

    threads = [threading.Thread(target=register, args=(n,)) for n in range(25)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))["workspaces"]["repo"]) == 25
