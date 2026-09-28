import pytest
from sandbox.capabilities import capabilities


@pytest.mark.parametrize('adapter,kind,reason,enabled,preset_exec',[
    ('ollama','http','ok',True,True), ('openrouter','http','ok',True,True),
    ('claude','cli','cli-adapter',False,True), ('codex','cli','cli-adapter',False,True),
    ('cursor','cli','cli-adapter',False,True), ('mock','mock','mock',False,False),
])
def test_capability_shape(adapter,kind,reason,enabled,preset_exec,tmp_path):
    result=capabilities(str(tmp_path),adapter,name='Workspace')
    assert result=={'workspace':{'root':str(tmp_path),'name':'Workspace'},'provider_kind':kind,
        'reason':reason,'tools':{'discover':True,'read':enabled,'exec':enabled},
        'preset':{'read':True,'exec':preset_exec},'limits':{'read_max_bytes':262144,'exec_timeout_s':60,
            'exec_max_timeout_s':600,'exec_output_max_bytes':65536,'max_tool_calls_per_turn':8,'max_reads_per_turn':20}}
    empty=capabilities(None,adapter)
    assert empty['reason']=='no-workspace' and empty['workspace'] is None
    assert empty['tools']=={'discover':False,'read':False,'exec':False}
    assert empty['preset']=={'read':False,'exec':False}


def test_http_fallback_only_disables_model_tools(tmp_path):
    result=capabilities(str(tmp_path),'ollama',unsupported=True)
    assert result['reason']=='provider-no-tools'
    assert result['workspace']['name']==tmp_path.name
    assert result['tools']=={'discover':True,'read':False,'exec':False}
    assert result['preset']=={'read':True,'exec':True}
