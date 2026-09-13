import argparse,fcntl,json,os,sys
from pathlib import Path
from lead_intake import FrappeLeadStore,SourceClient,load_credentials,intake_one
STATE=Path("/srv/hermes/state/owner-lead-intake")
def main():
 p=argparse.ArgumentParser();p.add_argument("command",choices=["status","pause","resume","run"]);a=p.parse_args();STATE.mkdir(parents=True,exist_ok=True,mode=0o700);paused=STATE/"paused"
 if a.command=="pause":paused.touch(mode=0o600,exist_ok=True);print('{"status":"paused"}');return
 if a.command=="resume":paused.unlink(missing_ok=True);print('{"status":"resumed"}');return
 if a.command=="status":print(json.dumps({"paused":paused.exists()}));return
 if paused.exists():print('{"status":"paused"}');return
 c=load_credentials();source=SourceClient(c.secret);store=FrappeLeadStore();store.authenticate(c.api_key,c.api_secret);out=[intake_one(store,item) for item in source.page(limit=50)];print(json.dumps({"status":"ok","processed":len(out),"created":sum(x["action"]=="created" for x in out),"unchanged":sum(x["action"]=="unchanged" for x in out)}))
if __name__=="__main__":main()