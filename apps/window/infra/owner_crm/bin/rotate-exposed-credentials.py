#!/usr/bin/env python3
"""One-time native credential rotation after the 2026-09-13 diagnostic leak.

Never writes secrets to stdout, command arguments, source, or ordinary logs.
The old unidentified Resend key is NOT revoked by this tool.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import urllib.parse

INFRA = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(INFRA / "owner_mail_events"))
import provision

STATE = Path("/srv/frank/secrets/credential-rotation-20260913")
CRM = Path("/srv/frank/secrets/owner-crm.env")
MARKETING = provision.ADMIN_SECRET
RECEIVER = provision.RUNTIME_SECRET


def execute(args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError("native_rotation_step_failed")
    return result.stdout


def sql(container, binary, password, statement):
    return execute(["docker", "exec", "-i", container, "sh", "-c",
                    "IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec " + binary + " -uroot -N"],
                   password + "\n" + statement + "\n")


def run():
    if os.geteuid() != 0 or STATE.exists():
        raise RuntimeError("rotation_requires_root_and_fresh_state")
    crm = provision.read_env(CRM)
    marketing = provision.read_env(MARKETING)
    receiver = provision.read_env(RECEIVER)
    keys = json.loads(Path("/srv/frank/secrets/owner-mail-rotation-20260913.json").read_text())
    for name in ("smtp", "receiver"):
        if not str(keys[name].get("token", "")).startswith("re_"):
            raise RuntimeError("replacement_provider_key_missing")
    STATE.mkdir(mode=0o700)
    for name, path in (("crm.env", CRM), ("marketing.env", MARKETING), ("receiver.env", RECEIVER)):
        shutil.copy2(path, STATE / name)
        (STATE / name).chmod(0o600)
    replacements = {"crm_root": secrets.token_hex(32), "crm_admin": secrets.token_hex(32), "marketing_db": secrets.token_hex(32)}
    staged = STATE / "new-internal-secrets.json"
    fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(replacements, stream)
    sql("owner-crm-db-1", "mariadb", crm["OWNER_CRM_DB_PASSWORD"],
        "ALTER USER 'root'@'%' IDENTIFIED BY '" + replacements["crm_root"] + "'; ALTER USER 'root'@'localhost' IDENTIFIED BY '" + replacements["crm_root"] + "';")
    if sql("owner-crm-db-1", "mariadb", replacements["crm_root"], "SELECT 1;").strip() != "1":
        raise RuntimeError("crm_root_readback_failed")
    program = """import frappe
from frappe.utils.password import update_password
frappe.init(site="owner.crm.internal", sites_path="sites")
frappe.connect()
try:
    update_password("Administrator", %s, logout_all_sessions=True)
    frappe.db.commit()
finally:
    frappe.destroy()
""" % repr(replacements["crm_admin"])
    execute(["docker", "exec", "-i", "-w", "/home/frappe/frappe-bench", "owner-crm-backend-1", "env/bin/python", "-"], program)
    crm.update(OWNER_CRM_DB_PASSWORD=replacements["crm_root"], OWNER_CRM_ADMIN_PASSWORD=replacements["crm_admin"])
    provision.write_env(CRM, crm)
    sql("frank-owner-marketing-db", "mysql", marketing["MAUTIC_DB_ROOT_PASSWORD"],
        "ALTER USER 'mautic'@'%' IDENTIFIED BY '" + replacements["marketing_db"] + "';")
    # local.php is the upstream native persistent configuration, not a vendor overlay.
    php = """$v=json_decode(stream_get_contents(STDIN),true,flags:JSON_THROW_ON_ERROR);
$p='/var/www/html/config/local.php';$parameters=[];include $p;
if(!is_array($parameters)||!isset($parameters['db_password']))exit(2);
$parameters['db_password']=$v['password'];
$t=$p.'.rotate.'.bin2hex(random_bytes(8));$m=fileperms($p)&0777;$u=fileowner($p);$g=filegroup($p);
if(file_put_contents($t,"<?php\n\$parameters = ".var_export($parameters,true).";\n",LOCK_EX)===false||!chmod($t,$m)||!chown($t,$u)||!chgrp($t,$g)||!rename($t,$p))exit(3);
"""
    execute(["docker", "exec", "-i", "frank-owner-marketing", "php", "-r", php], json.dumps({"password": replacements["marketing_db"]}))
    dsn = urllib.parse.urlsplit(marketing["MAUTIC_MAILER_DSN"])
    marketing["MAUTIC_DB_PASSWORD"] = replacements["marketing_db"]
    marketing["MAUTIC_MAILER_DSN"] = urllib.parse.urlunsplit(dsn._replace(netloc=urllib.parse.quote(dsn.username or "resend", safe="") + ":" + urllib.parse.quote(keys["smtp"]["token"], safe="") + "@" + dsn.hostname + (":" + str(dsn.port) if dsn.port else "")))
    provision.write_env(MARKETING, marketing)
    receiver["OWNER_MAIL_EVENTS_RESEND_API_KEY"] = keys["receiver"]["token"]
    provision.write_env(RECEIVER, receiver)
    receipt = {"native_credentials_rotated": ["crm_root", "crm_admin", "marketing_db"], "replacement_provider_keys_saved": True, "component_recreate_required": True, "old_resend_key_revocation_pending_exact_identity": True}
    (STATE / "receipt.json").write_text(json.dumps(receipt, indent=2))
    (STATE / "receipt.json").chmod(0o600)
    print(json.dumps(receipt))


if __name__ == "__main__":
    try:
        run()
    except Exception:
        print('{"error":"credential_rotation_incomplete_inspect_private_state"}', file=sys.stderr)
        raise SystemExit(2)
