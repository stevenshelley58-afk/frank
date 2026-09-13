#!/usr/bin/env python3
"""Narrow, deterministic Blockwise snapshot to native owner Frappe Contact sync."""
from __future__ import annotations
import argparse, hashlib, hmac, json, os, re, sys, time
from datetime import datetime, timezone
from urllib.parse import quote, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

MAX_PAGES=4; PAGE_SIZE=50; MAX_BYTES=1024*1024; TIMEOUT=8
IDS=("custom_blockwise_profile_uuid","custom_blockwise_workspace_uuid")
FIELDS=["name","modified","first_name","last_name",*IDS,"custom_blockwise_subscription_status","custom_blockwise_access_status","custom_blockwise_last_synced_at","custom_blockwise_source_observed_at","custom_blockwise_trial_state","custom_blockwise_trial_started_at","custom_blockwise_trial_ends_at"]
UUID=re.compile(r"^[0-9a-fA-F-]{16,64}$")
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*args): raise RuntimeError("redirect rejected")
def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def die(msg): raise RuntimeError(msg)
def env(name, secret=False):
 v=os.getenv(name,'').strip()
 if not v: die(f"missing required {'secret ' if secret else ''}{name}")
 return v
def safe_url(value,path):
 u=urlparse(value)
 if u.scheme!='http' or u.hostname not in {'127.0.0.1','localhost'} or u.path!=path or u.query or u.fragment: die('endpoint must be loopback HTTP with its exact approved path')
 return value
def request(method,url,headers=None,payload=None):
 data=json.dumps(payload,separators=(',',':')).encode() if payload is not None else None
 req=Request(url,data=data,method=method,headers=headers or {})
 try:
  with build_opener(NoRedirect()).open(req,timeout=TIMEOUT) as r: raw=r.read(MAX_BYTES+1); status=r.status
 except HTTPError as e: raw=e.read(MAX_BYTES+1); status=e.code
 except (URLError,OSError,TimeoutError): raise RuntimeError('endpoint unavailable')
 if len(raw)>MAX_BYTES: die('response too large')
 try: body=json.loads(raw.decode() or '{}')
 except (UnicodeDecodeError,json.JSONDecodeError): die('invalid JSON response')
 return status,body
def snapshot(url,key):
 stamp=str(int(time.time())); nonce=hashlib.sha256(os.urandom(32)).hexdigest(); parsed=urlparse(url); path=parsed.path + (("?" + parsed.query) if parsed.query else ""); canonical='\n'.join(('v1',stamp,nonce,'owner-crm.customer-snapshot','GET',path,hashlib.sha256(b'').hexdigest())); sig=hmac.new(key.encode(),canonical.encode(),hashlib.sha256).hexdigest()
 status,body=request('GET',url,{'x-blockwise-timestamp':stamp,'x-blockwise-nonce':nonce,'x-blockwise-scope':'owner-crm.customer-snapshot','x-blockwise-signature':sig})
 if status!=200 or not isinstance(body,dict): die('snapshot rejected')
 records=body.get('records',body.get('items'))
 if not isinstance(records,list) or len(records)>MAX_PAGES*PAGE_SIZE: die('snapshot records are malformed or exceed bound')
 return records
def frappe_headers(key,secret): return {'Authorization':f'token {key}:{secret}','Accept':'application/json','Content-Type':'application/json'}
def frappe_get(base,h,path):
 status,body=request('GET',base+path,h)
 if status!=200: return status,[]
 data=body.get('data',[]); return status,data
def frappe_one(base,h,name):
 status,body=request('GET',base+'/api/resource/Contact/'+quote(name,safe=''),h)
 data=body.get('data') if isinstance(body,dict) else None
 return status,data if isinstance(data,dict) else None
def lookup(base,h,field,value):
 filters=json.dumps([["Contact",field,"=",value]],separators=(',',':')); fields=json.dumps(FIELDS,separators=(',',':'))
 return frappe_get(base,h,'/api/resource/Contact?fields='+quote(fields,safe='')+'&filters='+quote(filters,safe='')+'&limit_page_length=2')
def contact_payload(item):
 owner=item.get('owner')
 if not isinstance(owner,dict): return None
 profile=owner.get('profileId'); workspace=item.get('workspaceId'); email=owner.get('email'); name=owner.get('name')
 if not all(isinstance(x,str) and x for x in (profile,workspace,name)): return None
 if not UUID.fullmatch(profile) or not UUID.fullmatch(workspace): return None
 first,last=(name.strip().split(None,1)+[''])[:2]
 trial=item.get('trial') if isinstance(item.get('trial'),dict) else {}
 return {"first_name":first[:140],"last_name":last[:140],"custom_blockwise_profile_uuid":profile,"custom_blockwise_workspace_uuid":workspace,"custom_blockwise_subscription_status":str(item.get('stripeSubscriptionStatus',''))[:140],"custom_blockwise_access_status":str(item.get('billingAccessState',''))[:140],"custom_blockwise_source_observed_at":item.get('sourceObservedAt'),"custom_blockwise_trial_state":trial.get('state'),"custom_blockwise_trial_started_at":trial.get('startedAt'),"custom_blockwise_trial_ends_at":trial.get('endsAt'),"_email":email}
def same_or_stale(contact,payload):
 observed=payload.get('custom_blockwise_source_observed_at'); prior=contact.get('custom_blockwise_source_observed_at')
 return isinstance(prior,str) and isinstance(observed,str) and prior>=observed
def run(mode):
 source=safe_url(env('HERMES_OWNER_CRM_SYNC_SNAPSHOT_URL'),'/api/internal/ops/owner-crm-snapshot'); hmac_key=env('OWNER_CRM_SNAPSHOT_AUTH_SECRET',True)
 base=safe_url(env('HERMES_OWNER_CRM_SYNC_FRAPPE_URL'),'') .rstrip('/')
 # safe_url exact path special case: Frappe base must be loopback root
 if base not in {'http://127.0.0.1:18081','http://localhost:18081'}: die('Frappe endpoint must be fixed owner CRM loopback')
 h=frappe_headers(env('OWNER_CRM_FRAPPE_API_KEY',True),env('OWNER_CRM_FRAPPE_API_SECRET',True))
 result={'schema':'hermes.owner-crm-sync/v1','mode':mode,'started_at':now(),'fetched':0,'created':0,'updated':0,'skipped_stale':0,'held':0,'errors':0}
 for item in snapshot(source,hmac_key):
  result['fetched']+=1; payload=contact_payload(item)
  if payload is None or item.get('mappingAmbiguities'): result['held']+=1; continue
  profile,workspace=payload[IDS[0]],payload[IDS[1]]
  _,a=lookup(base,h,IDS[0],profile); _,b=lookup(base,h,IDS[1],workspace); found={x.get('name'):x for x in a+b if isinstance(x,dict) and x.get('name')}
  if len(found)>1: result['held']+=1; continue
  if not found:
   if mode=='preview': result['created']+=1; continue
   create={k:v for k,v in payload.items() if not k.startswith('_')}; create['email_id']=payload['_email'] if isinstance(payload['_email'],str) else None; create['custom_blockwise_last_synced_at']=now()
   status,body=request('POST',base+'/api/resource/Contact',h,create)
   if status not in (200,201):
    _,a=lookup(base,h,IDS[0],profile); _,b=lookup(base,h,IDS[1],workspace); recovered={x.get('name'):x for x in a+b if x.get('name')}
    if len(recovered)!=1: result['held']+=1; continue
   result['created']+=1; continue
  contact=next(iter(found.values()))
  if same_or_stale(contact,payload): result['skipped_stale']+=1; continue
  changes={k:v for k,v in payload.items() if not k.startswith('_') and contact.get(k)!=v}
  if not changes: result['skipped_stale']+=1; continue
  if mode=='preview': result['updated']+=1; continue
  _,current=frappe_one(base,h,contact['name'])
  current=current or {}
  if current.get('modified')!=contact.get('modified'): result['held']+=1; continue
  changes['modified']=contact['modified']; changes['custom_blockwise_last_synced_at']=now(); status,_=request('PUT',base+'/api/resource/Contact/'+quote(contact['name'],safe=''),h,changes)
  if status!=200: result['held']+=1; continue
  _,after=frappe_one(base,h,contact['name'])
  if not isinstance(after,dict) or any(after.get(k)!=v for k,v in changes.items() if k!='modified'): result['held']+=1; continue
  result['updated']+=1
 result['finished_at']=now(); return result
def main(argv=None):
 p=argparse.ArgumentParser(); p.add_argument('mode',choices=('preview','apply')); a=p.parse_args(argv)
 try: print(json.dumps(run(a.mode),sort_keys=True)); return 0
 except RuntimeError as e: print(json.dumps({'schema':'hermes.owner-crm-sync/v1','status':'paused','reason':str(e)})); return 2
if __name__=='__main__': sys.exit(main())
