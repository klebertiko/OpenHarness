import json
import pytest
from pytest_bdd import given, when, then, parsers, scenario
from test_chat_tools_discovery import workspace, write


@scenario('features/chat-tools-menu.feature', 'Discover lists skills and npm scripts with kinds')
def test_discover_kinds(): pass


@scenario('features/chat-tools-menu.feature', 'Discover ignores heavy directories and caps items')
def test_heavy_dirs(): pass


@scenario('features/chat-tools-menu.feature', 'Discover also lists agents and codex skills')
def test_other_skill_sources(): pass


@pytest.fixture()
def state(): return {}


@given('the workspace "Development" is selected in the composer')
def selected(workspace): pass


@given(parsers.parse('the workspace contains "{skill}" and "{package}" with script "{script}"'))
def files(workspace, skill, package, script):
    _, root = workspace
    write(root, skill, '---\nname: harness\ndescription: Harness\n---\nPRIVATE BODY')
    write(root, package, json.dumps({'scripts': {script: 'vitest'}}))


@given(parsers.parse('the workspace contains {count:d} package.json files under "{folder}"'))
def heavy(workspace, count, folder):
    for i in range(count):
        write(workspace[1], f'{folder}/p{i}/package.json', '{"scripts":{"test":"bad"}}')


@given(parsers.parse('the workspace contains "{first}" and "{second}"'))
def skill_sources(workspace, first, second):
    for path in (first, second): write(workspace[1], path, '---\ndescription: A skill\n---\nBODY')


@when('I GET /chat/tools/discover')
def discover(workspace, state):
    client, root = workspace
    response = client.get('/chat/tools/discover', params={'cwd': str(root)})
    assert response.status_code == 200
    state.update(response.json())


@then(parsers.parse('items include kind "{kind}" name "{name}" source "{source}"'))
def includes(state, kind, name, source):
    assert any(i['kind']==kind and i['name']==name and i['source']==source for i in state['items'])


@then(parsers.parse('items include kind "{kind}" name "{name}" argv {argv} source "{source}"'))
def includes_command(state, kind, name, argv, source):
    includes(state, kind, name, source)
    assert next(i for i in state['items'] if i['name']==name)['argv']==json.loads(argv)


@then('no item carries file content')
def no_content(state):
    assert all('content' not in i for i in state['items'])
    assert 'PRIVATE BODY' not in json.dumps(state)


@then(parsers.parse('items has at most {count:d} entries'))
def bounded(state,count): assert len(state['items'])<=count


@then(parsers.parse('no item path starts with "{folder}"'))
def ignores(state,folder): assert all(not i['path'].startswith(folder) for i in state['items'])
