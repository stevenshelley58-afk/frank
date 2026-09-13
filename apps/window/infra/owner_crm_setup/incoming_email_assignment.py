"""Idempotent native Assignment Rule setup for owner inbox follow-up."""
from __future__ import annotations
import argparse,json,sys,urllib.parse
from dataclasses import dataclass
from typing import Any,Mapping
from setup_adapter import FrappeRestClient,SetupError,load_credentials

RULE_NAME="Owner CRM follow-up incoming email"
OWNER="owner@blockwise.sale"
CONDITION='sent_or_received == "Received" and communication_medium == "Email" and email_account == "Blockwise Owner Inbox" and reference_doctype != "HD Ticket" and sender not in ("hello@blockwise.sale", "owner@blockwise.sale")'
DESCRIPTION="Review incoming owner inbox email: {{ subject }}"
DAYS=("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")
COMPARE=("name","document_type","priority","disabled","description","assign_condition","unassign_condition","close_condition","rule")

def desired_rule()->dict[str,Any]:
 return {"doctype":"Assignment Rule","name":RULE_NAME,"document_type":"Communication","priority":100,"disabled":0,"description":DESCRIPTION,"assign_condition":CONDITION,"unassign_condition":"","close_condition":"","rule":"Round Robin","users":[{"user":OWNER}],"assignment_days":[{"day":d} for d in DAYS]}

def canonical(value:Mapping[str,Any])->dict[str,Any]:
 out={k:(value.get(k) or "") for k in COMPARE}
 out["priority"]=int(value.get("priority") or 0);out["disabled"]=int(value.get("disabled") or 0)
 users=value.get("users") or [];days=value.get("assignment_days") or []
 if not isinstance(users,list) or not isinstance(days,list):raise SetupError("Assignment Rule returned invalid child rows")
 out["users"]=[str(x.get("user") or "") for x in users if isinstance(x,Mapping)]
 out["assignment_days"]=[str(x.get("day") or "") for x in days if isinstance(x,Mapping)]
 return out

@dataclass(frozen=True)
class Plan: action:str; name:str

class Client:
 def __init__(self,rest:FrappeRestClient):self.rest=rest
 def preflight(self)->None:
  for dt in ("Communication","Assignment Rule"):
   data=self.rest._request("GET","/api/resource/DocType/"+urllib.parse.quote(dt,safe="")).get("data")
   if not isinstance(data,dict) or data.get("name")!=dt:raise SetupError("required native DocType unavailable")
  user=self.rest._request("GET","/api/resource/User/"+urllib.parse.quote(OWNER,safe="")).get("data")
  if not isinstance(user,dict) or user.get("name")!=OWNER or int(user.get("enabled") or 0)!=1:raise SetupError("owner System User is unavailable")
 def existing(self)->dict[str,Any]|None:
  filters=json.dumps([["name","=",RULE_NAME]],separators=(",",":"));fields=json.dumps(["name"],separators=(",",":"))
  data=self.rest._request("GET","/api/resource/Assignment%20Rule?"+urllib.parse.urlencode({"filters":filters,"fields":fields,"limit_page_length":"2"})).get("data")
  if not isinstance(data,list) or len(data)>1:raise SetupError("native Assignment Rule identity is ambiguous")
  if not data:return None
  doc=self.rest._request("GET","/api/resource/Assignment%20Rule/"+urllib.parse.quote(RULE_NAME,safe="")).get("data")
  if not isinstance(doc,dict):raise SetupError("native Assignment Rule response invalid")
  return doc
 def create(self,value:Mapping[str,Any])->None:
  data=self.rest._request("POST","/api/resource/Assignment%20Rule",body=value).get("data")
  if not isinstance(data,dict) or data.get("name")!=RULE_NAME:raise SetupError("native Assignment Rule creation not confirmed")

def plan(client:Client)->Plan:
 client.preflight();existing=client.existing();desired=canonical(desired_rule())
 if existing is None:return Plan("create",RULE_NAME)
 if canonical(existing)!=desired:raise SetupError("existing owner inbox Assignment Rule drifted")
 return Plan("unchanged",RULE_NAME)

def run(*,apply:bool=False,client:Client|None=None)->Plan:
 owned=client is None;rest=None;logged=False
 if client is None:
  username,password=load_credentials();rest=FrappeRestClient();client=Client(rest)
  try:rest.login(username,password);logged=True
  except Exception:rest.close();raise
 try:
  result=plan(client)
  if apply and result.action=="create":client.create(desired_rule())
  if apply:
   verified=plan(client)
   if verified.action!="unchanged":raise SetupError("native Assignment Rule apply was not verified")
  return result
 finally:
  if owned and rest:
   try:
    if logged:rest.logout()
   finally:rest.close()

def main()->int:
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true");a=p.parse_args()
 try:r=run(apply=a.apply)
 except SetupError as e:print("owner inbox assignment setup failed: "+str(e),file=sys.stderr);return 1
 print(json.dumps({"status":"applied" if a.apply else "dry_run","rule":r.name,"action":r.action},separators=(",",":")));return 0
if __name__=="__main__":raise SystemExit(main())
