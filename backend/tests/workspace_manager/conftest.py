"""Fixtures for the Workspace Manager tests: HOME, git environment and data directory all live under tmp_path."""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace

import pytest

from workspaces.config import Settings
from workspaces.gitrun import GitRunner
from workspaces_support import PAYLOAD, Repo, posix


@pytest.fixture
def oh_env(monkeypatch, tmp_path):
    """Isolated HOME, git environment and Workspace Manager data directory."""
    for key in list(os.environ):
        if key.upper().startswith("GIT_"):
            monkeypatch.delenv(key)
    home = tmp_path / "home"
    home.mkdir()
    for key in ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME"):
        monkeypatch.setenv(key, str(home))
    data = tmp_path / "oh-data"
    monkeypatch.setenv("OH_WORKSPACES_HOME", str(data))
    return SimpleNamespace(home=home, data=data, tmp=tmp_path, settings=Settings.from_env())


@pytest.fixture
def runner(oh_env):
    return GitRunner(hooks_dir=oh_env.settings.ensure_hooks_dir())


@pytest.fixture
def make_repo(oh_env, runner):
    def build(name: str = "src-repo", branch: str = "main") -> Repo:
        path = oh_env.tmp / name
        path.mkdir()
        repo = Repo(path, runner)
        repo.git("init", "-q", "-b", branch)
        repo.commit("README.md", "hello\n", "init")
        return repo

    return build


@pytest.fixture
def repo(make_repo) -> Repo:
    return make_repo()


@pytest.fixture
def marker_bench(tmp_path):
    """A payload command that drops a marker file when git (wrongly) runs it."""
    markers = tmp_path / "markers"
    markers.mkdir()
    script = tmp_path / "payload.py"
    script.write_text(PAYLOAD, encoding="utf-8")

    def command(label: str) -> str:
        return f'"{posix(sys.executable)}" "{posix(script)}" "{posix(markers)}" {label}'

    return SimpleNamespace(dir=markers, command=command, ran=lambda: sorted(p.name for p in markers.iterdir()))
