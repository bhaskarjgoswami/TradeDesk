"""Portable active-journal exports, including privately stored screenshots."""
import base64
import io
import json
import re
import uuid
import zipfile
from decimal import Decimal
import httpx
from ..config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from . import core, workspace

TABLES = ("workspace_items", "trades", "day_logs", "journal_settings", "routine_progress")
MAX_BYTES = 50 * 1024 * 1024
HEADERS = {"Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY, "apikey": SUPABASE_SERVICE_ROLE_KEY}
IMAGE = re.compile(r"(?<![\w/])(/?images/)([a-zA-Z0-9_.-]+)")


def snapshot(connect):
    # One SQL statement provides a consistent snapshot without changing pooled
    # connection isolation (quota transactions must retain READ COMMITTED).
    pieces = ",".join("'"+table+"',(SELECT COALESCE(json_agg(t),'[]'::json) FROM "+table+" t)" for table in TABLES)
    with connect() as conn:
        return conn.execute("SELECT json_build_object(" + pieces + ") AS data").fetchone()["data"]


def _image_url(uid, name):
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+", name) or ".." in name:
        raise ValueError("Invalid screenshot name")
    return f"{SUPABASE_URL}/storage/v1/object/{core.IMAGE_BUCKET}/{uid}/{name}"


def backup(connect, uid):
    data = snapshot(connect)
    encoded = json.dumps(data, ensure_ascii=False).encode()
    names = sorted({match.group(2) for match in IMAGE.finditer(encoded.decode())})
    if len(names) > 1000 or len(encoded) > MAX_BYTES:
        raise ValueError("Backup exceeds the 50 MB download limit")
    result = io.BytesIO()
    total = len(encoded)
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps({"product":"TradeDesk","version":1,"images":names}))
        archive.writestr("journal.json", encoded)
        with httpx.Client(headers=HEADERS, timeout=30) as client:
            for name in names:
                response = client.get(_image_url(uid, name))
                if response.status_code != 200:
                    raise ValueError("Could not include a screenshot; backup cancelled. Try again or contact support.")
                total += len(response.content)
                if total > MAX_BYTES: raise ValueError("Backup exceeds the 50 MB download limit")
                archive.writestr("images/" + name, response.content)
    return result.getvalue()


def strict_json(value):
    def reject(value):raise ValueError('Non-finite numbers are not supported')
    return json.loads(value,parse_constant=reject)


def validate_snapshot(data,names):
    """Validate every restored row before uploading files or mutating the journal."""
    if not isinstance(data,dict) or set(data)!=set(TABLES) or any(not isinstance(data[t],list) or len(data[t])>100000 for t in TABLES):
        raise ValueError('Invalid journal data')
    for table,rows in data.items():
        seen=set()
        for row in rows:
            if not isinstance(row,dict) or not row:raise ValueError('Invalid '+table+' record')
            primary='id' if table in ('trades','workspace_items') else 'key' if table=='journal_settings' else 'date' if table=='day_logs' else 'period'
            key=row.get(primary)
            if primary=='id':
                if type(key) is not int or not 1<=key<=2147483647:raise ValueError('Invalid record ID')
            elif not isinstance(key,str) or not key or len(key)>200:raise ValueError('Invalid record key')
            if key in seen:raise ValueError('Duplicate '+table+' record')
            seen.add(key)
            if 'revision' in row and (type(row['revision']) is not int or not 1<=row['revision']<=2147483647):raise ValueError('Invalid revision')
            for field in ('created_at','updated_at','ticked_at'):
                value=row.get(field)
                if value is not None and (not isinstance(value,str) or len(value)>60):raise ValueError('Invalid record time')
            if table=='trades':
                clean=core.validate_trade(row)
                row.update(clean)
                for field,shape in [('images',list),('checklist',list),('plan',dict),('review',dict)]:
                    if row.get(field):
                        value=strict_json(row[field])
                        if not isinstance(value,shape):raise ValueError('Invalid trade '+field)
                        if field=='images':workspace.image_list([path.lstrip('/') if isinstance(path,str) else path for path in value])
                for field in ('client_id','source_id','request_hash'):
                    value=row.get(field)
                    if value is not None and (not isinstance(value,str) or len(value)>250):raise ValueError('Invalid trade reference')
            elif table=='workspace_items':
                clean=workspace.validate_item({**row,'body':strict_json(row.get('body','null'))})
                row.update(kind=clean['kind'],title=clean['title'],body=json.dumps(clean['body']))
                workspace.text(row.get('client_id') or '', 'Request ID',80)
            elif table=='day_logs':core.validate_daylog(key,row)
            elif table=='journal_settings':
                value=strict_json(row.get('value','null'))
                if key.startswith('workspace_'):value=workspace.validate_settings(key[10:],value)
                elif key=='trade_plan':value=core.validate_plan_settings(value)
                elif key=='routine':value=core.validate_routine(value)
                elif key=='pending_checklist':
                    # Transient pretrade state is intentionally reset on restore.
                    continue
                else:raise ValueError('Unsupported journal setting')
                row['value']=json.dumps(value,allow_nan=False)
            elif table=='routine_progress':
                from datetime import date
                date.fromisoformat(key)
                checked=strict_json(row.get('checked','null'))
                workspace.string_list(checked,'Routine progress',100)
    data['journal_settings']=[row for row in data['journal_settings'] if row['key']!='pending_checklist']
    referenced={match.group(2) for match in IMAGE.finditer(json.dumps(data))}
    if referenced-set(names):raise ValueError('Backup is missing a referenced screenshot')
    return data


def restore(connect, uid, encoded):
    if not isinstance(encoded, str) or len(encoded) > MAX_BYTES * 1.4:
        raise ValueError("Choose a TradeDesk ZIP backup of up to 50 MB")
    try:
        raw = base64.b64decode(encoded, validate=True)
        archive = zipfile.ZipFile(io.BytesIO(raw))
        entries = archive.infolist()
        if len(entries) > 1002 or sum(item.file_size for item in entries) > MAX_BYTES:
            raise ValueError("Backup is too large")
        if len({item.filename for item in entries}) != len(entries): raise ValueError("Duplicate archive files")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("product") != "TradeDesk" or manifest.get("version") != 1:
            raise ValueError("Unsupported backup version")
        names = manifest.get("images")
        if not isinstance(names, list) or any(not isinstance(name,str) or not re.fullmatch(r"[a-zA-Z0-9_.-]+", name) or ".." in name for name in names) or len(set(names))!=len(names):
            raise ValueError("Invalid image manifest")
        if set(item.filename for item in entries) != {"manifest.json","journal.json",*("images/"+name for name in names)}:
            raise ValueError("Unexpected backup files")
        data = strict_json(archive.read("journal.json"))
        data=validate_snapshot(data,names)
    except (zipfile.BadZipFile, KeyError, TypeError, json.JSONDecodeError, UnicodeError) as exc:
        raise ValueError("Invalid TradeDesk backup") from exc
    uploaded = []
    with httpx.Client(headers=HEADERS, timeout=30) as client:
        try:
            with connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                if any(conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() for table in ("trades","day_logs","workspace_items")):
                    raise ValueError("Restore is available only in an empty journal. Existing records will never be overwritten.")
                # Validate table columns before any remote storage write.
                for table in TABLES:
                    columns={row['name'] for row in conn.execute(f'PRAGMA table_info({table})')}
                    if any(set(row)-columns for row in data[table]):raise ValueError('Unexpected journal columns')
                # Preflight every image, including later archive entries.
                for name in names:
                    if archive.getinfo('images/'+name).file_size>5*1024*1024:raise ValueError('Screenshot exceeds 5 MB')
                    if name.rsplit('.',1)[-1].lower() not in ('png','jpg','jpeg','gif','webp'):raise ValueError('Unsupported screenshot type')
                text = json.dumps(data)
                renamed = {}
                for name in names:
                    new_name = uuid.uuid4().hex + "." + name.rsplit(".",1)[-1]
                    content = archive.read("images/" + name)
                    if len(content) > 5 * 1024 * 1024: raise ValueError("Screenshot exceeds 5 MB")
                    media = {"png":"image/png","jpg":"image/jpeg","jpeg":"image/jpeg","gif":"image/gif","webp":"image/webp"}.get(new_name.rsplit(".",1)[-1].lower())
                    if not media: raise ValueError("Unsupported screenshot type")
                    response = client.post(_image_url(uid,new_name),content=content,headers={"Content-Type":media})
                    if response.status_code not in (200,201): raise ValueError("Screenshot restore failed")
                    uploaded.append(new_name)
                    renamed[name] = new_name
                data = json.loads(IMAGE.sub(lambda match: match.group(1)+renamed.get(match.group(2),match.group(2)),text))
                for table in TABLES:
                    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
                    if table in ("journal_settings","routine_progress"): conn.execute(f"DELETE FROM {table}")
                    for row in data[table]:
                        if not isinstance(row,dict) or not row or set(row)-columns: raise ValueError("Unexpected journal columns")
                        keys = list(row)
                        conn.execute(f"INSERT INTO {table} ("+",".join(keys)+") VALUES ("+",".join("?" for _ in keys)+")", [row[k] for k in keys])
                # Preserve IDs/references and advance sequences after explicit inserts.
                for table in ("trades","workspace_items"):
                    conn.execute(f"SELECT setval(pg_get_serial_sequence('{table}','id'), COALESCE((SELECT MAX(id) FROM {table}),1), EXISTS(SELECT 1 FROM {table}))")
        except Exception:
            for name in uploaded:
                client.delete(_image_url(uid,name))
            raise
    archive.close()
    return {"restored": {table:len(data[table]) for table in TABLES}}
