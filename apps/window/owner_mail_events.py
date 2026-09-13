"""Fail-closed Resend bounce/complaint bridge for native Mautic contacts."""
from __future__ import annotations
import base64, binascii, hashlib, hmac, json, os, re, time, urllib.error, urllib.parse, urllib.request
from dataclasses import dataclass
from typing import Any, Mapping, Protocol

EVENT_TYPES=frozenset({"email.bounced","email.complained"})
UUID=re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",re.I)
UNSUBSCRIBE_HASH=re.compile(r"https://mail\.blockwise\.sale/email/unsubscribe/([A-Za-z0-9]+)/")
MAX_BODY_BYTES=64*1024
SVIX_TOLERANCE_SECONDS=300
SOURCE_SEGMENT_NAMES=("Owner CRM | Onboarding and trial help","Owner CRM | Trial ending","Owner CRM | Trial ended","Owner CRM | Opted-in education","Owner CRM | Paid welcome","Owner CRM | Cancellation follow-up","Owner CRM | Winback")
class OwnerMailEventError(RuntimeError): pass
class OwnerMailEventUnavailable(RuntimeError): pass
class JsonHttp(Protocol):
 def request(self,method:str,url:str,headers:Mapping[str,str],payload:dict[str,Any]|None=None)->dict[str,Any]: ...
@dataclass(frozen=True)
class OwnerMailEventsConfig:
 svix_secret:str; resend_api_key:str; mautic_url:str; mautic_username:str; mautic_password:str
 @classmethod
 def from_env(cls,environ:Mapping[str,str]=os.environ):
  values={"svix_secret":environ.get("RESEND_WEBHOOK_SECRET","").strip(),"resend_api_key":environ.get("OWNER_MAIL_EVENTS_RESEND_API_KEY","").strip(),"mautic_username":environ.get("OWNER_MAIL_EVENTS_MAUTIC_USERNAME","").strip(),"mautic_password":environ.get("OWNER_MAIL_EVENTS_MAUTIC_PASSWORD","")}
  if not all(values.values()): raise OwnerMailEventUnavailable("owner mail event runtime configuration is unavailable")
  url=environ.get("OWNER_MAIL_EVENTS_MAUTIC_URL","http://127.0.0.1:18106").strip().rstrip("/")
  if not url.startswith(("http://","https://")): raise OwnerMailEventUnavailable("owner mail event Mautic URL is invalid")
  return cls(mautic_url=url,**values)
class UrlLibJsonHttp:
 def request(self,method,url,headers,payload=None):
  data=json.dumps(payload,separators=(",",":" )).encode() if payload is not None else None
  try:
   with urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=dict(headers)),timeout=10) as response: raw=response.read(MAX_BODY_BYTES+1)
  except urllib.error.HTTPError as error:
   if error.code==429 or error.code>=500: raise OwnerMailEventUnavailable("upstream API is temporarily unavailable") from error
   raise OwnerMailEventError("upstream API rejected bounded lookup") from error
  except (urllib.error.URLError,OSError,TimeoutError) as error: raise OwnerMailEventUnavailable("upstream API is unavailable") from error
  if len(raw)>MAX_BODY_BYTES: raise OwnerMailEventError("upstream response exceeds bound")
  try: value=json.loads(raw.decode())
  except (UnicodeDecodeError,json.JSONDecodeError) as error: raise OwnerMailEventError("upstream response was not JSON") from error
  if not isinstance(value,dict): raise OwnerMailEventError("upstream response shape was invalid")
  return value
def _header(headers,name): return next((str(value) for key,value in headers.items() if str(key).lower()==name),"")
def verify_svix(raw:bytes,headers:Mapping[str,str],secret:str,now:float|None=None)->dict[str,Any]:
 if not raw or len(raw)>MAX_BODY_BYTES or not secret.startswith("whsec_"): raise OwnerMailEventError("invalid signature")
 ident,stamp,signatures=(_header(headers,key) for key in ("svix-id","svix-timestamp","svix-signature"))
 if not ident or len(ident)>128 or not stamp or not signatures: raise OwnerMailEventError("invalid signature")
 try: ts=int(stamp); key=base64.b64decode(secret[6:],validate=True)
 except (ValueError,binascii.Error) as error: raise OwnerMailEventError("invalid signature") from error
 if not key or abs((time.time() if now is None else now)-ts)>SVIX_TOLERANCE_SECONDS: raise OwnerMailEventError("expired signature")
 expected=base64.b64encode(hmac.new(key,(ident+"."+stamp+".").encode()+raw,hashlib.sha256).digest()).decode()
 candidates=[part[3:] for part in signatures.split() if part.startswith("v1,")]
 if not candidates or not any(hmac.compare_digest(value,expected) for value in candidates): raise OwnerMailEventError("invalid signature")
 try: event=json.loads(raw.decode())
 except (UnicodeDecodeError,json.JSONDecodeError) as error: raise OwnerMailEventError("invalid payload") from error
 if not isinstance(event,dict) or not isinstance(event.get("type"),str): raise OwnerMailEventError("invalid payload")
 return event
def _basic(username,password): return "Basic "+base64.b64encode(f"{username}:{password}".encode()).decode()
def _contact_value(contact,name):
 fields=contact.get("fields"); all_fields=fields.get("all") if isinstance(fields,dict) else None
 return all_fields.get(name) if isinstance(all_fields,dict) else contact.get(name)
def _recipients(value):
 if not isinstance(value,list): return set()
 result=set()
 for item in value:
  address=item if isinstance(item,str) else item.get("email") if isinstance(item,dict) else None
  if isinstance(address,str) and 3<=len(address)<=254: result.add(address.strip().lower())
 return result
def _tracking_hash(provider):
 # Resend's returned stored render is the proof. Do not accept a matching
 # string in provider metadata, tags or a webhook-controlled field.
 stored="\n".join(value for value in (provider.get("html"),provider.get("text")) if isinstance(value,str))
 hashes=set(UNSUBSCRIBE_HASH.findall(stored))
 if len(hashes)!=1: raise OwnerMailEventError("provider email has no unique Mautic tracking hash")
 return hashes.pop()
def _segments(http,cfg,headers):
 raw=http.request("GET",cfg.mautic_url+"/api/segments?limit=100",headers).get("lists")
 values=list(raw.values()) if isinstance(raw,dict) else raw if isinstance(raw,list) else None
 if not isinstance(values,list): raise OwnerMailEventError("Mautic segments response was malformed")
 found={}
 for item in values:
  if not isinstance(item,dict) or item.get("name") not in SOURCE_SEGMENT_NAMES: continue
  name,ident=item["name"],item.get("id")
  if name in found or not isinstance(ident,int) or ident<1: raise OwnerMailEventError("Mautic source segment identity is ambiguous")
  found[name]=ident
 if set(found)!=set(SOURCE_SEGMENT_NAMES): raise OwnerMailEventError("Mautic source segments are incomplete")
 return found
def process_event(raw:bytes,headers:Mapping[str,str],cfg:OwnerMailEventsConfig,http:JsonHttp|None=None,now:float|None=None)->str:
 event=verify_svix(raw,headers,cfg.svix_secret,now)
 if event["type"] not in EVENT_TYPES: return "ignored"
 data=event.get("data"); email_id=data.get("email_id") if isinstance(data,dict) else None
 if not isinstance(email_id,str) or not UUID.fullmatch(email_id): raise OwnerMailEventError("invalid provider email ID")
 client=http or UrlLibJsonHttp()
 provider=client.request("GET","https://api.resend.com/emails/"+email_id,{"Authorization":"Bearer "+cfg.resend_api_key,"Accept":"application/json","User-Agent":"resend-node:6.18.1"})
 tracking_hash=_tracking_hash(provider); mautic_headers={"Authorization":_basic(cfg.mautic_username,cfg.mautic_password),"Accept":"application/json"}
 query=urllib.parse.urlencode({"limit":"2","where[0][col]":"tracking_hash","where[0][expr]":"eq","where[0][val]":tracking_hash})
 stats=http_stats=client.request("GET",cfg.mautic_url+"/api/stats/email_stats?"+query,mautic_headers).get("stats")
 if not isinstance(stats,list) or len(stats)!=1 or not isinstance(stats[0],dict): raise OwnerMailEventError("Mautic tracking hash did not resolve exactly one email statistic")
 stat=stats[0]; email,lead=stat.get("email_address"),stat.get("lead_id")
 if not isinstance(email,str) or not isinstance(lead,int) or lead<1: raise OwnerMailEventError("Mautic email statistic was malformed")
 if email.strip().lower() not in _recipients(data.get("to")): raise OwnerMailEventError("provider recipient did not match native statistic")
 contact=client.request("GET",cfg.mautic_url+f"/api/contacts/{lead}",mautic_headers).get("contact")
 if not isinstance(contact,dict) or contact.get("id") not in (lead,str(lead)): raise OwnerMailEventError("Mautic statistic contact did not resolve exactly")
 profile,workspace=_contact_value(contact,"blockwise_profile_id"),_contact_value(contact,"blockwise_workspace_id")
 if not all(isinstance(value,str) and UUID.fullmatch(value) for value in (profile,workspace)): raise OwnerMailEventError("Mautic contact immutable identity is invalid")
 contact_email=_contact_value(contact,"email")
 if not isinstance(contact_email,str) or contact_email.strip().lower()!=email.strip().lower(): raise OwnerMailEventError("Mautic contact email identity drift")
 records=contact.get("doNotContact",[])
 if not isinstance(records,list) or any(not isinstance(record,dict) for record in records): raise OwnerMailEventError("Mautic contact DNC state was malformed")
 for segment_id in _segments(client,cfg,mautic_headers).values(): client.request("POST",cfg.mautic_url+f"/api/segments/{segment_id}/contact/{lead}/remove",mautic_headers)
 if not any(str(record.get("channel") or "").lower()=="email" for record in records): records=[*records,{"channel":"email","reason":3}]
 client.request("PATCH",cfg.mautic_url+f"/api/contacts/{lead}/edit",mautic_headers,{"doNotContact":records,"blockwise_nurture_exit":"stopped"})
 return "suppressed"
