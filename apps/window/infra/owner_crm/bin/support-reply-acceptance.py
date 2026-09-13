#!/usr/bin/env python3
"""One guarded native Helpdesk reply acceptance canary; dry-run by default."""
import argparse, imaplib, json, os, ssl, time, uuid
from pathlib import Path
from urllib.parse import quote
from setup_adapter import FrappeRestClient, load_credentials

TICKET="0003"; PARENT="9lvbn08rlv"; RECIPIENT="blockwise@purelymail.com"
SUBJECT="[CANARY] Owner support routing dda1b62e-8122-4e9a-be83-ff2c65dde3d1"
RECEIPT=Path("/srv/frank/verification/owner-crm-final-20260913/support-reply-acceptance.json")

def ticket(api):
 d=api._request("GET","/api/resource/HD%20Ticket/"+TICKET).get("data")
 if not isinstance(d,dict) or d.get("name")!=TICKET or d.get("subject")!=SUBJECT: raise RuntimeError("controlled_ticket_mismatch")
 return d

def parent(api):
 d=api._request("GET","/api/resource/Communication/"+PARENT).get("data")
 if not isinstance(d,dict) or d.get("name")!=PARENT or d.get("reference_doctype")!="HD Ticket" or d.get("reference_name")!=TICKET: raise RuntimeError("controlled_parent_mismatch")
 value=d.get("message_id")
 if not isinstance(value,str) or not value: raise RuntimeError("controlled_parent_message_id_missing")
 return value

def enabled(api):
 d=api._request("GET","/api/resource/HD%20Settings/HD%20Settings").get("data")
 if not isinstance(d,dict): raise RuntimeError("native_settings_unreadable")
 return d.get("enable_reply_email_via_agent") in (1,True,"1")

def read_receipt():
 if not RECEIPT.exists(): return None
 d=json.loads(RECEIPT.read_text())
 if not isinstance(d,dict) or d.get("ticket")!=TICKET or d.get("parent")!=PARENT: raise RuntimeError("unsafe_existing_receipt")
 return d

def send(api, marker):
 docs=json.dumps({"doctype":"HD Ticket","name":TICKET},separators=(",",":"))
 args=json.dumps({"message":"[CANARY] Native owner Helpdesk reply "+marker,"to":RECIPIENT},separators=(",",":"))
 return api._request("POST","/api/method/run_doc_method",body={"docs":docs,"method":"reply_via_agent","args":args})

def imap_proof(marker,parent_message_id):
 user=os.environ.get("PURELYMAIL_USERNAME",""); password=os.environ.get("PURELYMAIL_PASSWORD","")
 if user!=RECIPIENT or not password: raise RuntimeError("mailbox_credential_unavailable")
 with imaplib.IMAP4_SSL("imap.purelymail.com",993,ssl_context=ssl.create_default_context(),timeout=20) as c:
  c.login(user,password); c.select('"INBOX"',readonly=True)
  status,ids=c.search(None,"HEADER","Subject",SUBJECT)
  if status!="OK" or not ids or not ids[0]: raise RuntimeError("imap_delivery_missing")
  for mid in ids[0].split()[-10:]:
   status,data=c.fetch(mid,"(BODY.PEEK[])")
   raw=data[0][1].decode("utf-8","replace") if status=="OK" and data and isinstance(data[0],tuple) else ""
   if marker in raw and "In-Reply-To:" in raw and parent_message_id in raw: return True
 raise RuntimeError("imap_threading_missing")

def main():
 p=argparse.ArgumentParser();p.add_argument("--execute",action="store_true");a=p.parse_args()
 u,pw=load_credentials(); api=FrappeRestClient();api.login(u,pw)
 try:
  ticket(api); parent_message_id=parent(api)
  if not enabled(api): print(json.dumps({"status":"blocked","reason":"native_reply_email_disabled"}));return 2
  prior=read_receipt()
  if prior: print(json.dumps({"status":"accepted","replayed":True,"receipt":str(RECEIPT)}));return 0
  if not a.execute: print(json.dumps({"status":"ready","will_send_one":True,"recipient":RECIPIENT}));return 0
  marker=str(uuid.uuid4()); send(api,marker)
  deadline=time.monotonic()+90
  while time.monotonic()<deadline:
   try:
    if imap_proof(marker,parent_message_id): break
   except RuntimeError: time.sleep(3)
  else: raise RuntimeError("imap_delivery_or_threading_timeout")
  RECEIPT.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
  RECEIPT.write_text(json.dumps({"status":"accepted","ticket":TICKET,"parent":PARENT,"recipient":RECIPIENT,"marker":marker,"native_email_queue_sent":True,"imap_delivered":True,"threaded":True},separators=(",",":"))+"\n")
  os.chmod(RECEIPT,0o600); print(json.dumps({"status":"accepted","receipt":str(RECEIPT)}))
 finally: api.logout();api.close()
if __name__=="__main__":
 try: main()
 except Exception: print('{"status":"failed","error":"support_reply_acceptance_failed"}');raise SystemExit(2)
