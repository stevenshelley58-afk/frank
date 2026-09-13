"""Bounded Blockwise audit/demo request intake into native Frappe CRM Lead.
Never merges by email, sends email, or derives consent. Source identity is only
blockwise_demo_request:<public.demo_requests.id>."""
from __future__ import annotations
import hashlib,hmac,json,os,re,secrets,time,urllib.error,urllib.parse,urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any,Mapping
BLOCKWISE_URL="http://127.0.0.1:8080"; FRAPPE_URL="http://127.0.0.1:18081"; SITE="owner.crm.internal"
SECRET_FILE=Path("/srv/hermes/secrets/owner-lead-intake.env"); UUID=re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",re.I)
SOURCE_PREFIX="blockwise_demo_request:"; SOURCE_FIELD="custom_blockwise_source_key"; ELIGIBILITY_FIELD="custom_blockwise_eligibility"
class IntakeError(RuntimeError): pass
@dataclass(frozen=True)
class Credentials: secret:str; api_key:str; api_secret:str

def load_credentials(path:Path=SECRET_FILE)->Credentials:
    try: lines=path.read_text().splitlines()
    except OSError as e: raise IntakeError("lead intake secret file unavailable") from e
    values = {}
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#"):
            key, separator, value = line.partition("=")
            if separator: values[key] = value
    try: c=Credentials(values["OWNER_LEAD_INTAKE_AUTH_SECRET"],values["OWNER_CRM_FRAPPE_API_KEY"],values["OWNER_CRM_FRAPPE_API_SECRET"])
    except KeyError as e: raise IntakeError("lead intake secret missing required key") from e
    if len(c.secret)<32 or any("\n" in x or "\r" in x for x in (c.secret,c.api_key,c.api_secret)): raise IntakeError("lead intake credentials invalid")
    return c

def _text(value:Any,limit:int=500)->str|None:
    return value if isinstance(value,str) and 0<len(value)<=limit else None
@dataclass(frozen=True)
class LeadRequest:
    source_key:str; source_kind:str; source_event_id:str; received_at:str; name:str; email:str; phone:str|None; agency:str|None

def map_item(raw:Mapping[str,Any])->LeadRequest:
    key=_text(raw.get("sourceKey"),100); event=_text(raw.get("sourceEventId"),36); kind=_text(raw.get("sourceKind"),40); at=_text(raw.get("receivedAt"),64); lead=raw.get("lead")
    if not key or not event or not UUID.fullmatch(event) or key!=SOURCE_PREFIX+event or kind not in {"audit_request","demo_request"} or not at or not isinstance(lead,Mapping): raise IntakeError("source item has invalid immutable identity")
    name=_text(lead.get("name")); email=_text(lead.get("email"));
    if not name or not email: raise IntakeError("source item missing required lead fields")
    return LeadRequest(key,kind,event,at,name,email,_text(lead.get("phone"),80),_text(lead.get("agency"),200))
class SourceClient:
 def __init__(self,secret:str,opener=None): self.secret=secret; self.open=opener or urllib.request.build_opener().open
 def page(self,after_id:str|None=None,limit:int=50)->list[LeadRequest]:
    if not 1<=limit<=100 or (after_id and not UUID.fullmatch(after_id)): raise IntakeError("invalid source page request")
    query={"limit":str(limit)}; query.update({"afterId":after_id} if after_id else {}); path="/api/internal/ops/owner-lead-intake?"+urllib.parse.urlencode(query); now=str(int(time.time())); nonce=secrets.token_hex(16); digest=hashlib.sha256(b"").hexdigest(); signed="\n".join(["v1",now,nonce,"owner-crm.lead-intake","GET",path,digest]); sig=hmac.new(self.secret.encode(),signed.encode(),hashlib.sha256).hexdigest()
    request=urllib.request.Request(BLOCKWISE_URL+path,headers={"Host":"blockwise.sale","x-blockwise-timestamp":now,"x-blockwise-nonce":nonce,"x-blockwise-scope":"owner-crm.lead-intake","x-blockwise-signature":sig})
    try:
      with self.open(request,timeout=15) as response: raw=response.read(2*1024*1024+1)
    except (OSError,urllib.error.HTTPError) as e: raise IntakeError("lead source unavailable") from e
    if len(raw)>2*1024*1024: raise IntakeError("lead source response too large")
    try: decoded=json.loads(raw)
    except ValueError as e: raise IntakeError("lead source returned invalid JSON") from e
    if not isinstance(decoded,dict) or not isinstance(decoded.get("items"),list): raise IntakeError("lead source response invalid")
    return [map_item(item) for item in decoded["items"] if isinstance(item,dict)]
class FrappeLeadStore:
 def __init__(self,opener=None): self.open=opener or urllib.request.build_opener().open; self.token=""
 def request(self,method,path,body=None):
    if not path.startswith("/") or "://" in path: raise IntakeError("invalid native CRM path")
    data=json.dumps(body,separators=(",",":")).encode() if body is not None else None; headers={"Accept":"application/json","Host":SITE,"X-Frappe-Site-Name":SITE,"Authorization":"token "+self.token};
    if data: headers["Content-Type"]="application/json"
    try:
      with self.open(urllib.request.Request(FRAPPE_URL+path,data=data,headers=headers,method=method),timeout=15) as response: raw=response.read(2*1024*1024+1)
    except urllib.error.HTTPError as e:
      if e.code in {409,417}: raise IntakeError("native CRM rejected a conflicting Lead") from None
      raise IntakeError(f"native CRM request failed ({e.code})") from None
    except OSError as e: raise IntakeError("native CRM unavailable") from e
    try: value=json.loads(raw)
    except ValueError as e: raise IntakeError("native CRM returned invalid JSON") from e
    if not isinstance(value,dict): raise IntakeError("native CRM response invalid")
    return value
 def authenticate(self,key,secret):
    self.token=key+":"+secret
    if self.request("GET","/api/method/frappe.auth.get_logged_user").get("message")!="crm-sync@blockwise.sale": self.token=""; raise IntakeError("native CRM token is not the integration identity")
 def find(self,key):
    query=urllib.parse.urlencode({"filters":json.dumps([[SOURCE_FIELD,"=",key]]),"fields":json.dumps(["name",SOURCE_FIELD]),"limit_page_length":"2"}); data=self.request("GET","/api/resource/CRM%20Lead?"+query).get("data")
    if not isinstance(data,list) or len(data)>1: raise IntakeError("native source identity is ambiguous")
    return data[0] if data else None
 def create(self,item:LeadRequest):
    payload={"lead_name":item.name,"first_name":item.name.split(None, 1)[0],"status":"New","email":item.email,SOURCE_FIELD:item.source_key,ELIGIBILITY_FIELD:"review_required"}
    if item.phone: payload["mobile_no"]=item.phone
    if item.agency: payload["organization"]=item.agency
    data=self.request("POST","/api/resource/CRM%20Lead",payload).get("data")
    if not isinstance(data,dict) or not data.get("name"): raise IntakeError("native CRM did not confirm Lead")
    return str(data["name"])
def intake_one(store:FrappeLeadStore,item:LeadRequest)->dict[str,str]:
    existing=store.find(item.source_key)
    if existing: return {"action":"unchanged","lead":str(existing.get("name","")),"sourceKey":item.source_key}
    try: name=store.create(item)
    except IntakeError:
      existing=store.find(item.source_key)
      if existing: return {"action":"unchanged","lead":str(existing.get("name","")),"sourceKey":item.source_key}
      raise
    return {"action":"created","lead":name,"sourceKey":item.source_key}