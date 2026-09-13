"""One-time native owner CRM service identity provisioning, run as root from committed source."""
import argparse
import json
import os
from pathlib import Path
import pwd
import secrets
import subprocess

NATIVE = r'''import json
import frappe
from frappe.permissions import add_permission, update_permission_property
frappe.init(site="owner.crm.internal", sites_path="/home/frappe/frappe-bench/sites")
frappe.connect()
frappe.set_user("Administrator")
role = "Owner CRM Sync"
user_id = "crm-sync@blockwise.sale"
try:
    if not frappe.db.exists("Role", role):
        frappe.get_doc({"doctype":"Role", "role_name":role, "desk_access":0}).insert()
    for dt, allowed in [("Contact", {"read", "write", "create"}), ("CRM Task", {"read", "write", "create"}), ("Custom Field", {"read"})]:
        add_permission(dt, role)
        for action in ["read", "write", "create", "delete", "submit", "cancel", "amend", "report", "export", "import", "share", "print", "email"]:
            update_permission_property(dt, role, 0, action, int(action in allowed), validate=False)
    if frappe.db.exists("User", user_id):
        user = frappe.get_doc("User", user_id)
        if any(row.role not in {role, "All", "Guest"} for row in user.roles):
            raise RuntimeError("dedicated user unexpectedly has another role")
    else:
        user = frappe.get_doc({"doctype":"User", "email":user_id, "first_name":"Customer Sync",
            "enabled":1, "send_welcome_email":0, "user_type":"System User", "roles":[{"role":role}]})
        user.insert()
    if not user.api_key:
        user.api_key = frappe.generate_hash(length=32)
    secret = user.get_password("api_secret", raise_exception=False)
    if not secret:
        secret = frappe.generate_hash(length=32)
        user.api_secret = secret
    user.send_welcome_email = 0
    user.save()
    # Upstream Contact has_permission may allow delete even when the role does
    # not. A native document-event rule enforces the service boundary server-side.
    guard_name = "Owner CRM Sync Contact Delete Guard"
    guard = {"doctype":"Server Script", "name":guard_name, "script_type":"DocType Event",
        "reference_doctype":"Contact", "doctype_event":"Before Delete", "disabled":0,
        "script":"if frappe.session.user == 'crm-sync@blockwise.sale':\n    frappe.throw('Customer sync cannot delete contacts', frappe.PermissionError)"}
    if frappe.db.exists("Server Script", guard_name):
        existing = frappe.get_doc("Server Script", guard_name)
        if existing.script != guard["script"] or existing.doctype_event != "Before Delete":
            raise RuntimeError("native deletion guard conflicts with existing configuration")
    else:
        frappe.get_doc(guard).insert()
    frappe.clear_cache()
    frappe.db.commit()
    print(json.dumps({"api_key":user.api_key, "api_secret":secret}))
finally:
    frappe.destroy()
'''

def atomic_write(path, contents, uid=0, gid=0):
    temp = path.with_name(path.name + ".owner-crm-new")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(contents)
        stream.flush()
        os.fsync(stream.fileno())
    os.chown(temp, uid, gid)
    os.replace(temp, path)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args=parser.parse_args()
    if not args.apply:
        print("Preview: native dedicated role/user, token, Hermes-only secret file, dedicated product snapshot secret. No email.")
        return
    if os.geteuid() != 0:
        raise SystemExit("root bootstrap required")
    source=Path(__file__).resolve().parent
    subprocess.run(["git", "-C", str(source), "diff", "--exit-code", "HEAD", "--", str(source)], check=True, stdout=subprocess.DEVNULL)
    product=Path("/srv/blockwise/product/.env")
    if product.is_symlink() or product.stat().st_mode & 0o077:
        raise SystemExit("unsafe product secret file")
    original=product.read_text()
    values=dict(line.split("=",1) for line in original.splitlines() if "=" in line and not line.startswith("#"))
    secret=values.get("OWNER_CRM_SNAPSHOT_AUTH_SECRET") or secrets.token_hex(32)
    if len(secret)<32 or secret in {values.get("BLOCKWISE_INTERNAL_AUTH_SECRET"), values.get("BLOCKWISE_INTERNAL_SECRET")}:
        raise SystemExit("dedicated snapshot key required")
    subprocess.run(["docker", "exec", "owner-crm-backend-1", "bench", "--site", "owner.crm.internal",
        "set-config", "server_script_enabled", "True", "--parse"], check=True, stdout=subprocess.DEVNULL)
    result=subprocess.run(["docker","exec","-i","-w","/home/frappe/frappe-bench/sites","owner-crm-backend-1","/home/frappe/frappe-bench/env/bin/python","-"],
        input=NATIVE, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit("native identity provisioning failed; no credentials logged")
    credentials=json.loads(result.stdout.strip().splitlines()[-1])
    account=pwd.getpwnam("hermes")
    directory=Path("/srv/hermes/secrets")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chown(directory, account.pw_uid, account.pw_gid)
    output=directory / "owner-crm-sync.env"
    if output.is_symlink():
        raise SystemExit("unsafe Hermes secret path")
    atomic_write(output, "OWNER_CRM_SNAPSHOT_AUTH_SECRET="+secret+"\nOWNER_CRM_FRAPPE_API_KEY="+credentials["api_key"]+
        "\nOWNER_CRM_FRAPPE_API_SECRET="+credentials["api_secret"]+"\n", account.pw_uid, account.pw_gid)
    if not values.get("OWNER_CRM_SNAPSHOT_AUTH_SECRET"):
        backup=product.with_name(".env.before-owner-crm-sync")
        if not backup.exists():
            atomic_write(backup, original)
        lines=[line for line in original.splitlines() if not line.startswith("OWNER_CRM_SNAPSHOT_AUTH_SECRET=")]
        atomic_write(product, "\n".join(lines)+"\nOWNER_CRM_SNAPSHOT_AUTH_SECRET="+secret+"\n")
    print("Dedicated native CRM identity and private scoped credentials provisioned; no email sent.")

if __name__ == "__main__":
    main()
