"""Prepare/apply TradeDesk auth-email branding without sending messages.

A Supabase Management API access token is required only with --apply.
The application's service-role key is deliberately never used here.
"""
from __future__ import annotations
import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse
import httpx
from dotenv import load_dotenv

ROOT=Path(__file__).resolve().parents[2]
TEMPLATES={
    'confirmation':'TradeDesk — Confirm your email address',
    'recovery':'TradeDesk — Reset your password',
    'email_change':'TradeDesk — Confirm your new email address',
    'magic_link':'TradeDesk — Your sign-in link',
    'invite':'You’re invited to TradeDesk',
    'reauthentication':'TradeDesk — Your verification code',
}

def build_payload():
    payload={'smtp_sender_name':'TradeDesk'}
    for kind,subject in TEMPLATES.items():
        content=(ROOT/'supabase'/'templates'/(kind+'.html')).read_text(encoding='utf-8')
        required='{{ .Token }}' if kind=='reauthentication' else '{{ .ConfirmationURL }}'
        if required not in content or 'TradeDesk' not in content:
            raise ValueError('Missing authentication action or brand in '+kind)
        payload['mailer_subjects_'+kind]=subject
        payload['mailer_templates_'+kind+'_content']=content
    return payload

def project_ref(url):
    host=urlparse(url).hostname or ''
    match=re.fullmatch(r'([a-z0-9]{20})\.supabase\.co',host)
    if not match:raise ValueError('Set SUPABASE_URL to your hosted Supabase project URL')
    return match.group(1)

def apply_branding(payload,ref,token,client,site_url=None):
    if not token:raise ValueError('SUPABASE_ACCESS_TOKEN is required to update hosted auth settings. A service-role key cannot be used.')
    url='https://api.supabase.com/v1/projects/'+ref+'/config/auth'
    headers={'Authorization':'Bearer '+token}
    current=client.get(url,headers=headers)
    if not current.is_success:raise RuntimeError('Could not read auth configuration (HTTP '+str(current.status_code)+'). Check token permissions.')
    before=current.json()
    if site_url:
        parsed=urlparse(site_url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.query or parsed.fragment:
            raise ValueError('Use an HTTPS site URL without query parameters or fragments')
        origin=parsed.scheme+'://'+parsed.netloc
        existing=before.get('uri_allow_list','') or ''
        allowed=existing.split(',') if isinstance(existing,str) else existing
        allowed=[value.strip() for value in allowed if value.strip()]
        for target in [site_url,origin+'/app',origin+'/auth/confirm']:
            if target not in allowed:allowed.append(target)
        payload={**payload,'site_url':site_url,'uri_allow_list':','.join(allowed)}
    # Keep a private, ignored backup of only the branding settings being changed.
    # No SMTP passwords, auth tokens, or other configuration are written.
    backup=ROOT/'backend'/'.auth-email-branding-backup.json'
    fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    os.fchmod(fd,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as handle:
        json.dump({key:before.get(key) for key in payload},handle,indent=2)
    result=client.patch(url,headers=headers,json=payload)
    if not result.is_success:raise RuntimeError('Could not update auth branding (HTTP '+str(result.status_code)+'). No response body was logged.')
    check=client.get(url,headers=headers)
    if not check.is_success:raise RuntimeError('Branding update submitted, but configuration verification failed')
    after=check.json()
    if any(after.get(key)!=value for key,value in payload.items()):
        raise RuntimeError('Hosted branding does not match the requested templates')
    return {'templates_verified':len(TEMPLATES),'sender_name':after.get('smtp_sender_name'),
            'custom_smtp_configured':bool(after.get('smtp_host') and after.get('smtp_admin_email'))}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-url',help='Also correct the production Site URL and append exact callback paths to its allow list')
    parser.add_argument('--apply',action='store_true',help='Update the hosted Supabase project; sends no emails')
    args=parser.parse_args()
    load_dotenv(ROOT/'backend'/'.env')
    payload=build_payload()
    if not args.apply:
        print(json.dumps({'mode':'preview','sender_name':'TradeDesk','subjects':TEMPLATES,'site_url':args.site_url,'live_settings_changed':False},indent=2,ensure_ascii=False))
        return
    token=os.environ.get('SUPABASE_ACCESS_TOKEN','')
    if not token:raise ValueError('Set SUPABASE_ACCESS_TOKEN in backend/.env before applying. Never put it in frontend environment variables.')
    ref=project_ref(os.environ.get('SUPABASE_URL',''))
    with httpx.Client(timeout=30) as client:print(json.dumps(apply_branding(payload,ref,token,client,args.site_url),indent=2))

if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,httpx.HTTPError) as error:
        # Never print provider response bodies or headers; they may contain secrets.
        message=str(error) if isinstance(error,(ValueError,RuntimeError)) else 'Could not reach the Supabase Management API'
        raise SystemExit(message)
