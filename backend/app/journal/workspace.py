"""Journal workspace (ported from the local app). No order placement or external data sharing."""
from __future__ import annotations
import hashlib
import io
import json
import math
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

KINDS = {'note', 'strategy', 'event', 'session', 'resource', 'blocked', 'feedback'}
CURRENCIES = {'USD', 'INR', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'USDT', 'SGD', 'AED', 'CHF', 'HKD', 'CNY'}
DEFAULT_PREFS = dict(currency='USD', capital=0, name='My trading journal', displayCurrency='USD', fxRate=1, fxAt='')
DEFAULT_PROFILE = dict(firstName='', lastName='', displayName='', mobile='', country='', zip='', timezone='',
                       experience='', markets='', bio='', photo='', language='', gender='', ageGroup='', tradingLevel='', onboardingCompleted=False, onboardingVersion=0)
EXPERIENCE = {'', 'Under 1 year', '1-3 years', '3-5 years', '5+ years'}
DEFAULT_GUARDRAILS = dict(enabled=False, riskPerTrade=0.5, dailyLoss=2, maxDrawdown=10,
                          maxTrades=3, maxOpenRisk=2, requireRoutine=False, requireChecklist=False)

class Conflict(ValueError):
    pass


def init(connect):
    with connect() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS workspace_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
            title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        columns={row[1] for row in conn.execute('PRAGMA table_info(workspace_items)')}
        if 'client_id' not in columns:
            conn.execute('ALTER TABLE workspace_items ADD COLUMN client_id TEXT')
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS workspace_request ON workspace_items(client_id) WHERE client_id IS NOT NULL')
        conn.execute('CREATE INDEX IF NOT EXISTS workspace_kind ON workspace_items(kind,updated_at)')
        columns={row[1] for row in conn.execute('PRAGMA table_info(trades)')}
        for name,sqltype in [('review','TEXT'),('strategy_id','INTEGER'),('entry_time','TEXT'),
                             ('exit_time','TEXT'),('contract_value','REAL'),('source_id','TEXT'),
                             ('target','REAL'),('swap','REAL')]:
            if name not in columns:
                conn.execute('ALTER TABLE trades ADD COLUMN '+name+' '+sqltype)
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS trade_source_id ON trades(source_id) WHERE source_id IS NOT NULL')


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def text(value, label, maximum=500, required=False):
    if not isinstance(value,str) or len(value)>maximum or (required and not value.strip()):
        raise ValueError(label+' is missing or too long')
    return value.strip()


def number(value, label, minimum=0, maximum=1e12):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not minimum<=value<=maximum:
        raise ValueError(label+' is outside the allowed range')
    return value


def string_list(value,label,limit=30):
    if not isinstance(value,list) or len(value)>limit:
        raise ValueError(label+' has too many items')
    clean=[text(v,label,500,True) for v in value]
    if len(set(v.casefold() for v in clean))!=len(clean):
        raise ValueError(label+' contains duplicates')
    return clean


def plan_limits(value):
    # Optional per-plan risk controls and trading window; blank fields are stored as None.
    value=value if isinstance(value,dict) else {}
    opt=lambda key,label,maximum: None if value.get(key) in (None,'') else number(value.get(key),label,0,maximum)
    clock=lambda key,label: None if not value.get(key) else (text(value.get(key),label,5) if re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d',str(value.get(key))) else (_ for _ in ()).throw(ValueError(label+' must use HH:MM')))
    clean=dict(maxTrades=opt('maxTrades','Max trades per day',1000),maxLoss=opt('maxLoss','Max daily loss',1e12),
               maxProfit=opt('maxProfit','Max daily profit',1e12),riskPct=opt('riskPct','Risk per trade',100),
               start=clock('start','Window start'),end=clock('end','Window end'),tz=text(value.get('tz') or 'UTC','Timezone',40))
    if clean['maxTrades'] is not None:
        clean['maxTrades']=int(clean['maxTrades'])
    return clean


def image_list(value):
    if not isinstance(value,list) or len(value)>8 or any(not isinstance(v,str) or not re.fullmatch(r'images/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|gif|webp)',v) for v in value):
        raise ValueError('Use up to eight uploaded reference charts')
    return value


def url(value):
    value=text(value,'Link',2000)
    if value and not re.match(r'^https?://[^\s]+$',value,re.I):
        raise ValueError('Links must start with https:// or http://')
    return value


def validate_item(data):
    if not isinstance(data,dict) or data.get('kind') not in KINDS:
        raise ValueError('Choose a valid item type')
    kind=data['kind'];title=text(data.get('title'),'Title',200,True);body=data.get('body')
    if not isinstance(body,dict):
        raise ValueError('Item content is required')
    if kind=='feedback':
        category=body.get('category')
        if category not in ('suggestion','issue','general'):
            raise ValueError('Choose a valid feedback category')
        images=image_list(body.get('images',[]))
        if len(images)>3:
            raise ValueError('Use up to three feedback images')
        clean=dict(category=category,message=text(body.get('message'),'Feedback',4000,True),images=images)
    elif kind=='note':
        clean=dict(content=text(body.get('content',''),'Note',50000),tags=text(body.get('tags',''),'Tags',500),
                   pinned=body.get('pinned') is True)
    elif kind=='strategy':
        clean=dict(charting=string_list(body.get('charting',[]),'Charting steps',15),
                   criteria=string_list(body.get('criteria',[]),'Entry criteria',25),
                   management=string_list(body.get('management',[]),'Management rules',15),
                   exitRules=text(body.get('exitRules',''),'Exit rules',4000),
                   notes=string_list(body.get('notes',[]),'Trading notes',25),
                   setupImages=image_list(body.get('setupImages',[])),entryImages=image_list(body.get('entryImages',[])),
                   description=text(body.get('description',''),'Description',2000),active=body.get('active',True) is True,
                   primary=body.get('primary') is True,limits=plan_limits(body.get('limits')))
        if not clean['criteria']:
            raise ValueError('Add at least one entry criterion')
    elif kind=='event':
        at=text(body.get('at'),'Event time',40,True)
        try:
            parsed=datetime.fromisoformat(at.replace('Z','+00:00'))
            if parsed.tzinfo is None:
                raise ValueError()
        except ValueError:
            raise ValueError('Choose an event time with a timezone')
        impact=body.get('impact','medium')
        if impact not in ('low','medium','high'):
            raise ValueError('Choose low, medium or high impact')
        clean=dict(at=at,impact=impact,currency=text(body.get('currency',''),'Currency or market',30),
                   source=url(body.get('source','')),notes=text(body.get('notes',''),'Notes',5000))
    elif kind=='session':
        clean=dict(duration=number(body.get('duration'),'Focus duration',1,120),
                   reflection=text(body.get('reflection',''),'Reflection',5000),
                   completed=body.get('completed') is True)
    elif kind=='blocked':
        date=text(body.get('date'),'Date',10,True)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):
            raise ValueError('Use a YYYY-MM-DD date')
        if body.get('direction','') not in ('','Long','Short'):
            raise ValueError('Choose Long or Short')
        clean=dict(date=date,direction=body.get('direction',''),reasons=string_list(body.get('reasons',[]),'Guardrail reasons',10),
                   override=body.get('override') is True)
    else:
        clean=dict(url=url(body.get('url','')),notes=text(body.get('notes',''),'Resource notes',20000),
                   category=text(body.get('category','Learning'),'Category',80,True))
    return dict(kind=kind,title=title,body=clean)


def item_row(row):
    result=dict(row);result['body']=json.loads(result['body']);return result


def read_settings(connect,key):
    default=DEFAULT_PREFS if key=='preferences' else DEFAULT_PROFILE if key=='profile' else DEFAULT_GUARDRAILS
    with connect() as conn:
        row=conn.execute('SELECT value,revision FROM journal_settings WHERE key=?',('workspace_'+key,)).fetchone()
    return dict(settings=json.loads(row['value']) if row else dict(default),revision=row['revision'] if row else 0)


def save_settings(connect,key,data):
    if not isinstance(data,dict) or type(data.get('revision')) is not int:
        raise ValueError('Settings and revision are required')
    value=data.get('settings')
    if not isinstance(value,dict):
        raise ValueError('Settings are required')
    if key=='profile':
        clean={field:text(value.get(field,''),label,limit) for field,label,limit in [
            ('firstName','First name',60),('lastName','Surname',60),('displayName','Display name',60),('country','Country',60),
            ('timezone','Time zone',60),('markets','Markets traded',200),('bio','Bio',500)]}
        mobile=text(value.get('mobile',''),'Mobile number',24)
        if mobile and not re.fullmatch(r'\+?[0-9][0-9 ()-]{5,22}',mobile):
            raise ValueError('Enter a mobile number with digits only, for example +91 98765 43210')
        clean['mobile']=mobile
        zipcode=text(value.get('zip',''),'Zip / postal code',12)
        if zipcode and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 -]{1,11}',zipcode):
            raise ValueError('Enter a valid zip / postal code (letters, digits, spaces or hyphens)')
        clean['zip']=zipcode
        if value.get('experience','') not in EXPERIENCE:
            raise ValueError('Choose a valid trading experience')
        clean['experience']=value.get('experience','')
        photo=value.get('photo','')
        if photo and (not isinstance(photo,str) or not re.fullmatch(r'images/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|gif|webp)',photo)):
            raise ValueError('Upload a PNG, JPG, GIF or WebP photo')
        clean['photo']=photo or ''
        for field, allowed in {
            'language': {'', 'en', 'hi', 'es', 'fr', 'de', 'pt', 'ar', 'zh-CN'},
            'gender': {'', 'man', 'woman', 'non-binary', 'prefer-not-to-say'},
            'ageGroup': {'', 'under18', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'},
            'tradingLevel': {'', 'beginner', 'intermediate', 'experienced', 'professional'},
        }.items():
            selected=value.get(field,'')
            if not isinstance(selected,str) or selected not in allowed:
                raise ValueError('Choose a valid '+field)
            clean[field]=selected
        completed=value.get('onboardingCompleted',False)
        version=value.get('onboardingVersion',0)
        if type(completed) is not bool or type(version) is not int or version not in (0,1):
            raise ValueError('Invalid onboarding state')
        clean['onboardingCompleted']=completed
        clean['onboardingVersion']=version
    elif key=='preferences':
        if value.get('currency') not in CURRENCIES:
            raise ValueError('Choose a supported journal currency')
        clean=dict(currency=value['currency'],capital=number(value.get('capital',0),'Starting balance'),name=text(value.get('name'),'Journal name',80,True))
        # Display currency converts stored amounts for viewing only; trades stay in the base currency.
        display=value.get('displayCurrency',clean['currency'])
        if display not in CURRENCIES:
            raise ValueError('Choose a supported display currency')
        clean['displayCurrency']=display
        clean['fxRate']=number(value.get('fxRate',1),'Exchange rate',1e-9,1e9)
        clean['fxAt']=text(value.get('fxAt',''),'Exchange rate time',40)
    else:
        for field in ('enabled','requireRoutine','requireChecklist'):
            if not isinstance(value.get(field),bool):
                raise ValueError('Guardrail switches must be on or off')
        clean={k:value[k] for k in ('enabled','requireRoutine','requireChecklist')}
        for field,maximum in [('riskPerTrade',10),('dailyLoss',100),('maxDrawdown',100),('maxOpenRisk',100)]:
            clean[field]=number(value.get(field),field,0.01,maximum)
        clean['maxTrades']=number(value.get('maxTrades'),'Maximum daily trades',1,100)
        if int(clean['maxTrades'])!=clean['maxTrades']:
            raise ValueError('Maximum daily trades must be a whole number')
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT revision,value FROM journal_settings WHERE key=?',('workspace_'+key,)).fetchone()
        revision=row['revision'] if row else 0
        if data['revision']!=revision:
            raise Conflict('Settings changed in another tab. Reload saved settings before saving.')
        # Currency labels never convert historic values. Require a new journal to change units after trades exist.
        if key=='preferences':
            previous=json.loads(row['value']) if row else DEFAULT_PREFS
            if previous['currency']!=clean['currency'] and conn.execute('SELECT 1 FROM trades LIMIT 1').fetchone():
                raise ValueError('This journal already has trades. Keep its currency to avoid relabeling historical amounts.')
        conn.execute('INSERT INTO journal_settings(key,value,revision) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,revision=excluded.revision',('workspace_'+key,json.dumps(clean),revision+1))
    return dict(settings=clean,revision=revision+1)


def import_trades(connect,data):
    if not isinstance(data,dict) or not isinstance(data.get('rows'),list) or not 1<=len(data['rows'])<=1000:
        raise ValueError('Import between 1 and 1,000 trades at a time')
    allowed=['date','symbol','direction','setup','entry','stop','exit','qty','pnl','fee','risk','r_multiple','notes','tags','contract_value']
    numeric={'entry','stop','exit','qty','pnl','fee','risk','r_multiple','contract_value'}
    rows=[]
    for i,raw in enumerate(data['rows']):
        if not isinstance(raw,dict):
            raise ValueError('Invalid CSV row '+str(i+1))
        row={}
        for field in allowed:
            value=raw.get(field)
            if field in numeric:
                if value in ('',None):
                    row[field]=None
                else:
                    try:row[field]=float(value)
                    except (ValueError,TypeError):raise ValueError('Invalid '+field+' on row '+str(i+1))
                    if not math.isfinite(row[field]) or abs(row[field])>1e12 or (field in ('entry','stop','exit','qty','fee','risk') and row[field]<0) or (field=='contract_value' and row[field]<=0):
                        raise ValueError('Invalid '+field+' on row '+str(i+1))
            else:
                row[field]=text(value or '',field,10000 if field=='notes' else 2000)
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',row['date']):raise ValueError()
            datetime.strptime(row['date'],'%Y-%m-%d')
        except ValueError:
            raise ValueError('Use YYYY-MM-DD dates on row '+str(i+1))
        if not row['symbol'] or row['direction'] not in ('Long','Short'):
            raise ValueError('Add a symbol and Long/Short direction on row '+str(i+1))
        if row['pnl'] is None and all(row[k] is not None for k in ('entry','exit','qty')):
            row['pnl']=(row['exit']-row['entry'])*row['qty']*(row['contract_value'] or 1)*(-1 if row['direction']=='Short' else 1)
        if row['risk'] is None and all(row[k] is not None for k in ('entry','stop','qty')):
            row['risk']=abs(row['entry']-row['stop'])*row['qty']*(row['contract_value'] or 1)
        if row['r_multiple'] is None and all(row[k] is not None for k in ('entry','stop','exit')) and row['entry']!=row['stop']:
            row['r_multiple']=(row['exit']-row['entry'])/abs(row['entry']-row['stop'])*(-1 if row['direction']=='Short' else 1)
        row['source_id']='csv:'+hashlib.sha256(json.dumps(row,sort_keys=True).encode()).hexdigest()
        row['outcome']=('Win' if row['pnl']>0 else 'Loss' if row['pnl']<0 else 'BE') if row['pnl'] is not None else None
        row['created_at']=stamp();rows.append(row)
    added=0
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        for row in rows:
            if conn.execute('SELECT 1 FROM trades WHERE source_id=?',(row['source_id'],)).fetchone():continue
            cols=list(row)
            conn.execute('INSERT INTO trades('+','.join(cols)+') VALUES('+','.join('?' for _ in cols)+')',[row[col] for col in cols]);added+=1
    return dict(imported=added,skipped=len(rows)-added)


def save_review(connect,ident,data):
    if not isinstance(data,dict) or not isinstance(data.get('review'),dict):
        raise ValueError('Review content is required')
    review=data['review']
    if review.get('followedPlan') not in (True,False,None) or not isinstance(review.get('reviewed'),bool):
        raise ValueError('Choose a valid review state')
    choices=dict(quality=['','A+','A','B','C','F'],execution=['','Excellent','Good','Average','Poor'],
                 emotionIn=['','Calm','Confident','Anxious','FOMO','Frustrated','Tired'],
                 emotionOut=['','Satisfied','Calm','Relieved','Frustrated','Regretful'])
    clean=dict(version=1,followedPlan=review.get('followedPlan'),reviewed=review['reviewed'])
    for key,options in choices.items():
        if review.get(key,'') not in options:raise ValueError('Choose a valid '+key)
        clean[key]=review.get(key,'')
    for key in ('management','mistakes'):
        clean[key]=text(review.get(key,''),key,10000)
    clean['reviewedAt']=stamp() if clean['reviewed'] else None
    notes=text(data.get('notes',''),'Notes',20000)
    with connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT * FROM trades WHERE id=?',(ident,)).fetchone()
        if not row:return dict(error='Trade not found'),404
        if (row['review'] or None)!=(data.get('expectedReview') or None) or (row['notes'] or None)!=(data.get('expectedNotes') or None):
            raise Conflict('This trade review changed in another tab. Reload it before saving.')
        conn.execute('UPDATE trades SET review=?,notes=? WHERE id=?',(json.dumps(clean),notes,ident))
    return dict(ok=True),200


def handle(connect,method,path,params,data=None):
    route=path.removeprefix('/api/workspace/').strip('/')
    if re.fullmatch(r'review/\d+',route) and method=='PUT':
        return save_review(connect,int(route.split('/')[1]),data)
    if route=='items' and method=='GET':
        kind=params.get('kind',[''])[0]
        if kind not in KINDS:raise ValueError('Choose a valid item type')
        with connect() as conn:
            rows=conn.execute('SELECT * FROM workspace_items WHERE kind=? ORDER BY updated_at DESC,id DESC',(kind,)).fetchall()
        return [item_row(row) for row in rows],200
    if route=='items' and method=='POST':
        item=validate_item(data);now=stamp();client_id=data.get('clientId')
        if client_id is not None and (not isinstance(client_id,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',client_id)):
            raise ValueError('Invalid request ID')
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if client_id:
                previous=conn.execute('SELECT * FROM workspace_items WHERE client_id=?',(client_id,)).fetchone()
                if previous:
                    if previous['kind']!=item['kind']:raise Conflict('This request ID is already in use')
                    return item_row(previous),200
            cur=conn.execute('INSERT INTO workspace_items(kind,title,body,revision,created_at,updated_at,client_id) VALUES(?,?,?,1,?,?,?)',(item['kind'],item['title'],json.dumps(item['body']),now,now,client_id))
            result=item_row(conn.execute('SELECT * FROM workspace_items WHERE id=?',(cur.lastrowid,)).fetchone())
        return result,201
    if re.fullmatch(r'items/\d+',route) and method in ('PUT','DELETE'):
        if not isinstance(data,dict) or type(data.get('revision')) is not int:raise ValueError('A valid revision is required')
        ident=int(route.split('/')[1])
        with connect() as conn:
            conn.execute('BEGIN IMMEDIATE');existing=conn.execute('SELECT * FROM workspace_items WHERE id=?',(ident,)).fetchone()
            if not existing:return dict(error='Item not found'),404
            if existing['revision']!=data['revision']:raise Conflict('This item changed in another tab. Reload it before saving.')
            if method=='DELETE':
                conn.execute('DELETE FROM workspace_items WHERE id=?',(ident,));return dict(ok=True),200
            item=validate_item(data)
            if item['kind']!=existing['kind']:raise ValueError('Item type cannot change')
            conn.execute('UPDATE workspace_items SET title=?,body=?,revision=revision+1,updated_at=? WHERE id=?',(item['title'],json.dumps(item['body']),stamp(),ident))
            result=item_row(conn.execute('SELECT * FROM workspace_items WHERE id=?',(ident,)).fetchone())
        return result,200
    if route in ('preferences','guardrails','profile'):
        if method=='GET':return read_settings(connect,route),200
        if method=='PUT':return save_settings(connect,route,data),200
    if route=='import' and method=='POST':return import_trades(connect,data),200
    return dict(error='Not found'),404


def backup(connect, images_dir=None):
    """ZIP of the whole journal as JSON (the cloud has no SQLite file to copy).
    Chart images stay in private storage; the export lists their paths."""
    tables = ('trades', 'day_logs', 'workspace_items', 'journal_settings', 'routine_progress')
    data = {}
    with connect() as conn:
        for table in tables:
            data[table] = [dict(row) for row in conn.execute(f'SELECT * FROM {table}').fetchall()]
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('journal.json', json.dumps(data, indent=2, default=str))
        archive.writestr('README.txt', 'TradeDesk backup: every journal record (trades, day logs, plans, notes, settings, '
                         'routine progress) as JSON. Chart images are referenced by path. Contains no passwords or '
                         'broker credentials. Keep this file private.\n')
    return result.getvalue()
