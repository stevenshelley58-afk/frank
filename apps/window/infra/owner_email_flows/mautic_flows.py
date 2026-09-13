#!/usr/bin/env python3
"""Idempotent native Mautic flow setup and fail-closed enrolment bridge."""
from __future__ import annotations

import argparse, base64, json, os, sys, urllib.error, urllib.parse, urllib.request
from dataclasses import dataclass
from typing import Any

PREFIX = "Owner CRM | "

@dataclass(frozen=True)
class Flow:
    key: str; title: str; event: str; subject: str; preheader: str; text: str; cold: bool = False

FLOWS = (
    Flow("onboarding_trial_help", "Onboarding and trial help", "blockwise.onboarding_trial_help",
         "A simple place to start in Blockwise", "Use the next step that helps your lead-generation setup move forward.",
         "Hi {contactfield=firstname}\n\nStart with the next useful step in Blockwise. Choose a lead goal, add your offer and brand details, then review the ad pack before you publish.\n\nOpen Blockwise: https://blockwise.sale\n\nBlockwise"),
    Flow("trial_ending", "Trial ending", "blockwise.trial_ending",
         "Your Blockwise trial is due to end", "Review your account options before access changes.",
         "Hi {contactfield=firstname}\n\nYour Blockwise trial is due to end. Review your account and billing options in Blockwise so you know what happens next.\n\nOpen Blockwise: https://blockwise.sale\n\nBlockwise"),
    Flow("trial_ended", "Trial ended", "blockwise.trial_ended",
         "Your Blockwise trial has ended", "Your account options are available in Blockwise.",
         "Hi {contactfield=firstname}\n\nYour Blockwise trial has ended. You can review your account options in Blockwise.\n\nOpen Blockwise: https://blockwise.sale\n\nBlockwise"),
    Flow("opted_in_education", "Opted-in education", "blockwise.opted_in_education",
         "One useful check before your next lead campaign", "Make the offer clear before you spend time polishing the ad.",
         "Hi {contactfield=firstname}\n\nBefore you build the next campaign, make the offer easy to understand. A reader should know what they get, why it matters and what to do next without guessing.\n\nOpen Blockwise: https://blockwise.sale\n\nBlockwise"),
    Flow("paid_welcome", "Paid welcome", "blockwise.paid_welcome",
         "Your Blockwise paid access is active", "Your account is ready for the next lead-generation task.",
         "Hi {contactfield=firstname}\n\nYour paid Blockwise access is active. You can return to your lead-generation work whenever you are ready.\n\nOpen Blockwise: https://blockwise.sale\n\nBlockwise"),
    Flow("cancelled", "Cancellation follow-up", "blockwise.cancelled",
         "Your Blockwise cancellation was recorded", "This is a follow-up only, not a billing receipt or access decision.",
         "Hi {contactfield=firstname}\n\nYour Blockwise cancellation was recorded. Your account page has the current details.\n\nOpen Blockwise: https://blockwise.sale\n\nBlockwise"),
    Flow("winback", "Winback", "blockwise.winback_eligible",
         "Ready to return to Blockwise?", "Review the current account options when the timing is right.",
         "Hi {contactfield=firstname}\n\nIf you are considering returning to Blockwise, you can review the current account options in the app.\n\nOpen Blockwise: https://blockwise.sale\n\nBlockwise"),
    Flow("cold_local_audit", "Cold local audit draft", "blockwise.cold_local_audit_approved",
         "Draft: a useful look at local advertising", "Held until recipient eligibility, sender policy and audit evidence are approved.",
         "This draft is intentionally held. It must not be sent until a permitted sender, approved recipient eligibility, reviewed local-audit evidence and a public destination are all in place.", True),
)
FIELD_SPECS = (("blockwise_profile_id", "Blockwise profile ID"), ("blockwise_workspace_id", "Blockwise workspace ID"), ("blockwise_source_event_id", "Blockwise source event ID"), ("blockwise_marketing_conse", "Blockwise marketing consent"))

class ApiError(RuntimeError): pass

class Mautic:
    def __init__(self, base: str, username: str, password: str):
        self.base = base.rstrip("/") + "/api/"
        self.auth = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(self.base + path.lstrip("/"), data=data, method=method)
        request.add_header("Authorization", self.auth); request.add_header("Accept", "application/json")
        if data is not None: request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=20) as response: return json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            raise ApiError(f"Mautic API {method} {path} returned {error.code}: {error.read().decode(errors='replace')[:500]}") from error
        except urllib.error.URLError as error: raise ApiError(f"Mautic API {method} {path} failed: {error.reason}") from error
    def collection(self, path: str, key: str) -> list[dict[str, Any]]:
        value = self.request("GET", path + ("&" if "?" in path else "?") + "limit=500").get(key, {})
        return list(value.values()) if isinstance(value, dict) else list(value)

def named(items: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    return next((item for item in items if item.get("name") == name), None)

def ensure_fields(api: Mautic, apply: bool) -> dict[str, int]:
    existing = {field.get("alias"): field for field in api.collection("fields/contact", "fields")}; ids = {}
    for alias, label in FIELD_SPECS:
        field = existing.get(alias)
        if not field and apply:
            field = api.request("POST", "fields/contact/new", {"label": label, "alias": alias, "type": "text", "group": "professional", "isPublished": True, "isRequired": False, "isPubliclyUpdatable": False, "isVisibleOnShortForm": False, "isAvailableForSegments": False}).get("field", {})
        if field:
            if field.get("alias") != alias or field.get("type") != "text": raise ApiError(f"unsafe native field drift for {alias}")
            ids[alias] = int(field["id"])
    return ids

def ensure_segments(api: Mautic, apply: bool) -> dict[str, int]:
    existing = api.collection("segments", "lists"); ids = {}
    for flow in FLOWS:
        name = PREFIX + flow.title; segment = named(existing, name)
        if not segment and apply:
            segment = api.request("POST", "segments/new", {"name": name, "description": f"Native source segment for authoritative event {flow.event}. {'Cold flow remains blocked.' if flow.cold else 'Requires explicit opted-in consent and no email DNC.'}", "isPublished": True, "isGlobal": True, "filters": []}).get("list", {})
            existing.append(segment)
        if segment:
            if not segment.get("isPublished", True): raise ApiError(f"segment is inactive: {name}")
            ids[flow.key] = int(segment["id"])
    return ids

def email_payload(flow: Flow) -> dict[str, Any]:
    # Plain text is intentional: the installed upstream image lacks Symfony DomCrawler,
    # which its HTML-link validator requires. It also avoids open pixels and HTML link tracking.
    return {"name": PREFIX + flow.title, "subject": flow.subject, "language": "en", "isPublished": True, "emailType": "template", "publicPreview": False, "preheaderText": flow.preheader, "customHtml": "", "plainText": flow.text + "\n\nManage email preferences: {unsubscribe_url}\nUnsubscribe from all marketing emails: {dnc_url}", "lists": []}

def ensure_emails(api: Mautic, apply: bool) -> dict[str, int]:
    existing = api.collection("emails", "emails"); ids = {}
    for flow in FLOWS:
        name = PREFIX + flow.title; email = named(existing, name)
        if not email and apply:
            email = api.request("POST", "emails/new", email_payload(flow)).get("email", {}); existing.append(email)
        if email:
            if email.get("emailType") != "template": raise ApiError(f"email is not a template: {name}")
            ids[flow.key] = int(email["id"])
    return ids

def campaign_payload(flow: Flow, segment_id: int, email_id: int) -> dict[str, Any]:
    event_id = "new_1"
    return {"name": PREFIX + flow.title, "description": f"Unpublished native campaign. Entry: {flow.event}. {'No enrolment permitted until cold-outreach gates pass.' if flow.cold else 'Bridge checks opted-in consent and Mautic email DNC before segment entry.'}", "isPublished": False, "events": [{"id": event_id, "name": "Send template email", "description": "Native Mautic email action. No Mautic schedule is configured by this pack.", "type": "email.send", "eventType": "action", "order": 1, "properties": {"email": email_id, "email_type": "transactional"}, "triggerInterval": 0, "triggerIntervalUnit": "d", "triggerMode": "interval", "children": [], "parent": None, "decisionPath": "yes"}], "forms": [], "lists": [{"id": segment_id}], "canvasSettings": {"nodes": [{"id": "lists", "positionX": "400", "positionY": "65"}, {"id": event_id, "positionX": "400", "positionY": "180"}], "connections": [{"sourceId": "lists", "targetId": event_id, "anchors": {"source": "leadsource", "target": "top"}}]}}

def ensure_campaigns(api: Mautic, segments: dict[str, int], emails: dict[str, int], apply: bool) -> dict[str, int]:
    existing = api.collection("campaigns", "campaigns"); ids = {}
    for flow in FLOWS:
        name = PREFIX + flow.title; campaign = named(existing, name)
        if not campaign and apply:
            campaign = api.request("POST", "campaigns/new", campaign_payload(flow, segments[flow.key], emails[flow.key])).get("campaign", {}); existing.append(campaign)
        if campaign:
            if campaign.get("isPublished"): raise ApiError(f"campaign must remain unpublished until acceptance: {name}")
            ids[flow.key] = int(campaign["id"])
    return ids

def setup(api: Mautic, apply: bool) -> dict[str, int]:
    fields, segments, emails = ensure_fields(api, apply), ensure_segments(api, apply), ensure_emails(api, apply)
    campaigns = ensure_campaigns(api, segments, emails, apply)
    return {"fields": len(fields), "segments": len(segments), "emails": len(emails), "campaigns": len(campaigns), "unpublished_campaigns": len(campaigns)}

def contact_value(contact: dict[str, Any], alias: str) -> str | None:
    return (((contact.get("fields") or {}).get("all") or {}).get(alias))

def find_profile(api: Mautic, profile_id: str) -> dict[str, Any] | None:
    contacts = api.collection("contacts?" + urllib.parse.urlencode({"search": "blockwise_profile_id:" + profile_id}), "contacts")
    matches = [contact for contact in contacts if contact_value(contact, "blockwise_profile_id") == profile_id]
    if len(matches) > 1: raise ApiError("immutable profile ID is ambiguous in Mautic")
    return matches[0] if matches else None

def bridge(api: Mautic, args: argparse.Namespace) -> None:
    flow = next(flow for flow in FLOWS if flow.key == args.flow)
    if flow.cold: raise ApiError("cold_local_audit is blocked pending separate recipient and provider approval")
    if args.consent_state != "opted_in": raise ApiError("explicit opted_in consent is required for every Mautic education flow")
    if not args.apply: raise ApiError("bridge is dry-run by default; pass --apply after source adapter acceptance")
    contact = find_profile(api, args.profile_id)
    payload = {"email": args.email, "blockwise_profile_id": args.profile_id, "blockwise_workspace_id": args.workspace_id, "blockwise_marketing_conse": args.consent_state, "blockwise_source_event_id": args.source_event_id}
    if not contact: contact = api.request("POST", "contacts/new", payload).get("contact", {})
    contact_id = int(contact["id"])
    if contact.get("doNotContact"): raise ApiError("contact has native Mautic Do Not Contact; enrolment refused")
    if contact_value(contact, "blockwise_source_event_id") == args.source_event_id:
        print("unchanged: source event already applied"); return
    if contact_value(contact, "blockwise_source_event_id"): api.request("PATCH", f"contacts/{contact_id}/edit", payload)
    segments = ensure_segments(api, apply=False)
    api.request("POST", f"contacts/{contact_id}/segments/{segments[flow.key]}/add")
    print("enrolled: native campaign remains unpublished")

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("MAUTIC_URL", "http://127.0.0.1:18106")); parser.add_argument("--username", default="owner"); parser.add_argument("--password", default=os.environ.get("MAUTIC_ADMIN_PASSWORD"))
    sub = parser.add_subparsers(dest="command", required=True); sub.add_parser("plan"); sub.add_parser("apply"); sub.add_parser("verify")
    b = sub.add_parser("bridge"); b.add_argument("--flow", required=True, choices=[flow.key for flow in FLOWS]); b.add_argument("--source-event-id", required=True); b.add_argument("--profile-id", required=True); b.add_argument("--workspace-id", required=True); b.add_argument("--email", required=True); b.add_argument("--consent-state", required=True, choices=["opted_in", "opted_out", "unknown"]); b.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.password: raise ApiError("MAUTIC_ADMIN_PASSWORD is required")
    api = Mautic(args.url, args.username, args.password)
    if args.command == "bridge": bridge(api, args)
    else: print(json.dumps(setup(api, apply=args.command == "apply"), sort_keys=True))
    return 0

if __name__ == "__main__":
    try: raise SystemExit(main())
    except ApiError as error:
        print(f"owner-email-flows: {error}", file=sys.stderr); raise SystemExit(2)
