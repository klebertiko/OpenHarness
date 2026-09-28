import os
from pathlib import Path

from sidecar_entry import configure_environment


def test_packaged_sidecar_keeps_data_outside_the_install_directory(
    monkeypatch, tmp_path: Path
) -> None:
    data_dir = tmp_path / "app-local-data"
    monkeypatch.setenv("OH_DATA_DIR", str(data_dir))
    monkeypatch.setenv("OH_PORT", "8123")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OH_SECRETS", raising=False)
    monkeypatch.delenv("OH_SECRETS_DIR", raising=False)

    assert configure_environment() == 8123
    assert data_dir.is_dir()
    assert str(data_dir / "harness.db").replace("\\", "/") in os.environ["DATABASE_URL"]
    assert os.environ["OH_SECRETS"] == "file"
    assert Path(os.environ["OH_SECRETS_DIR"]) == data_dir / "secrets"
