"""Guarded activation of native Frappe scheduler/mail. Preview by default."""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent / "owner_crm"
ENV = Path("/srv/frank/secrets/owner-crm.env")
SITE = "owner.crm.internal"
ACCOUNT = "Blockwise Owner Inbox"
PROBE = r"""
import frappe, json
frappe.init(site="owner.crm.internal", sites_path="sites")
frappe.connect()
try:
    rows=frappe.get_all("Email Account", fields=["name","email_id","enable_incoming","enable_outgoing"])
    pending=frappe.db.count("Email Queue", {"status":["not in",["Sent","Cancelled"]]})
    notifications=frappe.db.count("Notification", {"enabled":1,"channel":"Email"})
    reports=frappe.db.count("Auto Email Report", {"enabled":1})
    print(json.dumps({"accounts":rows,"pending_queue":pending,"enabled_email_notifications":notifications,"enabled_email_reports":reports}))
finally:
    frappe.destroy()
"""

def validate(state):
    if state["pending_queue"]:
        raise RuntimeError("Unsent native email queue must be reviewed before activation")
    if state["enabled_email_notifications"] or state["enabled_email_reports"]:
        raise RuntimeError("Native automatic email rules must be reviewed before activation")
    expected=[r for r in state["accounts"] if r["name"] == ACCOUNT]
    if len(expected) != 1 or expected[0]["email_id"] != "hello@blockwise.sale":
        raise RuntimeError("Expected owner mailbox is not configured")
    if not expected[0]["enable_incoming"] or not expected[0]["enable_outgoing"]:
        raise RuntimeError("Verify provider routing and activate the native account first")
    if any(r["name"] != ACCOUNT and (r["enable_incoming"] or r["enable_outgoing"]) for r in state["accounts"]):
        raise RuntimeError("Unexpected enabled native mailbox requires review")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args=parser.parse_args()
    info=ENV.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError("Unsafe private owner CRM environment")
    if subprocess.check_output(["git","-C",str(ROOT),"status","--porcelain"],text=True).strip():
        raise RuntimeError("Source checkout must be clean and committed")
    sha=subprocess.check_output(["git","-C",str(ROOT),"rev-parse","HEAD"],text=True).strip()
    subprocess.run(["git","-C",str(ROOT),"merge-base","--is-ancestor",sha,"origin/main"],check=True)
    env={**os.environ,"OWNER_CRM_SOURCE_SHA":sha}
    compose=["docker","compose","--project-directory",str(ROOT),"--env-file",str(ENV),"-f",str(ROOT / "compose.yaml")]
    def run(arguments, **kwargs):
        return subprocess.run(compose+arguments,env=env,check=True,capture_output=True,text=True,**kwargs)
    run(["--profile","owner-mail","config","-q"])
    state=json.loads(run(["exec","-T","backend","./env/bin/python","-"],input=PROBE).stdout)
    validate(state)
    if not args.apply:
        print(json.dumps({"mode":"preview","queue_empty":True,"native_mailbox_ready":True,"source_sha":sha}))
        return
    try:
        run(["exec","-T","backend","bench","--site",SITE,"set-config","mute_emails","0"])
        run(["exec","-T","backend","bench","--site",SITE,"set-config","enable_scheduler","1"])
        run(["exec","-T","backend","bench","--site",SITE,"enable-scheduler"])
        run(["--profile","owner-mail","up","-d","scheduler"])
        statuses=json.loads(run(["--profile","owner-mail","ps","--format","json","scheduler"]).stdout)
        if isinstance(statuses,list): statuses=statuses[0] if len(statuses)==1 else {}
        if statuses.get("State") != "running": raise RuntimeError("Native scheduler did not start")
    except Exception:
        # Restore the mail gate on a failed activation. Never delete queued mail.
        run(["exec","-T","backend","bench","--site",SITE,"set-config","mute_emails","1"])
        run(["exec","-T","backend","bench","--site",SITE,"disable-scheduler"])
        run(["exec","-T","backend","bench","--site",SITE,"set-config","enable_scheduler","0"])
        raise RuntimeError("Activation failed; native mail gate restored") from None
    print(json.dumps({"native_scheduler_running":True,"native_mail_enabled":True,"source_sha":sha,"delivery_acceptance_required":True}))

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        # Container failures can carry private configuration. Never print their output.
        if isinstance(exc, subprocess.CalledProcessError):
            sys.exit("Native activation command failed; private output withheld")
        sys.exit(str(exc))
