"""Native Purelymail account configuration. No custom mailbox or mail worker."""
import argparse
import json
import os
from pathlib import Path
import stat
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent / "owner_crm_setup"))
from setup_adapter import FrappeRestClient,load_credentials

SECRET=Path("/srv/frank/secrets/owner-mail.env")
NAME="Blockwise Owner Inbox"
ADDRESS="hello@blockwise.sale"

def credentials():
    info=SECRET.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode)!=0o600:
        raise RuntimeError("unsafe private mailbox credentials")
    values=dict(line.split("=",1) for line in SECRET.read_text().splitlines() if "=" in line and not line.startswith("#"))
    if values.get("PURELYMAIL_USERNAME")!="blockwise@purelymail.com" or not values.get("PURELYMAIL_PASSWORD"):
        raise RuntimeError("approved mailbox credential unavailable")
    return values

def payload(password,activate=False):
    return {"doctype":"Email Account","email_account_name":NAME,"email_id":ADDRESS,
        "auth_method":"Basic","login_id_is_different":1,"login_id":"blockwise@purelymail.com","password":password,
        "enable_incoming":int(activate),"default_incoming":int(activate),"use_imap":1,"use_ssl":1,"use_starttls":0,
        "email_server":"imap.purelymail.com","incoming_port":"993","attachment_limit":10,
        "email_sync_option":"UNSEEN","initial_sync_count":"100","imap_folder":[{"folder_name":"INBOX"}],
        "append_emails_to_sent_folder":1,"sent_folder_name":"Sent","create_contact":0,"enable_automatic_linking":int(activate),
        "enable_outgoing":int(activate),"default_outgoing":int(activate),"smtp_server":"smtp.purelymail.com",
        "smtp_port":"465","use_ssl_for_outgoing":1,"use_tls":0,"no_smtp_authentication":0,
        "always_use_account_email_id_as_sender":1,"always_use_account_name_as_sender_name":0,
        "send_unsubscribe_message":0,"track_email_status":0,"enable_auto_reply":0,"notify_if_unreplied":0}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    parser.add_argument("--activate",action="store_true",help="enable native account after routing and native network acceptance")
    args=parser.parse_args()
    if args.activate and not args.apply:parser.error("--activate requires --apply")
    user,password=load_credentials()
    client=FrappeRestClient();client.login(user,password)
    try:
        import urllib.parse
        rows=client._request("GET","/api/resource/Email%20Account?"+urllib.parse.urlencode({"fields":json.dumps(["name","email_id","enable_incoming","enable_outgoing"]),"limit_page_length":100})).get("data",[])
        conflicting=[r for r in rows if r.get("email_id")==ADDRESS and r.get("name")!=NAME]
        if conflicting:raise RuntimeError("existing native account has conflicting ownership")
        existing=next((r for r in rows if r["name"]==NAME),None)
        if existing and existing["email_id"]!=ADDRESS:raise RuntimeError("existing mailbox points at another address")
        if not args.apply:
            print(json.dumps({"mode":"preview","native_account_exists":bool(existing),"address":ADDRESS,"activate":args.activate}));return
        data=payload(credentials()["PURELYMAIL_PASSWORD"],activate=args.activate)
        if existing:
            current=client._request("GET","/api/resource/Email%20Account/"+urllib.parse.quote(NAME,safe=""))["data"]
            # Preserve native IMAP UID state and child record identities on replay.
            data["imap_folder"]=current.get("imap_folder") or data["imap_folder"]
            data["modified"]=current["modified"]
            client._request("PUT","/api/resource/Email%20Account/"+urllib.parse.quote(NAME,safe=""),body=data)
        else:client._request("POST","/api/resource/Email%20Account",body=data)
        print(json.dumps({"native_account_configured":True,"address":ADDRESS,"incoming_enabled":args.activate,"outgoing_enabled":args.activate,"mail_sent":False}))
    finally:
        client.logout();client.close()

if __name__=="__main__":main()
