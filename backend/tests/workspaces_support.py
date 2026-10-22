"""Shared fixtures for the Workspace Manager tests.

Everything a test touches lives under ``tmp_path``: HOME/USERPROFILE and the git
configuration are redirected there, the managed root and the state store are
redirected there (``OH_WORKSPACES_HOME``), and no test reads or writes a real
repository or the user's data. Fixture repositories are built through the
production ``GitRunner`` so the test suite adds no subprocess call site of its own.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from workspaces.config import Settings
from workspaces.gitrun import GitRunner

IDENT = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"]
PAYLOAD = "import pathlib, sys\npathlib.Path(sys.argv[1], sys.argv[2]).write_text('ran', encoding='utf-8')\n"


def posix(path) -> str:
    return os.fspath(path).replace("\\", "/")


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


class Repo:
    """A throwaway repository driven through the production runner."""

    def __init__(self, path: Path, runner: GitRunner):
        self.path, self.runner = path, runner

    def git(self, *args, cwd=None, input=None, check=True):
        return self.runner.run(cwd or self.path, [*IDENT, *args], input=input, check=check)

    def out(self, *args, cwd=None) -> str:
        return self.git(*args, cwd=cwd).stdout.decode("utf-8", "replace").strip()

    def write(self, name: str, text: str = "x\n") -> Path:
        target = self.path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")
        return target

    def commit(self, name: str, text: str = "x\n", message: str | None = None) -> str:
        self.write(name, text)
        self.git("add", "--", name)
        self.git("commit", "-q", "-m", message or f"add {name}")
        return self.out("rev-parse", "HEAD")


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
