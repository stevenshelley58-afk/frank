#!/usr/bin/env python3
"""Run controlled native Mautic bounce and complaint acceptance through Resend."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from typing import Any
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parent
EMAIL_FLOWS = ROOT.parent / "owner_email_flows"
for directory in (ROOT, EMAIL_FLOWS):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))
import provision
from mautic_flows import ApiError, CONSENT_FIELD, Mautic, NURTURE_EXIT_FIELD, UUID_PATTERN

RECEIPT_ROOT = Path("/srv/frank/verification/owner-mail-events")
SOURCE_SEGMENT = "Owner CRM | Opted-in education"
SIMULATORS = {
    "bounced": "email.bounced",
    "complained": "email.complained",
}
ADDRESS = re.compile(r"^(bounced|complained)\+owner-crm-[0-9a-f]{12}@resend\.dev$")
MAX_PROVIDER_EMAILS = 100
WAIT_SECONDS = 120


class AcceptanceError(RuntimeError):
    pass


def values(raw: Any, label: str, maximum: int = 500) -> list[dict[str, Any]]:
    result = list(raw.values()) if isinstance(raw, dict) else raw if isinstance(raw, list) else None
    if not isinstance(result, list) or len(result) > maximum or not all(isinstance(item, dict) for item in result):
        raise AcceptanceError(f"{label} listing was malformed")
    return result


def exact_named(api: Mautic, path: str, key: str, name: str) -> dict[str, Any]:
    matches = [item for item in api.collection(path, key) if item.get("name") == name]
    if len(matches) != 1:
        raise AcceptanceError(f"native {name} identity did not resolve exactly")
    return matches[0]


def decimal_id(value: Any, label: str) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    if isinstance(value, str) and value.isdecimal() and int(value) > 0:
        return int(value)
    raise AcceptanceError(f"{label} ID was malformed")


def simulator_address(kind: str, token: str) -> str:
    address = f"{kind}+owner-crm-{token}@resend.dev"
    if kind not in SIMULATORS or not ADDRESS.fullmatch(address):
        raise AcceptanceError("unsafe simulator address")
    return address


def contact_fields(contact: dict[str, Any]) -> dict[str, Any]:
    fields = contact.get("fields")
    result = fields.get("all") if isinstance(fields, dict) else None
    if not isinstance(result, dict):
        raise AcceptanceError("native contact fields were malformed")
    return result


def contact_state(api: Mautic, contact_id: int, expected: dict[str, str]) -> dict[str, Any]:
    contact = api.request("GET", f"contacts/{contact_id}").get("contact")
    if not isinstance(contact, dict) or decimal_id(contact.get("id"), "contact") != contact_id:
        raise AcceptanceError("native contact readback was malformed")
    fields = contact_fields(contact)
    for key, value in expected.items():
        if fields.get(key) != value:
            raise AcceptanceError(f"native contact identity drift: {key}")
    if fields.get(CONSENT_FIELD) != "opted_in":
        raise AcceptanceError("native contact consent drifted")
    records = contact.get("doNotContact")
    if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
        raise AcceptanceError("native contact DNC readback was malformed")
    return {
        "nurture": fields.get(NURTURE_EXIT_FIELD),
        "email_dnc": any(str(record.get("channel") or "").lower() == "email" for record in records),
    }


def create_contact(api: Mautic, kind: str, token: str) -> tuple[int, dict[str, str]]:
    email = simulator_address(kind, token)
    query = "contacts?" + urllib.parse.urlencode({"search": f"email:{email}", "limit": 2})
    if values(api.request("GET", query).get("contacts"), "contact", 2):
        raise AcceptanceError("controlled simulator contact already exists")
    identity = {
        "email": email,
        "blockwise_profile_id": str(uuid.uuid4()),
        "blockwise_workspace_id": str(uuid.uuid4()),
    }
    payload = {
        **identity,
        CONSENT_FIELD: "opted_in",
        NURTURE_EXIT_FIELD: "active",
        "firstname": "Owner CRM",
        "lastname": f"{kind.title()} Simulator Acceptance",
        "tags": [f"owner-mail-events-e2e:{token}:{kind}"],
    }
    contact = api.request("POST", "contacts/new", payload).get("contact")
    if not isinstance(contact, dict):
        raise AcceptanceError("native controlled contact create failed")
    contact_id = decimal_id(contact.get("id"), "contact")
    state = contact_state(api, contact_id, identity)
    if state != {"nurture": "active", "email_dnc": False}:
        raise AcceptanceError("native controlled contact was not active and unsuppressed")
    return contact_id, identity


def email_payload(run_id: str, segment_id: int) -> dict[str, Any]:
    subject = f"Owner mail event acceptance {run_id}"
    text = (
        "This controlled message verifies the native owner mail suppression path.\n\n"
        "No customer or prospect received this message.\n\n"
        "Manage email preferences: {unsubscribe_url}\n"
        "Unsubscribe from all marketing emails: {dnc_url}"
    )
    html = (
        "<!doctype html><html><body><p>This controlled message verifies the native owner mail "
        "suppression path.</p><p>No customer or prospect received this message.</p>"
        '<p><a href="{unsubscribe_url}">Manage email preferences</a><br>'
        '<a href="{dnc_url}">Unsubscribe from all marketing emails</a></p></body></html>'
    )
    return {
        "name": f"Owner CRM | Resend event acceptance | {run_id}",
        "subject": subject,
        "language": "en",
        "isPublished": False,
        "emailType": "list",
        "publicPreview": False,
        "customHtml": html,
        "plainText": text,
        "lists": [segment_id],
        "sendToDnc": False,
    }


def create_email(api: Mautic, run_id: str, segment_id: int) -> tuple[int, str]:
    desired = email_payload(run_id, segment_id)
    email = api.request("POST", "emails/new", desired).get("email")
    if not isinstance(email, dict):
        raise AcceptanceError("native acceptance email create failed")
    email_id = decimal_id(email.get("id"), "email")
    if email.get("emailType") != "list" or email.get("isPublished") not in (False, 0):
        raise AcceptanceError("native acceptance email was not held marketing mail")
    return email_id, desired["subject"]


def active_membership(contact_id: int, segment_id: int) -> bool:
    if contact_id < 1 or segment_id < 1:
        raise AcceptanceError("unsafe native membership identity")
    query = (
        "SELECT COUNT(*) FROM lead_lists_leads WHERE lead_id="
        f"{contact_id} AND leadlist_id={segment_id} AND manually_removed=0"
    )
    result = subprocess.run(
        [
            "docker", "exec", "frank-owner-marketing-db", "sh", "-lc",
            'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -Nse "$1" mautic',
            "owner-mail-events-e2e", query,
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=10,
        check=False,
    )
    if result.returncode != 0 or result.stdout.strip() not in {"0", "1"}:
        raise AcceptanceError("native source-segment membership proof failed")
    return result.stdout.strip() == "1"


def sent_count(api: Mautic, email_id: int) -> int:
    email = api.request("GET", f"emails/{email_id}").get("email")
    if not isinstance(email, dict):
        raise AcceptanceError("native email readback was malformed")
    raw = email.get("sentCount", 0)
    if isinstance(raw, str) and raw.isdecimal():
        raw = int(raw)
    if not isinstance(raw, int) or isinstance(raw, bool) or raw < 0:
        raise AcceptanceError("native email sent count was malformed")
    return raw


def send_native(api: Mautic, email_id: int, contact_id: int) -> bool:
    response = api.request("POST", f"emails/{email_id}/contact/{contact_id}/send", {})
    if response.get("success") not in (True, False):
        raise AcceptanceError("native Mautic send response was malformed")
    return response["success"] is True


def provider_message(resend: provision.Resend, subject: str, address: str) -> dict[str, Any] | None:
    response = resend.request("GET", f"/emails?limit={MAX_PROVIDER_EMAILS}")
    if response.get("object") != "list":
        raise AcceptanceError("Resend sent-email listing was malformed")
    has_more = response.get("has_more")
    if has_more is not None and not isinstance(has_more, bool):
        raise AcceptanceError("Resend sent-email pagination was malformed")
    matches = [
        item for item in values(response.get("data"), "Resend email", MAX_PROVIDER_EMAILS)
        if item.get("subject") == subject
        and {str(value).lower() for value in item.get("to", []) if isinstance(value, str)} == {address}
    ]
    if len(matches) > 1:
        raise AcceptanceError("provider message identity was ambiguous")
    return matches[0] if matches else None


def wait_for_provider_and_suppression(
    api: Mautic,
    resend: provision.Resend,
    *,
    contact_id: int,
    expected: dict[str, str],
    subject: str,
    event: str,
    segment_id: int,
    progress: dict[str, Any],
) -> dict[str, Any]:
    deadline = time.monotonic() + WAIT_SECONDS
    last_event = None
    message_id = None
    while time.monotonic() < deadline:
        message = provider_message(resend, subject, expected["email"])
        if message is not None:
            raw_id = message.get("id")
            if not isinstance(raw_id, str) or not UUID_PATTERN.fullmatch(raw_id):
                raise AcceptanceError("provider email ID was malformed")
            message_id, last_event = raw_id, message.get("last_event")
            progress["provider_email_id"] = message_id
        state = contact_state(api, contact_id, expected)
        if (
            message_id
            and last_event == event.removeprefix("email.")
            and state == {"nurture": "stopped", "email_dnc": True}
            and not active_membership(contact_id, segment_id)
        ):
            return {
                "provider_email_id": message_id,
                "provider_event": event,
                "dnc": True,
                "nurture": "stopped",
                "source_segment_exited": True,
            }
        time.sleep(2)
    raise AcceptanceError(f"timed out waiting for real provider {event} callback")


def run_case(
    admin: Mautic,
    resend: provision.Resend,
    *,
    kind: str,
    token: str,
    segment_id: int,
    email_id: int,
    subject: str,
    progress: dict[str, Any],
) -> dict[str, Any]:
    progress["stage"] = "creating_contact"
    contact_id, expected = create_contact(admin, kind, token)
    progress.update({"stage": "contact_created", "contact_id": contact_id})
    admin.request("POST", f"segments/{segment_id}/contact/{contact_id}/add")
    if not active_membership(contact_id, segment_id):
        raise AcceptanceError("controlled contact did not enter native source segment")
    progress["stage"] = "source_segment_joined"
    if not send_native(admin, email_id, contact_id):
        raise AcceptanceError("initial native Mautic marketing send was blocked")
    progress["stage"] = "awaiting_signed_callback"
    proof = wait_for_provider_and_suppression(
        admin,
        resend,
        contact_id=contact_id,
        expected=expected,
        subject=subject,
        event=SIMULATORS[kind],
        segment_id=segment_id,
        progress=progress,
    )
    progress.update({"stage": "suppression_verified", **proof})
    before = sent_count(admin, email_id)
    if send_native(admin, email_id, contact_id):
        raise AcceptanceError("native DNC failed to block the negative resend")
    after = sent_count(admin, email_id)
    if after != before:
        raise AcceptanceError("blocked negative resend changed native sent count")
    progress["stage"] = "negative_resend_verified"
    return {
        "kind": kind,
        "contact_id": contact_id,
        **proof,
        "negative_resend_blocked": True,
        "sent_count_unchanged_after_negative": True,
    }



def native_published(item: dict[str, Any], label: str) -> bool:
    raw = item.get("isPublished")
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, int) and raw in (0, 1):
        return raw == 1
    raise AcceptanceError(f"native {label} publication state was malformed")


def ensure_marketing_held(api: Mautic) -> None:
    campaigns = api.collection("campaigns", "campaigns")
    if any(
        str(campaign.get("name") or "").startswith("Owner CRM | ")
        and native_published(campaign, "owner campaign")
        for campaign in campaigns
    ):
        raise AcceptanceError("native owner campaign was not held unpublished")
    for container in ("frank-owner-marketing-cron", "frank-owner-marketing-worker"):
        check = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", container],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if check.returncode == 0 and check.stdout.strip().lower() == "true":
            raise AcceptanceError("native marketing scheduler or worker was running")


def write_receipt(run_id: str, result: dict[str, Any]) -> Path:
    RECEIPT_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = RECEIPT_ROOT / f"resend-e2e-{run_id}.json"
    if path.exists():
        raise AcceptanceError("private acceptance receipt already exists")
    temp = path.with_suffix(".tmp")
    with temp.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, separators=(",", ":"), sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temp, 0o600)
    os.replace(temp, path)
    return path


def run(run_id: str, progress: dict[str, Any]) -> dict[str, Any]:
    progress["stage"] = "checking_root"
    if os.geteuid() != 0:
        raise AcceptanceError("acceptance must run as root")
    admin_values = provision.read_env(provision.ADMIN_SECRET)
    runtime = provision.read_env(provision.RUNTIME_SECRET)
    password = admin_values.get("MAUTIC_ADMIN_PASSWORD", "")
    resend_key = runtime.get("OWNER_MAIL_EVENTS_RESEND_API_KEY", "")
    if not password or not resend_key:
        raise AcceptanceError("controlled acceptance credentials are unavailable")
    progress["stage"] = "credentials_loaded"
    admin = Mautic(provision.MAUTIC_URL, "owner", password)
    resend = provision.Resend(resend_key)
    segment = exact_named(admin, "segments", "lists", SOURCE_SEGMENT)
    segment_id = decimal_id(segment.get("id"), "segment")
    source_segment_published = native_published(segment, "source segment")
    progress.update({
        "stage": "checking_marketing_hold",
        "native_segment_id": segment_id,
        "native_source_segment_published": source_segment_published,
    })
    ensure_marketing_held(admin)
    progress["stage"] = "creating_native_email"
    email_id, subject = create_email(admin, run_id, segment_id)
    progress.update({"stage": "native_email_created", "native_email_id": email_id})
    cases = []
    for kind in SIMULATORS:
        case_progress: dict[str, Any] = {"kind": kind, "stage": "starting"}
        progress["cases"].append(case_progress)
        case = run_case(
            admin,
            resend,
            kind=kind,
            token=run_id[-12:],
            segment_id=segment_id,
            email_id=email_id,
            subject=subject,
            progress=case_progress,
        )
        case_progress.update(case)
        cases.append(case)
    progress["stage"] = "accepted"
    return {
        "status": "accepted",
        "run_id": run_id,
        "native_segment_id": segment_id,
        "native_source_segment_published": source_segment_published,
        "native_email_id": email_id,
        "native_email_type": "list",
        "native_email_published": False,
        "simulator_only": True,
        "real_signed_provider_callbacks": 2,
        "provider_manual_replay": "not_automatable_with_documented_api",
        "cases": cases,
    }


def main() -> int:
    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + secrets.token_hex(6)
    progress: dict[str, Any] = {
        "status": "running",
        "run_id": run_id,
        "stage": "starting",
        "simulator_only": True,
        "cases": [],
    }
    try:
        result = run(run_id, progress)
        receipt = write_receipt(run_id, result)
    except (AcceptanceError, ApiError, OSError, provision.ProvisionError) as error:
        progress.update({
            "status": "failed",
            "error": "owner_mail_events_resend_acceptance_failed",
            "failure_type": type(error).__name__,
        })
        try:
            receipt = write_receipt(run_id, progress)
        except (AcceptanceError, OSError):
            print('{"status":"failed","error":"owner_mail_events_resend_acceptance_failed","receipt":null}', file=sys.stderr)
            return 2
        print(json.dumps({
            "status": "failed",
            "error": "owner_mail_events_resend_acceptance_failed",
            "receipt": str(receipt),
        }, separators=(",", ":"), sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps({"status": "accepted", "receipt": str(receipt)}, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
