from pathlib import Path
import importlib.util
import json
import stat
import httpx
import pytest

path=Path(__file__).resolve().parents[1]/'scripts/configure_auth_email.py'
spec=importlib.util.spec_from_file_location('auth_email_branding',path)
branding=importlib.util.module_from_spec(spec);spec.loader.exec_module(branding)

def test_templates_preserve_verification_tokens_and_use_tradedesk_brand():
    payload=branding.build_payload()
    assert payload['smtp_sender_name']=='TradeDesk'
    assert len(payload)==13
    for kind in branding.TEMPLATES:
        content=payload['mailer_templates_'+kind+'_content']
        assert 'TradeDesk' in payload['mailer_subjects_'+kind]
        assert ('{{ .Token }}' if kind=='reauthentication' else '{{ .ConfirmationURL }}') in content
        assert 'supabase' not in content.lower()
        assert 'localhost' not in content
    assert '/email/verify-account.png' in payload['mailer_templates_confirmation_content']

def test_hosted_update_never_uses_a_service_key_as_management_access():
    with pytest.raises(ValueError,match='ACCESS_TOKEN'):
        branding.apply_branding({},'a'*20,'',None)

def test_branding_update_preserves_security_settings_and_existing_redirects(monkeypatch,tmp_path):
    payload=branding.build_payload();(tmp_path/'backend').mkdir();monkeypatch.setattr(branding,'ROOT',tmp_path)
    state={'smtp_host':'smtp.example.com','smtp_admin_email':'verified@example.com','smtp_pass':'private-smtp-secret','mailer_autoconfirm':False,'uri_allow_list':'http://localhost:5173/**','site_url':'http://localhost:3000'}
    patches=[]
    def handler(request):
        assert str(request.url)=='https://api.supabase.com/v1/projects/'+'a'*20+'/config/auth'
        if request.method=='PATCH':
            patches.append(json.loads(request.content));state.update(patches[-1])
        return httpx.Response(200,json=state)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result=branding.apply_branding(payload,'a'*20,'test-management-token',client,'https://tradedesk.example/app')
    assert result['templates_verified']==6
    assert result['custom_smtp_configured'] is True
    assert state['mailer_autoconfirm'] is False
    assert 'mailer_autoconfirm' not in patches[0]
    assert state['site_url']=='https://tradedesk.example/app'
    assert 'https://tradedesk.example/auth/confirm' in state['uri_allow_list']
    assert 'http://localhost:5173/**' in state['uri_allow_list']
    backup=tmp_path/'backend/.auth-email-branding-backup.json'
    assert 'private-smtp-secret' not in backup.read_text()
    assert 'test-management-token' not in backup.read_text()
    assert stat.S_IMODE(backup.stat().st_mode)==0o600

def test_failed_management_request_is_safe_and_cannot_report_success(monkeypatch,tmp_path):
    (tmp_path/'backend').mkdir();monkeypatch.setattr(branding,'ROOT',tmp_path)
    with httpx.Client(transport=httpx.MockTransport(lambda request:httpx.Response(403,json={'message':'secret-value'}))) as client:
        with pytest.raises(RuntimeError,match='HTTP 403') as error:
            branding.apply_branding({'smtp_sender_name':'TradeDesk'},'a'*20,'private-token',client)
    assert 'secret-value' not in str(error.value)
    assert not (tmp_path/'backend/.auth-email-branding-backup.json').exists()

def test_project_url_must_be_a_hosted_supabase_project():
    assert branding.project_ref('https://'+'a'*20+'.supabase.co')=='a'*20
    with pytest.raises(ValueError):branding.project_ref('https://other.example')
