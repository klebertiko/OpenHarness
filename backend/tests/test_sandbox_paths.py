import os

import pytest

from sandbox.paths import PathViolation, resolve_in_root


def test_file_inside_root_resolves_to_canonical_path(tmp_path):
    root = tmp_path / "ws"
    root.mkdir()
    file = root / "readme.md"
    file.write_text("safe")
    assert resolve_in_root(root, "readme.md") == file.resolve()
    assert resolve_in_root(root, str(file.resolve())) == file.resolve()


@pytest.mark.parametrize("path", ["../outside.txt", "../absent.txt", r"\\server\share\secret", r"\\?\C:\secret", r"\\.\NUL", "note.txt:secret", "C:relative",
    # CodeQL py/path-injection (Security review 2026-09-26): a bare
    # leading-slash path has no drive letter, so PureWindowsPath.is_absolute()
    # is False and none of the drive/colon/reserved-name guards above trip.
    # It still can't escape: `base / "/etc/passwd"` keeps base's own drive
    # (pathlib joins an absolute-no-drive operand onto the left side's drive,
    # producing e.g. "C:/etc/passwd"), which the mandatory post-join
    # is_relative_to(base) check below then rejects like any other outside
    # path. This is the redundant check that makes the upfront guards
    # defense-in-depth rather than the only line of defense.
    "/etc/passwd", "/", "//x", "/../outside"])
def test_untrusted_paths_cannot_escape_or_use_device_aliases(tmp_path, path):
    root = tmp_path / "ws"
    root.mkdir()
    (tmp_path / "outside.txt").write_text("private")
    with pytest.raises(PathViolation) as failure:
        resolve_in_root(root, path)
    assert failure.value.code == "path_escapes_root"


def test_missing_inside_file_has_not_found_code(tmp_path):
    with pytest.raises(PathViolation) as failure:
        resolve_in_root(tmp_path, "missing.txt")
    assert failure.value.code == "not_found"


def test_absolute_alternate_data_stream_is_forbidden(tmp_path):
    (tmp_path / 'note.txt').write_text('safe')
    with pytest.raises(PathViolation) as failure:
        resolve_in_root(tmp_path, str(tmp_path / 'note.txt') + ':hidden')
    assert failure.value.code == 'path_escapes_root'


@pytest.mark.skipif(os.name != 'nt', reason='Windows UNC semantics')
def test_unc_is_forbidden_even_when_workspace_is_on_that_share(monkeypatch):
    from pathlib import Path
    # Substitute the unavailable network filesystem; exercise real Windows path parsing.
    monkeypatch.setattr(Path, 'resolve', lambda self, strict=False: self)
    with pytest.raises(PathViolation) as failure:
        resolve_in_root(Path(r'\\server\share\ws'), r'\\server\share\ws')
    assert failure.value.code == 'path_escapes_root'


@pytest.mark.parametrize("outside", [True, False])
@pytest.mark.parametrize("relative", [True, False])
def test_directory_link_resolved_before_authorizing(tmp_path, outside, relative):
    root = tmp_path / "ws"
    root.mkdir()
    target = (tmp_path if outside else root) / "target"
    target.mkdir()
    file = target / "note.txt"
    file.write_text("data")
    link = root / "alias"
    try:
        link.symlink_to(os.path.relpath(target, root) if relative else target, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlink privilege unavailable: {exc.winerror if os.name == 'nt' else exc.errno}")
    if outside:
        with pytest.raises(PathViolation) as failure:
            resolve_in_root(root, "alias/note.txt")
        assert failure.value.code == "symlink_escapes_root"
    else:
        assert resolve_in_root(root, "alias/note.txt") == file.resolve()


@pytest.mark.skipif(os.name != "nt", reason="Windows junction")
def test_windows_junction_cannot_escape_root(tmp_path):
    root, target = tmp_path / "ws", tmp_path / "outside"
    root.mkdir()
    target.mkdir()
    (target / "note.txt").write_text("private")
    import _winapi
    _winapi.CreateJunction(str(target), str(root / "alias"))
    with pytest.raises(PathViolation) as failure:
        resolve_in_root(root, "alias/note.txt")
    assert failure.value.code == "symlink_escapes_root"
