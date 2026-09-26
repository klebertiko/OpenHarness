from pathlib import Path

from fastapi.testclient import TestClient
import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from main import app


scenarios("features/chat-tools-sandbox.feature")


@pytest.fixture()
def context(tmp_path):
    root = tmp_path / "ws"
    (root / "docs").mkdir(parents=True)
    (root / "docs" / "README.md").write_text("workspace text", encoding="utf-8")
    (root / ".env").write_text("PRIVATE=abcdefghijk", encoding="utf-8")
    (tmp_path / "outside.txt").write_text("outside private", encoding="utf-8")
    (tmp_path / "outside-dir").mkdir()
    (tmp_path / "outside-dir" / "secret.txt").write_text("outside private", encoding="utf-8")
    return {"tmp": tmp_path, "root": root, "auth": True}


@pytest.fixture()
def client():
    with TestClient(app) as client:
        yield client


def expand(value, context):
    return value.replace("<tmp>", str(context["tmp"]))


@given(parsers.parse('a Cowork project registered with rootPath "{path}"'))
def workspace(client, context, path):
    response = client.post("/cowork/projects", json={"name": "BDD workspace", "rootPath": str(Path(expand(path, context)))})
    assert response.status_code == 201


@given("the sidecar token header is present")
def authenticated(context):
    context["auth"] = True


@given("the sidecar token header is absent")
def unauthenticated(context):
    context["auth"] = False


@given(parsers.parse('"{link}" is a symlink to "{target}"'))
def symlink(context, link, target):
    try:
        Path(expand(link, context)).symlink_to(expand(target, context), target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation requires privilege on this host")


@given(parsers.parse('"{path}" contains NUL bytes'))
def binary(context, path):
    Path(expand(path, context)).write_bytes(b"binary\x00data")


@given(parsers.parse('"{path}" is {size:d} bytes'))
def large(context, path, size):
    Path(expand(path, context)).write_bytes(b"x" * size)


@given(parsers.parse('"{path}" contains "{content}"'))
def content_file(context, path, content):
    Path(expand(path, context)).write_text(content, encoding="utf-8")


@when(parsers.parse('I POST /chat/tools/read with path "{path}"'))
def read(client, context, path):
    do_read(client, context, str(context["root"]), path)


@when(parsers.parse('I POST /chat/tools/read with cwd "{cwd}" and path "{path}"'))
def read_cwd(client, context, cwd, path):
    do_read(client, context, expand(cwd, context), path)


def do_read(client, context, cwd, path):
    body = {"cwd": cwd, "path": expand(path, context)}
    context["response"] = (client.post("/chat/tools/read", json=body) if context["auth"] else
                           httpx.Client.request(client, "POST", "/chat/tools/read", json=body))


@then(parsers.parse("the status is {code:d}"))
def status(context, code):
    assert context["response"].status_code == code


@then(parsers.parse('the response path is "{path}"'))
def response_path(context, path):
    assert context["response"].json()["path"] == path


@then("the content equals the file on disk")
def file_matches(context):
    assert context["response"].json()["content"] == "workspace text"


@then(parsers.parse('the error is "{code}"'))
def error(context, code):
    assert context["response"].json()["error"] == code


@then("the response contains no file content")
def no_content(context):
    assert "content" not in context["response"].json()
    assert "outside private" not in context["response"].text


@then("truncated is true")
def truncated(context):
    assert context["response"].json()["truncated"] is True


@then(parsers.parse("bytes is {size:d}"))
def bytes_read(context, size):
    assert context["response"].json()["bytes"] == size


@then(parsers.parse('the content contains "{text}"'))
def contains(context, text):
    assert text in context["response"].json()["content"]


@then(parsers.parse("redactions is {count:d}"))
def redactions(context, count):
    assert context["response"].json()["redactions"] == count


def test_read_limit_can_refuse_truncation(client, context):
    workspace(client, context, "<tmp>/ws")
    response = client.post("/chat/tools/read", json={
        "cwd": str(context["root"]), "path": "docs/README.md", "max_bytes": 4, "truncate": False,
    })
    assert response.status_code == 413
    assert response.json()["error"] == "too_large"
    assert "content" not in response.json()


@pytest.mark.parametrize("limit", [0, -1, 262145, True])
def test_read_limit_is_bounded(client, context, limit):
    workspace(client, context, "<tmp>/ws")
    assert client.post("/chat/tools/read", json={
        "cwd": str(context["root"]), "path": "docs/README.md", "max_bytes": limit,
    }).status_code == 400


@pytest.mark.parametrize("fields", [{"path": ""}, {"path": 123}, {"truncate": "false"}, {"max_bytes": "42"}])
def test_read_rejects_wrong_types(client, context, fields):
    workspace(client, context, "<tmp>/ws")
    response = client.post("/chat/tools/read", json={
        "cwd": str(context["root"]), "path": "docs/README.md", **fields,
    })
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_argument"
