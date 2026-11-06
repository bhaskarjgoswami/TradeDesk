"""Private operator CLI. Run from backend with its existing database credentials.
No administrative HTTP endpoint or new staff privilege is exposed to browsers.
"""
import argparse
import json
import re
import sys
import uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from psycopg2 import sql
from app.database import get_conn
from app.journal.pgcompat import schema_for


def tenants(cur):
    cur.execute("SELECT n.nspname FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid AND c.relname='workspace_items' WHERE n.nspname ~ '^j_[0-9a-f]{32}$' ORDER BY n.nspname")
    return [row['nspname'] for row in cur.fetchall()]


def owner(schema):return str(uuid.UUID(schema[2:]))


def feedback(limit=50,status='open',summary=False):
    entries=[];counts=dict(open=0,triaged=0,closed=0)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION READ ONLY')
            for schema in tenants(cur):
                cur.execute(sql.SQL("SELECT w.id,w.title,w.body,w.created_at,COALESCE(t.status,'open') AS status,COALESCE(t.reply,'') AS reply FROM {}.workspace_items w LEFT JOIN public.feedback_triage t ON t.user_id=%s AND t.item_id=w.id WHERE w.kind='feedback' ORDER BY w.created_at DESC LIMIT 1000").format(sql.Identifier(schema)),(owner(schema),))
                for row in cur.fetchall():
                    counts[row['status']]+=1
                    if not summary and (status=='all' or row['status']==status):entries.append(dict(user_id=owner(schema),**row))
    entries.sort(key=lambda row:row['created_at'],reverse=True)
    return dict(counts=counts,items=entries[:limit],limit_per_account=1000)


def triage(uid,ident,status,reply=None):
    if reply is not None and len(reply)>4000:raise ValueError("Use a reply of up to 4000 characters")
    schema=schema_for(uid)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql.SQL("SELECT 1 FROM {}.workspace_items WHERE id=%s AND kind='feedback'").format(sql.Identifier(schema)),(ident,))
            if not cur.fetchone():raise ValueError('Feedback not found')
            cur.execute('INSERT INTO public.feedback_triage(user_id,item_id,status,reply) VALUES(%s,%s,%s,%s) ON CONFLICT(user_id,item_id) DO UPDATE SET status=excluded.status,reply=COALESCE(%s,public.feedback_triage.reply),updated_at=now()',(uid,ident,status,reply or '',reply))
    return dict(updated=True,status=status)


def metrics():
    result=dict(accounts=0,onboarding_completed=0,journals_with_trades=0,active_journals_7d=0,trades=0)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION READ ONLY')
            cur.execute("SELECT id,created_at,created_at<=now()-interval '14 days' AS mature FROM public.user_profiles WHERE deletion_started_at IS NULL")
            accounts={str(row['id']):row for row in cur.fetchall()}
            result['accounts']=len(accounts)
            mature=sum(bool(row['mature']) for row in accounts.values())
            retained=0
            for schema in tenants(cur):
                account=accounts.get(owner(schema))
                if not account:continue
                cur.execute(sql.SQL("SELECT (SELECT count(*) FROM {}.trades) AS trades,(SELECT count(*) FROM {}.trades WHERE created_at::timestamptz >= now()-interval '7 days') AS recent,(SELECT value FROM {}.journal_settings WHERE key='workspace_profile') AS profile,EXISTS(SELECT 1 FROM {}.trades WHERE created_at::timestamptz >= %s::timestamptz+interval '7 days' AND created_at::timestamptz < %s::timestamptz+interval '14 days') AS retained").format(*[sql.Identifier(schema)]*4),(account['created_at'],account['created_at']))
                row=cur.fetchone();result['trades']+=row['trades'];result['journals_with_trades']+=int(row['trades']>0);result['active_journals_7d']+=int(row['recent']>0)
                retained+=int(bool(account['mature']) and row['retained'])
                if row['profile'] and json.loads(row['profile']).get('onboardingCompleted'):result['onboarding_completed']+=1
    result['activation_rate']=round(result['journals_with_trades']/result['accounts'],4) if result['accounts'] else 0
    result['week_one_retention']=dict(eligible_accounts=mature,retained_accounts=retained,
        rate=round(retained/mature,4) if mature else None,
        definition='Accounts at least 14 days old with a trade logged at account age [7,14) days. Accounts without journals count in the denominator; recently created accounts are excluded. Deleted trades are not retained as analytics events.')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='command',required=True)
    inbox=commands.add_parser('feedback');inbox.add_argument('--summary',action='store_true');inbox.add_argument('--status',choices=['open','triaged','closed','all'],default='open');inbox.add_argument('--limit',type=int,default=50)
    mark=commands.add_parser('triage');mark.add_argument('--user',required=True);mark.add_argument('--id',type=int,required=True);mark.add_argument('--status',choices=['open','triaged','closed'],required=True)
    mark.add_argument('--reply-file',type=Path,help='UTF-8 text shown privately to this user')
    commands.add_parser('metrics')
    args=parser.parse_args()
    if args.command=='feedback':result=feedback(max(1,min(args.limit,200)),args.status,args.summary)
    elif args.command=='triage':result=triage(args.user,args.id,args.status,args.reply_file.read_text() if args.reply_file else None)
    else:result=metrics()
    print(json.dumps(result,default=str,indent=2,ensure_ascii=False))


if __name__=='__main__':main()
