#!/usr/bin/env python3
"""Replay the retained native Frappe reply and verify contact 3 safely."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
INFRA = ROOT.parent
for directory in (ROOT, INFRA, INFRA / "owner_email_flows"):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))
import provision
from mautic_flows import ApiError, Mautic, NURTURE_EXIT_FIELD, UUID_PATTERN
from owner_crm_notifications import setup_adapter as notifications

SERVICE_HEALTH = "http://172.16.1.1:18085/health"
SUBJECT = "Re: owner marketing reply monitor check"
WEBHOOK = notifications.REPLY_HOOK
CONTACT_ID = "3"
CONTACT_EMAIL = "blockwise@purelymail.com"
SAFE_FRAPPE_NAME = re.compile(r"^[A-Za-z0-9._:-]{1,140}$")


class AcceptanceError(RuntimeError):
    pass


def service_ready() -> None:
    try:
        with urllib.request.urlopen(SERVICE_HEALTH, timeout=3) as response:
            value = json.loads(response.read(4097).decode())
    except Exception as error:
        raise AcceptanceError("private owner mail event receiver is unavailable") from error
    if response.status != 200 or value != {"ok": True, "service": "owner-mail-events"}:
        raise AcceptanceError("private owner mail event receiver health was invalid")


def _frappe_query(client: notifications.Client, path: str, filters: list[list[str]], fields: list[str], limit: int) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({
        "filters": json.dumps(filters, separators=(",", ":")),
        "fields": json.dumps(fields, separators=(",", ":")),
        "limit_page_length": str(limit),
        "order_by": "creation desc",
    })
    data = client._request("GET", path + "?" + query).get("data")
    if not isinstance(data, list) or len(data) > limit or not all(isinstance(item, dict) for item in data):
        raise AcceptanceError("native Frappe lookup was malformed")
    return data


def retained_communication(client: notifications.Client) -> str:
    rows = _frappe_query(client, "/api/resource/Communication", [["subject", "=", SUBJECT]], ["name"], 2)
    if len(rows) != 1 or not isinstance(rows[0].get("name"), str) or not SAFE_FRAPPE_NAME.fullmatch(rows[0]["name"]):
        raise AcceptanceError("retained reply Communication did not resolve exactly")
    return rows[0]["name"]


def enqueue_native_reply(name: str) -> None:
    if not SAFE_FRAPPE_NAME.fullmatch(name):
        raise AcceptanceError("unsafe Communication identity")
    program = f'''import frappe
from frappe.integrations.doctype.webhook.webhook import enqueue_webhook
frappe.init(site="owner.crm.internal", sites_path="sites")
frappe.connect()
try:
    doc = frappe.get_doc("Communication", {json.dumps(name)})
    enqueue_webhook(doc, {{"name": {json.dumps(WEBHOOK)}}})
finally:
    frappe.destroy()
'''
    result = subprocess.run(
        ["docker", "exec", "-i", "-w", "/home/frappe/frappe-bench", "owner-crm-backend-1", "env/bin/python", "-"],
        input=program,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise AcceptanceError("native Frappe reply replay failed")


def webhook_receipt(client: notifications.Client, name: str) -> str:
    rows = _frappe_query(
        client,
        "/api/resource/Webhook Request Log",
        [["webhook", "=", WEBHOOK], ["reference_document", "=", name]],
        ["name", "response", "error"],
        1,
    )
    if len(rows) != 1 or rows[0].get("error") not in (None, ""):
        raise AcceptanceError("native Frappe webhook delivery did not succeed")
    try:
        response = json.loads(rows[0].get("response") or "")
    except (TypeError, json.JSONDecodeError) as error:
        raise AcceptanceError("native Frappe webhook receipt was malformed") from error
    status = response.get("status") if isinstance(response, dict) else None
    if status != "stopped":
        raise AcceptanceError("native reply receiver did not stop the exact contact")
    return str(rows[0].get("name") or "")


def contact_snapshot(api: Mautic) -> dict[str, Any]:
    contact = api.request("GET", "contacts/" + CONTACT_ID).get("contact")
    if not isinstance(contact, dict) or contact.get("id") not in (3, CONTACT_ID):
        raise AcceptanceError("native Mautic contact 3 did not resolve exactly")
    fields = contact.get("fields")
    values = fields.get("all") if isinstance(fields, dict) else None
    if not isinstance(values, dict):
        raise AcceptanceError("native Mautic contact fields were malformed")
    if str(values.get("email") or contact.get("email") or "").strip().lower() != CONTACT_EMAIL:
        raise AcceptanceError("native Mautic contact email identity drifted")
    if not all(isinstance(values.get(field), str) and UUID_PATTERN.fullmatch(values[field]) for field in ("blockwise_profile_id", "blockwise_workspace_id")):
        raise AcceptanceError("native Mautic immutable identity was invalid")
    records = contact.get("doNotContact")
    if not isinstance(records, list) or not records or not all(isinstance(record, dict) for record in records):
        raise AcceptanceError("native Mautic DNC state was malformed")
    if not any(str(record.get("channel") or "").lower() == "email" for record in records):
        raise AcceptanceError("controlled contact email DNC was not preserved")
    return {"dnc": records, "nurture": values.get(NURTURE_EXIT_FIELD)}


def run() -> dict[str, Any]:
    if os.geteuid() != 0:
        raise AcceptanceError("acceptance must run as root")
    service_ready()
    runtime = provision.read_env(provision.RUNTIME_SECRET)
    username = runtime.get("OWNER_MAIL_EVENTS_MAUTIC_USERNAME", "")
    password = runtime.get("OWNER_MAIL_EVENTS_MAUTIC_PASSWORD", "")
    if username != provision.USERNAME or not password:
        raise AcceptanceError("receiver Mautic identity was unavailable")
    api = Mautic(provision.MAUTIC_URL, username, password)
    before = contact_snapshot(api)
    if before["nurture"] == "stopped":
        # This controlled record may already be stopped by an earlier bounded
        # acceptance. Replay remains required and proves idempotency.
        pass
    username_crm, password_crm = notifications.crm.load_credentials()
    client = notifications.Client()
    client.login(username_crm, password_crm)
    try:
        plan = notifications.run_setup(apply=True, client=client)
        name = retained_communication(client)
        enqueue_native_reply(name)
        first_receipt = webhook_receipt(client, name)
        first = contact_snapshot(api)
        if first["nurture"] != "stopped" or first["dnc"] != before["dnc"]:
            raise AcceptanceError("first reply replay did not preserve DNC and stop nurture")
        enqueue_native_reply(name)
        second_receipt = webhook_receipt(client, name)
        second = contact_snapshot(api)
        if second != first or not first_receipt or not second_receipt:
            raise AcceptanceError("reply replay was not idempotent")
    finally:
        try:
            client.logout()
        finally:
            client.close()
    return {
        "status": "accepted",
        "contact_id": CONTACT_ID,
        "nurture": "stopped",
        "email_dnc_preserved": True,
        "native_replays": 2,
        "webhook_actions": {item.action: sum(1 for candidate in plan if candidate.action == item.action) for item in plan},
    }


def main() -> int:
    try:
        result = run()
    except (AcceptanceError, ApiError, OSError, notifications.NotificationError, provision.ProvisionError):
        print('{"status":"failed","error":"owner_reply_acceptance_failed"}', file=sys.stderr)
        return 2
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
