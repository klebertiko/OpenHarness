import json

import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture()
def workspace(tmp_path):
    with TestClient(app) as client:
        assert client.post('/cowork/projects', json={'name': 'Tools workspace', 'rootPath': str(tmp_path)}).status_code == 201
        yield client, tmp_path


def write(root, path, content):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def test_discovery_metadata_and_sources(workspace):
    client, root = workspace
    for agent in ('claude', 'agents', 'codex'):
        write(root, f'.{agent}/skills/review/SKILL.md', '---\nname: review\ndescription: Review code\n---\nPRIVATE BODY')
    write(root, '.claude/commands/check.md', '---\ndescription: Check project\n---\nDO NOT EXECUTE')
    write(root, 'frontend/package.json', json.dumps({'scripts': {'test': 'vitest', 'build': 'next build'}}))
    response = client.get('/chat/tools/discover', params={'cwd': str(root)})
    assert response.status_code == 200
    result = response.json()
    assert result['root'] == str(root.resolve())
    assert result['truncated'] is False
    assert len(result['items']) == 6
    assert {i['source'] for i in result['items']} == {'claude-skills', 'agents-skills', 'codex-skills', 'claude-commands', 'package-scripts'}
    test = next(i for i in result['items'] if i['name'] == 'test')
    assert test == {'kind': 'command', 'name': 'test', 'path': 'frontend/package.json', 'cwd': 'frontend', 'argv': ['npm', 'run', 'test'], 'source': 'package-scripts'}
    assert 'PRIVATE BODY' not in response.text and 'DO NOT EXECUTE' not in response.text


def test_discovery_ignores_secret_heavy_and_deep_paths(workspace):
    client, root = workspace
    for path in ('node_modules/p', '.git', '.venv', 'dist', 'build', 'target', '.next', 'secrets', 'a/b/c/d/e'):
        write(root, path + '/package.json', '{"scripts":{"unsafe":"echo bad"}}')
    write(root, 'package.json', 'invalid JSON')
    assert client.get('/chat/tools/discover', params={'cwd': str(root)}).json()['items'] == []


def test_discovery_limits_items(workspace):
    client, root = workspace
    write(root, 'package.json', json.dumps({'scripts': {f'test{i}': 'echo hi' for i in range(501)}}))
    result = client.get('/chat/tools/discover', params={'cwd': str(root)}).json()
    assert len(result['items']) == 500
    assert result['truncated'] is True


def test_discovery_metadata_fallbacks_and_maximum_depth(workspace):
    client,root=workspace
    write(root,'.agents/skills/fallback/SKILL.md','plain markdown')
    write(root,'.codex/skills/bad/SKILL.md','---\n[broken yaml\n---\nbody')
    write(root,'.claude/commands/check.md','---\ndescription: Check the code\n---\nDO NOT RETURN BODY')
    write(root,'a/b/c/d/package.json','{"scripts":{"test":"echo ok"}}')
    result=client.get('/chat/tools/discover',params={'cwd':str(root)}).json()
    items={i['name']:i for i in result['items']}
    assert items['fallback']=={'kind':'skill','name':'fallback','description':'','path':'.agents/skills/fallback/SKILL.md','source':'agents-skills'}
    assert items['bad']['description']==''
    assert items['check']=={'kind':'command','name':'check','description':'Check the code','path':'.claude/commands/check.md','source':'claude-commands'}
    assert items['test']['cwd']=='a/b/c/d'


def test_discovery_directory_limit(workspace):
    client,root=workspace
    for i in range(2005): (root/f'empty{i}').mkdir()
    result=client.get('/chat/tools/discover',params={'cwd':str(root)}).json()
    assert result=={'root':str(root),'items':[],'scanned_dirs':2000,'truncated':True}


@pytest.mark.skipif(__import__('os').name!='nt',reason='Windows junction')
def test_discovery_does_not_follow_external_or_cycle_junctions(workspace):
    import _winapi
    client,root=workspace
    outside=root.parent/'outside'; outside.mkdir()
    write(outside,'package.json','{"scripts":{"outside":"do not expose"}}')
    _winapi.CreateJunction(str(outside),str(root/'external'))
    _winapi.CreateJunction(str(root),str(root/'cycle'))
    result=client.get('/chat/tools/discover',params={'cwd':str(root)}).json()
    assert result=={'root':str(root),'items':[],'truncated':False,'scanned_dirs':1}


def test_discovery_refuses_unregistered_root(workspace):
    client, root = workspace
    response = client.get('/chat/tools/discover', params={'cwd': str(root.parent)})
    assert response.status_code == 400 and response.json() == {'error': 'no-workspace'}


def test_multiple_project_names_can_authorize_same_root(workspace):
    client, root = workspace
    assert client.post('/cowork/projects', json={'name': 'Second project', 'rootPath': str(root)}).status_code == 201
    assert client.get('/chat/tools/capabilities', params={'cwd': str(root)}).status_code == 200
    assert client.get('/chat/tools/discover', params={'cwd': str(root)}).status_code == 200


@pytest.mark.parametrize('provider,kind,reason,model_tools,preset_exec', [
    ('ollama', 'http', 'ok', True, True), ('anthropic', 'cli', 'cli-adapter', False, True),
    ('openai', 'cli', 'cli-adapter', False, True), ('mock', 'mock', 'mock', False, False),
])
def test_capabilities(workspace, provider, kind, reason, model_tools, preset_exec):
    client, root = workspace
    app.state.provider_connections['tools-capability-test'] = {'provider': provider, 'enabled': True}
    result = client.get('/chat/tools/capabilities', params={'cwd': str(root), 'connection_id': 'tools-capability-test'}).json()
    assert result['workspace'] == {'root': str(root), 'name': 'Tools workspace'}
    assert result['provider_kind'] == kind and result['reason'] == reason
    assert result['tools'] == {'discover': True, 'read': model_tools, 'exec': model_tools}
    assert result['preset'] == {'read': True, 'exec': preset_exec}
    assert result['limits'] == {'read_max_bytes': 262144, 'exec_timeout_s': 60, 'exec_max_timeout_s': 600, 'exec_output_max_bytes': 65536, 'max_tool_calls_per_turn': 8, 'max_reads_per_turn': 20}
    missing = client.get('/chat/tools/capabilities', params={'connection_id': 'tools-capability-test'}).json()
    assert missing['reason'] == 'no-workspace'
    assert missing['workspace'] is None
    assert not any(missing['tools'].values()) and not any(missing['preset'].values())
