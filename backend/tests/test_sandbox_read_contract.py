import os
import pytest
from sandbox.read import ReadFailure, read_text


def test_read_default_shape_and_exact_limit(tmp_path):
    (tmp_path/'note.txt').write_bytes(b'abcd')
    assert read_text(tmp_path,'note.txt',4)=={'path':'note.txt','bytes':4,'truncated':False,
        'encoding':'utf-8','content':'abcd','redactions':0}
    assert read_text(tmp_path,'note.txt',3)['truncated'] is True


@pytest.mark.parametrize('path,code,status',[('missing','not_found',404),('folder','binary',415),('.env','secret_pattern_requires_approval',403)])
def test_read_failures_keep_contract_codes(tmp_path,path,code,status):
    (tmp_path/'folder').mkdir()
    (tmp_path/'.env').write_text('private')
    with pytest.raises(ReadFailure) as exc: read_text(tmp_path,path)
    assert (exc.value.code,exc.value.status)==(code,status)


def test_invalid_utf8_is_replaced(tmp_path):
    (tmp_path/'note').write_bytes(b'a\xffb')
    assert read_text(tmp_path,'note')['content']=='a\ufffdb'


def test_approved_secret_read_keeps_redaction_and_default_size_limit(tmp_path):
    (tmp_path/'.env').write_text('API_KEY=abcdefghijklmnop',encoding='utf-8')
    result=read_text(tmp_path,'.env',approved=True)
    assert result['content']=='[redacted:assignment]' and result['redactions']==1
    (tmp_path/'large.txt').write_bytes(b'x'*262145)
    large=read_text(tmp_path,'large.txt')
    assert large['bytes']==262144 and large['content']=='x'*262144 and large['truncated'] is True


def test_refusing_truncation_is_413(tmp_path):
    (tmp_path/'file').write_text('abcd')
    with pytest.raises(ReadFailure) as exc: read_text(tmp_path,'file',3,False)
    assert (exc.value.code,exc.value.status)==('too_large',413)


@pytest.mark.parametrize('position,binary',[(8191,True),(8192,False)])
def test_binary_header_boundary(tmp_path,position,binary):
    (tmp_path/'file').write_bytes(b'a'*position+b'\x00')
    if binary:
        with pytest.raises(ReadFailure) as exc: read_text(tmp_path,'file',1)
        assert (exc.value.code,exc.value.status)==('binary',415)
    else:
        result=read_text(tmp_path,'file',1)
        assert result['content']=='a' and result['bytes']==1 and result['truncated'] is True


@pytest.mark.skipif(os.name!='nt',reason='Windows junction')
def test_secret_alias_requires_approval_even_when_target_is_public(tmp_path):
    import _winapi
    public=tmp_path/'public'; public.mkdir()
    (public/'note.txt').write_text('ordinary')
    _winapi.CreateJunction(str(public),str(tmp_path/'.ssh'))
    with pytest.raises(ReadFailure) as exc: read_text(tmp_path,'.ssh/note.txt')
    assert exc.value.code=='secret_pattern_requires_approval'
