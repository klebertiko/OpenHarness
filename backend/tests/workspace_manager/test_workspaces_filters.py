"""A repository's own filter drivers must not run on any path that reads a worktree, removal included.

``git worktree remove`` starts a child ``git status`` that runs ``filter.<name>.clean/process`` of the repository; the child inherits
the ``-c`` overrides of its parent, so the neutralisation has to be on the ``worktree remove`` call itself.
"""
from __future__ import annotations

from pathlib import Path

import pytest


FILTER_NAMES = ["evil", "A.B.c", 'q"uote', "ünï", "has#hash", "semi;colon", "sp ace"]
TREE_READING = {"status", "add", "diff", "checkout", "switch", "restore", "reset", "stash", "clean", "ls-files", "merge", "apply"}
WORKTREE_READING = {"add", "remove", "prune", "repair", "move"}


def hostile_repo(repo, marker_bench, name):
    repo.write(".gitattributes", f"* filter={name}\n")
    repo.git("add", ".gitattributes")
    repo.git("commit", "-q", "-m", "attrs")
    for var in ("clean", "smudge", "process"):
        repo.git("config", f"filter.{name}.{var}", marker_bench.command(var))


def touch_all(path: Path):
    """Same bytes, new mtime: git can no longer trust its index stat data and must run the clean filter to compare content."""
    for name in ("README.md", ".gitattributes"):
        target = path / name
        target.write_bytes(target.read_bytes())


@pytest.mark.parametrize("name", FILTER_NAMES)
def test_removing_a_clean_worktree_runs_no_repository_filter(svc, repo, marker_bench, name):
    hostile_repo(repo, marker_bench, name)
    info = svc.create(str(repo.path), "main", branch="clean")
    assert marker_bench.ran() == []
    touch_all(Path(info["path"]))
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["removable"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and not Path(info["path"]).exists()


@pytest.mark.parametrize("name", FILTER_NAMES)
def test_removing_a_dirty_worktree_runs_no_repository_filter(svc, repo, marker_bench, name):
    hostile_repo(repo, marker_bench, name)
    info = svc.create(str(repo.path), "main", branch="dirty")
    path = Path(info["path"])
    touch_all(path)
    (path / "README.md").write_text("changed\n", encoding="utf-8")
    (path / "new.txt").write_text("untracked\n", encoding="utf-8")
    report = svc.removal_check(str(repo.path), info["id"])
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert marker_bench.ran() == [] and result["rescue"]["ref"]
    assert repo.out("show", f"{result['rescue']['ref']}:new.txt") == "untracked"


def test_every_git_call_that_reads_a_worktree_neutralises_filters(svc, repo, marker_bench, monkeypatch):
    hostile_repo(repo, marker_bench, "evil")
    calls: list[tuple[list[str], bool]] = []
    original = svc.runner.run

    def spy(cwd, args, **kw):
        calls.append((list(args), bool(kw.get("filters"))))
        return original(cwd, args, **kw)

    monkeypatch.setattr(svc.runner, "run", spy)
    info = svc.create(str(repo.path), "main", branch="audit")
    path = Path(info["path"])
    (path / "README.md").write_text("changed\n", encoding="utf-8")
    (path / "new.txt").write_text("x\n", encoding="utf-8")
    svc.list(str(repo.path))
    report = svc.removal_check(str(repo.path), info["id"])
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])

    # a create that fails after `worktree add` must roll back through a filter-neutralised call too
    def boom(change):
        raise RuntimeError("store down")

    monkeypatch.setattr(svc.store, "mutate", boom)
    with pytest.raises(RuntimeError):
        svc.create(str(repo.path), "main", branch="rolled-back")

    def subcommand(args):
        rest = list(args)
        while rest[:1] == ["-c"]:
            rest = rest[2:]
        return rest

    offenders = []
    for args, filtered in calls:
        rest = subcommand(args)
        reads = rest[0] in TREE_READING or (rest[0] == "worktree" and rest[1] in WORKTREE_READING)
        if reads and not filtered:
            offenders.append(rest[:3])
    assert offenders == []
    assert any(subcommand(a)[:2] == ["worktree", "remove"] for a, _ in calls)
    assert marker_bench.ran() == []
