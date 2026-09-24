from pathlib import Path

import pytest

from sandbox.secrets import redact, requires_approval


@pytest.mark.parametrize("name", [".env", "APP/.ENV.local", "key.pem", "identity.KEY", "a.p12", "a.pfx", "a.kdbx", "id_rsa.pub", "id_ed25519", ".ssh/config", "a/.aws/config", ".git/config", "a/secrets/value.txt", "my-secret.txt", "CREDENTIALS.json"])
def test_secret_names_require_approval(name):
    assert requires_approval(Path(name))


@pytest.mark.parametrize("name", ["README.md", "docs/overview.txt", "package.json"])
def test_ordinary_files_do_not_require_approval(name):
    assert not requires_approval(Path(name))


@pytest.mark.parametrize("secret", ["sk-abcdefghijklmnopqrstuvwxyz0123", "sk-or-abcdefghijklmnopqrstuvwxyz-0123", "AKIA1234567890ABCDEF", "ghp_" + "a" * 36, "xoxb-1234567890-abcd", "-----BEGIN RSA PRIVATE KEY-----\nvalue\n-----END RSA PRIVATE KEY-----", "API_KEY=abcdefghijk", "password: abcdefghijkl"])
def test_known_secret_shapes_are_redacted_once(secret):
    result, count = redact("prefix " + secret + " suffix")
    assert secret not in result
    assert "[redacted:" in result
    assert count == 1


@pytest.mark.parametrize('kind,secret', [('openai','sk-'+'a'*20), ('openrouter','sk-or-'+'b'*20),
    ('aws','AKIA'+'A'*16), ('github','ghp_'+'a'*36), ('slack','xoxa-'+'b'*10),
    ('private_key','-----BEGIN PRIVATE KEY-----\nvalue\n-----END PRIVATE KEY-----'),
    ('assignment','token=abcdefgh')])
def test_redaction_marker_identifies_kind_and_preserves_surrounding_text(kind, secret):
    assert redact('before ' + secret + ' after') == (f'before [redacted:{kind}] after', 1)


def test_nested_git_config_requires_approval():
    assert requires_approval(Path('workspace/project/.git/config'))


def test_ordinary_text_is_preserved():
    assert redact("normal command output") == ("normal command output", 0)


@pytest.mark.parametrize('backend', ['file', ' FILE '])
def test_file_secret_store_directory_requires_approval(tmp_path, monkeypatch, backend):
    monkeypatch.setenv("OH_SECRETS", backend)
    monkeypatch.setenv("OH_SECRETS_DIR", str(tmp_path / "vault"))
    assert requires_approval(tmp_path / "vault" / "opaque.json")
    assert not requires_approval(tmp_path / "public.md")
