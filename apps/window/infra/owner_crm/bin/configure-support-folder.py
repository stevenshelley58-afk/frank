#!/usr/bin/env python3
"""Add native Frappe's existing Support IMAP folder as Helpdesk tickets only."""
from __future__ import annotations
import argparse, json, sys, urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "owner_crm_setup"))
from setup_adapter import FrappeRestClient, load_credentials

ACCOUNT="Blockwise Owner Inbox"; ADDRESS="hello@blockwise.sale"; FOLDER="Support"; APPEND_TO="HD Ticket"

class SupportFolderError(RuntimeError): pass

def reconcile(rows):
    if not isinstance(rows,list) or any(not isinstance(row,dict) for row in rows): raise SupportFolderError("native IMAP folders were malformed")
    matches=[row for row in rows if row.get("folder_name")==FOLDER]
    if len(matches)>1: raise SupportFolderError("native Support folder is ambiguous")
    if matches:
        if matches[0].get("append_to")!=APPEND_TO: raise SupportFolderError("native Support folder has conflicting append target")
        return rows,False
    return [*rows,{"folder_name":FOLDER,"append_to":APPEND_TO}],True

def account(client):
    rows=client._request("GET","/api/resource/Email%20Account?"+urllib.parse.urlencode({"fields":json.dumps(["name","email_id"]),"filters":json.dumps([["name","=",ACCOUNT]]),"limit_page_length":"2"})).get("data")
    if not isinstance(rows,list) or len(rows)!=1 or rows[0].get("name")!=ACCOUNT or rows[0].get("email_id")!=ADDRESS: raise SupportFolderError("expected native owner mailbox was not found")
    current=client._request("GET","/api/resource/Email%20Account/"+urllib.parse.quote(ACCOUNT,safe="")).get("data")
    if not isinstance(current,dict) or current.get("email_id")!=ADDRESS or not isinstance(current.get("modified"),str): raise SupportFolderError("native owner mailbox response was malformed")
    return current

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--apply",action="store_true"); args=parser.parse_args()
    username,password=load_credentials(); client=FrappeRestClient(); client.login(username,password)
    try:
        current=account(client); folders,changed=reconcile(current.get("imap_folder",[]))
        if args.apply and changed:
            # Partial native update preserves every account setting and existing
            # child-row name/UID state; only the missing Support child is added.
            client._request("PUT","/api/resource/Email%20Account/"+urllib.parse.quote(ACCOUNT,safe=""),body={"imap_folder":folders,"modified":current["modified"]})
        print(json.dumps({"mode":"apply" if args.apply else "preview","native_account":ACCOUNT,"support_folder":FOLDER,"append_to":APPEND_TO,"changed":changed if args.apply else False,"mail_sent":False}))
    finally:
        client.logout(); client.close()
if __name__=="__main__":
    try: main()
    except Exception as error: sys.exit(str(error))
