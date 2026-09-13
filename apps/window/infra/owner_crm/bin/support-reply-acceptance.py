#!/usr/bin/env python3
"""Accept one fixed native Helpdesk reply; inspect only unless --execute is set."""
from __future__ import annotations
import argparse,fcntl,imaplib,json,os,re,ssl,stat,sys,tempfile,time,uuid
from contextlib import contextmanager
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
from pathlib import Path
from urllib.parse import quote,urlencode

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"owner_crm_setup"))
from setup_adapter import FrappeRestClient,SetupError,load_credentials

TICKET="0003";PARENT="9lvbn08rlv";RECIPIENT="blockwise@purelymail.com"
OWNER_USER="owner@blockwise.sale"
SUBJECT="[CANARY] Owner support routing dda1b62e-8122-4e9a-be83-ff2c65dde3d1"
OUTBOUND_SUBJECT=f"Re: {SUBJECT}"
RECEIPT=Path("/srv/frank/verification/owner-crm-final-20260913/support-reply-acceptance.json")
LOCK=RECEIPT.with_suffix(".lock")
OWNER_LOGIN=Path("/srv/frank/secrets/owner-crm-login.env")
MAIL_LOGIN=Path("/srv/frank/secrets/owner-mail.env")
MESSAGE_ID=re.compile(r"<([^<>\s]+)>")

def private_values(path,required):
 info=path.lstat()
 if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600:raise RuntimeError("unsafe_private_credential_file")
 values={}
 for raw in path.read_text(encoding="utf-8").splitlines():
  line=raw.strip()
  if not line or line.startswith("#"):continue
  key,sep,value=line.partition("=")
  if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*",key):raise RuntimeError("invalid_private_credential_file")
  values[key]=value
 if any(not values.get(k) or "\n" in values[k] or "\r" in values[k] for k in required):raise RuntimeError("required_private_credential_missing")
 return values

def owner_credentials():
 values=private_values(OWNER_LOGIN,("OWNER_CRM_USERNAME","OWNER_CRM_PASSWORD"))
 if values["OWNER_CRM_USERNAME"]!=OWNER_USER:raise RuntimeError("unexpected_owner_identity")
 return values["OWNER_CRM_USERNAME"],values["OWNER_CRM_PASSWORD"]

def login_owner(api,username,password):
 if username!=OWNER_USER or not password:raise RuntimeError("unexpected_owner_identity")
 api._request("POST","/api/method/login",form={"usr":username,"pwd":password})

def document(api,doctype,name):
 data=api._request("GET",f"/api/resource/{quote(doctype,safe='')}/{quote(name,safe='')}").get("data")
 if not isinstance(data,dict):raise RuntimeError("native_document_unreadable")
 return data

def normal_message_id(value):
 ids=MESSAGE_ID.findall(value or "")
 if len(ids)==1:return ids[0]
 plain=(value or "").strip()
 return plain if plain and not any(c.isspace() for c in plain) else ""

def preflight(api):
 ticket=document(api,"HD Ticket",TICKET)
 if ticket.get("name")!=TICKET or ticket.get("subject")!=SUBJECT:raise RuntimeError("controlled_ticket_mismatch")
 parent=document(api,"Communication",PARENT)
 expected={"name":PARENT,"reference_doctype":"HD Ticket","reference_name":TICKET,"sender":RECIPIENT,"recipients":"support@blockwise.sale","sent_or_received":"Received"}
 if any(parent.get(k)!=v for k,v in expected.items()):raise RuntimeError("controlled_parent_mismatch")
 parent_id=parent.get("message_id")
 if not isinstance(parent_id,str) or not normal_message_id(parent_id):raise RuntimeError("controlled_parent_message_id_missing")
 settings=document(api,"HD Settings","HD Settings")
 if settings.get("enable_reply_email_via_agent") not in (1,True,"1"):raise RuntimeError("native_reply_email_disabled")
 agent=document(api,"HD Agent",OWNER_USER)
 if agent.get("name")!=OWNER_USER or agent.get("user")!=OWNER_USER or agent.get("is_active") not in (1,True,"1"):raise RuntimeError("owner_agent_inactive")
 return parent_id

def verify_latest_parent(admin):
 query=urlencode({"filters":json.dumps([["reference_doctype","=","HD Ticket"],["reference_name","=",TICKET],["message_id","!=",""]],separators=(",",":")),"fields":json.dumps(["name","message_id"],separators=(",",":")),"order_by":"creation desc","limit_page_length":"2"})
 latest=admin._request("GET",f"/api/resource/Communication?{query}").get("data")
 if not isinstance(latest,list) or not latest or latest[0].get("name")!=PARENT:raise RuntimeError("controlled_parent_not_latest")

def list_rows(api,doctype,filters,fields):
 query=urlencode({"filters":json.dumps(filters,separators=(",",":")),"fields":json.dumps(fields,separators=(",",":")),"limit_page_length":"20"})
 data=api._request("GET",f"/api/resource/{quote(doctype,safe='')}?{query}").get("data")
 if not isinstance(data,list) or not all(isinstance(r,dict) for r in data) or len(data)>=20:raise RuntimeError("native_list_unreadable_or_unbounded")
 return data

def message_for(marker):return f"[CANARY support-reply:{marker}] Native owner Helpdesk reply acceptance."

def send_native(api,marker):
 args={"message":message_for(marker),"to":RECIPIENT,"cc":None,"bcc":None,"attachments":[]}
 return api._request("POST","/api/method/run_doc_method",body={"dt":"HD Ticket","dn":TICKET,"method":"reply_via_agent","args":json.dumps(args,separators=(",",":"))})

def find_communication(api,marker):
 rows=list_rows(api,"Communication",[["reference_doctype","=","HD Ticket"],["reference_name","=",TICKET],["sent_or_received","=","Sent"],["content","like",f"%{marker}%"]],["name","subject","sender","recipients","content","reference_doctype","reference_name","sent_or_received","message_id"])
 if len(rows)>1:raise RuntimeError("duplicate_native_reply")
 if not rows:return None
 row=rows[0];expected={"subject":OUTBOUND_SUBJECT,"sender":OWNER_USER,"recipients":RECIPIENT,"content":message_for(marker),"reference_doctype":"HD Ticket","reference_name":TICKET,"sent_or_received":"Sent"}
 if any(row.get(k)!=v for k,v in expected.items()):raise RuntimeError("native_reply_mismatch")
 return row

def queue_status(admin,communication):
 rows=list_rows(admin,"Email Queue",[["communication","=",communication]],["name","status","communication","reference_doctype","reference_name","sender","message_id"])
 if len(rows)>1:raise RuntimeError("duplicate_native_email_queue")
 if not rows:return None
 row=rows[0]
 senders=[address.lower() for _,address in getaddresses([str(row.get("sender",""))])]
 if row.get("communication")!=communication or row.get("reference_doctype")!="HD Ticket" or row.get("reference_name")!=TICKET or len(senders)!=1 or not senders[0].endswith("@blockwise.sale"):raise RuntimeError("native_email_queue_mismatch")
 return row

def wait_for_sent(admin,communication,deadline):
 while time.monotonic()<deadline:
  row=queue_status(admin,communication)
  if row and row.get("status")=="Sent":return row
  if row and row.get("status") in {"Error","Partially Sent"}:raise RuntimeError("native_email_queue_not_sent")
  time.sleep(2)
 raise RuntimeError("native_email_queue_timeout")

def inspect_mail(raw,marker,parent_message_id):
 message=BytesParser(policy=policy.default).parsebytes(raw)
 if str(message.get("Subject","")).strip()!=OUTBOUND_SUBJECT:return None
 froms=[a.lower() for _,a in getaddresses(message.get_all("From",[]))];tos=[a.lower() for _,a in getaddresses(message.get_all("To",[]))]
 if len(froms)!=1 or not froms[0].endswith("@blockwise.sale") or tos!=[RECIPIENT] or message.get_all("Cc",[]) or message.get_all("Bcc",[]):return None
 if MESSAGE_ID.findall(str(message.get("In-Reply-To","")))!=[normal_message_id(parent_message_id)]:return None
 bodies=[]
 for part in message.walk():
  if part.get_content_maintype()=="multipart" or part.get_content_disposition()=="attachment" or part.get_content_type() not in {"text/plain","text/html"}:continue
  try:bodies.append(part.get_content())
  except (LookupError,UnicodeDecodeError):continue
 if message_for(marker) not in "\n".join(bodies):return None
 outbound_id=normal_message_id(str(message.get("Message-ID","")))
 if not outbound_id:return None
 return {"from":froms[0],"to":RECIPIENT,"subject":OUTBOUND_SUBJECT,"in_reply_to":normal_message_id(parent_message_id),"message_id":outbound_id}

def wait_for_mail(marker,parent_message_id,deadline):
 values=private_values(MAIL_LOGIN,("PURELYMAIL_USERNAME","PURELYMAIL_PASSWORD"))
 if values["PURELYMAIL_USERNAME"]!=RECIPIENT:raise RuntimeError("unexpected_mailbox_identity")
 with imaplib.IMAP4_SSL("imap.purelymail.com",993,ssl_context=ssl.create_default_context(),timeout=20) as connection:
  connection.login(values["PURELYMAIL_USERNAME"],values["PURELYMAIL_PASSWORD"])
  if connection.select('"INBOX"',readonly=True)[0]!="OK":raise RuntimeError("imap_readonly_select_failed")
  while time.monotonic()<deadline:
   status,ids=connection.search(None,"HEADER","Subject",f'"{SUBJECT}"')
   if status!="OK":raise RuntimeError("imap_search_failed")
   for mail_id in (ids[0].split() if ids and ids[0] else [])[-25:]:
    status,data=connection.fetch(mail_id,"(BODY.PEEK[])");raw=next((x[1] for x in data or [] if isinstance(x,tuple) and isinstance(x[1],bytes)),None)
    if status=="OK" and raw and (proof:=inspect_mail(raw,marker,parent_message_id)):return proof
   time.sleep(3)
 raise RuntimeError("imap_delivery_or_threading_timeout")

def receipt_base(marker,state):return {"schema":"schema://frank.owner-support-reply-acceptance/v1","state":state,"ticket":TICKET,"parent":PARENT,"recipient":RECIPIENT,"owner_agent":OWNER_USER,"subject":SUBJECT,"marker":marker}

def write_receipt(data):
 RECEIPT.parent.mkdir(mode=0o700,parents=True,exist_ok=True);os.chmod(RECEIPT.parent,0o700)
 fd,temp=tempfile.mkstemp(prefix=RECEIPT.name+".",dir=RECEIPT.parent)
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,"w",encoding="utf-8") as handle:json.dump(data,handle,separators=(",",":"),sort_keys=True);handle.write("\n");handle.flush();os.fsync(handle.fileno())
  os.replace(temp,RECEIPT);os.chmod(RECEIPT,0o600)
  directory=os.open(RECEIPT.parent,os.O_RDONLY)
  try:os.fsync(directory)
  finally:os.close(directory)
 finally:
  if os.path.exists(temp):os.unlink(temp)

def read_receipt():
 if not RECEIPT.exists():return None
 info=RECEIPT.lstat();data=json.loads(RECEIPT.read_text(encoding="utf-8"))
 if not stat.S_ISREG(info.st_mode) or RECEIPT.is_symlink() or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600 or not isinstance(data,dict):raise RuntimeError("unsafe_existing_receipt")
 base=receipt_base(str(data.get("marker","")),str(data.get("state","")))
 if any(data.get(k)!=v for k,v in base.items()):raise RuntimeError("unsafe_existing_receipt")
 try:uuid.UUID(data["marker"])
 except (ValueError,TypeError,AttributeError):raise RuntimeError("unsafe_existing_receipt")
 if data["state"] not in {"prepared","uncertain","native_communication","accepted"}:raise RuntimeError("unsafe_existing_receipt")
 if data["state"]=="accepted":
  proof=data.get("imap")
  if data.get("queue_status")!="Sent" or not data.get("communication") or not isinstance(proof,dict) or proof.get("to")!=RECIPIENT or proof.get("subject")!=OUTBOUND_SUBJECT or not str(proof.get("from","")).endswith("@blockwise.sale") or proof.get("in_reply_to")!=data.get("parent_message_id") or not proof.get("message_id"):raise RuntimeError("unsafe_existing_receipt")
 return data

@contextmanager
def single_instance():
 RECEIPT.parent.mkdir(mode=0o700,parents=True,exist_ok=True);fd=os.open(LOCK,os.O_RDWR|os.O_CREAT,0o600)
 try:
  os.fchmod(fd,0o600)
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError("acceptance_already_running")
  yield
 finally:os.close(fd)

def reconcile(owner,admin,receipt,parent_id,timeout):
 # The owner Agent performs the send but cannot enumerate Communication rows;
 # the Administrator session is restricted here to read-only reconciliation.
 marker=receipt["marker"];communication=find_communication(admin,marker)
 if not communication:
  write_receipt({**receipt_base(marker,"uncertain"),"reason":"no_native_communication"});raise RuntimeError("native_reply_outcome_uncertain_no_resend")
 write_receipt({**receipt_base(marker,"native_communication"),"communication":communication["name"]});deadline=time.monotonic()+timeout
 queue=wait_for_sent(admin,communication["name"],deadline);mail=wait_for_mail(marker,parent_id,deadline)
 accepted={**receipt_base(marker,"accepted"),"parent_message_id":normal_message_id(parent_id),"communication":communication["name"],"queue":queue["name"],"queue_status":queue["status"],"imap":mail};write_receipt(accepted)
 return {"status":"accepted","receipt":str(RECEIPT)}

def run(execute,timeout):
 with single_instance():
  prior=read_receipt()
  if prior and prior["state"]=="accepted":return {"status":"accepted","replayed":True,"receipt":str(RECEIPT)}
  username,password=owner_credentials();owner=FrappeRestClient();login_owner(owner,username,password)
  try:
   parent_id=preflight(owner)
   admin_user,admin_password=load_credentials();admin=FrappeRestClient();admin.login(admin_user,admin_password)
   try:
    if prior:return reconcile(owner,admin,prior,parent_id,timeout)
    verify_latest_parent(admin)
    if not execute:return {"status":"ready","will_send_one":True,"recipient":RECIPIENT,"owner_agent":OWNER_USER}
    marker=str(uuid.uuid4());write_receipt(receipt_base(marker,"prepared"))
    try:send_native(owner,marker)
    except Exception:write_receipt({**receipt_base(marker,"uncertain"),"reason":"native_call_failed"})
    return reconcile(owner,admin,read_receipt(),parent_id,timeout)
   finally:
    try:admin.logout()
    finally:admin.close()
  finally:
   try:owner.logout()
   finally:owner.close()

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--execute",action="store_true");parser.add_argument("--timeout-seconds",type=int,default=120);args=parser.parse_args()
 if not 30<=args.timeout_seconds<=180:raise RuntimeError("invalid_timeout")
 print(json.dumps(run(args.execute,args.timeout_seconds),separators=(",",":"),sort_keys=True))
if __name__=="__main__":
 try:main()
 except (RuntimeError,SetupError,OSError,imaplib.IMAP4.error,json.JSONDecodeError):print('{"error":"support_reply_acceptance_failed","status":"failed"}');raise SystemExit(2)
