"""Bounded native lead import with exclusive execution and durable scan progress."""
import argparse,fcntl,json,os,sys,tempfile
from datetime import datetime,timezone
from pathlib import Path
from lead_intake import FrappeLeadStore,SourceClient,load_credentials,intake_one,IntakeError,UUID
STATE=Path("/srv/hermes/state/owner-lead-intake")
PAGE_SIZE=50
MAX_PAGES=20

def save(path,value):
    fd,temp=tempfile.mkstemp(prefix="."+path.name+".",dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"w") as f:json.dump(value,f);f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def cycle(source,store,after_id=None,checkpoint=lambda value:None,max_pages=MAX_PAGES):
    if after_id is not None and not UUID.fullmatch(after_id):raise IntakeError("invalid stored source cursor")
    result={"status":"ok","processed":0,"created":0,"unchanged":0,"pages":0,"scan_complete":False}
    for _ in range(max_pages):
        items=source.page(after_id=after_id,limit=PAGE_SIZE)
        for item in items:
            action=intake_one(store,item)["action"]
            result["processed"]+=1;result[action]+=1
        result["pages"]+=1
        after_id=items[-1].source_event_id if len(items)==PAGE_SIZE else None
        checkpoint(after_id)
        if after_id is None:
            result["scan_complete"]=True
            break
    return result

def main():
    p=argparse.ArgumentParser();p.add_argument("command",choices=["status","pause","resume","run"]);a=p.parse_args()
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    if STATE.is_symlink():raise IntakeError("unsafe lead intake state directory")
    paused=STATE/"paused";receipt=STATE/"last-run.json";cursor=STATE/"cursor.json"
    if a.command=="pause":paused.touch(mode=0o600,exist_ok=True);print('{"status":"paused"}');return
    if a.command=="resume":paused.unlink(missing_ok=True);print('{"status":"resumed"}');return
    if a.command=="status":
        print(json.dumps({"paused":paused.exists(),"last_run":json.loads(receipt.read_text()) if receipt.exists() else None}));return
    with (STATE/"run.lock").open("a") as lock:
        os.chmod(STATE/"run.lock",0o600)
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print('{"status":"already_running"}');return
        if paused.exists():print('{"status":"paused"}');return
        try:
            c=load_credentials();source=SourceClient(c.secret);store=FrappeLeadStore();store.authenticate(c.api_key,c.api_secret)
            after=json.loads(cursor.read_text()).get("after_id") if cursor.exists() else None
            result=cycle(source,store,after,lambda value:save(cursor,{"after_id":value}))
        except Exception:
            save(receipt,{"status":"error","category":"native_intake_failed","checked_at":datetime.now(timezone.utc).isoformat()})
            raise IntakeError("lead intake failed; last completed page retained") from None
        result["checked_at"]=datetime.now(timezone.utc).isoformat();save(receipt,result);print(json.dumps(result))
if __name__=="__main__":
    try:main()
    except IntakeError as error:sys.exit(str(error))
