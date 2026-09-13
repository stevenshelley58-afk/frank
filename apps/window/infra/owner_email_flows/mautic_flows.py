#!/usr/bin/env python3
"""Idempotent native Mautic flow setup and fail-closed enrolment bridge."""
from __future__ import annotations

import argparse, base64, json, os, sys, urllib.error, urllib.parse, urllib.request
from dataclasses import dataclass
from typing import Any

PREFIX = "Owner CRM | "
CONSENT_FIELD = "blockwise_marketing_conse"
NURTURE_EXIT_FIELD = "blockwise_nurture_exit"
COLD_RELEASE_FIELD = "blockwise_cold_release"


@dataclass(frozen=True)
class Step:
    name: str
    subject: str
    preheader: str
    text: str
    delay_days: int = 0


@dataclass(frozen=True)
class Flow:
    key: str
    title: str
    event: str
    steps: tuple[Step, ...]
    cold: bool = False


FLOWS = (
    Flow("onboarding_trial_help", "Onboarding and trial help", "blockwise.onboarding_trial_help", (
        Step("Start", "A useful place to start in Blockwise", "Choose the next step that helps your lead-generation setup move forward.",
             "Hi {contactfield=firstname}\n\nStart with the next useful step in Blockwise. Choose a lead goal, add your offer and brand details, then review the ad pack before you publish.\n\nBuild your next ad pack: https://blockwise.sale/ad-studio\n\nBlockwise"),
    )),
    Flow("trial_ending", "Trial ending", "blockwise.trial_ending", (
        Step("Account options", "Your Blockwise trial is due to end", "Review your account options before access changes.",
             "Hi {contactfield=firstname}\n\nYour Blockwise trial is due to end. Review your account and billing options so you know what happens next.\n\nReview your settings: https://blockwise.sale/settings\n\nBlockwise"),
    )),
    Flow("trial_ended", "Trial ended", "blockwise.trial_ended", (
        Step("Account options", "Your Blockwise trial has ended", "Your account options are available in Blockwise.",
             "Hi {contactfield=firstname}\n\nYour Blockwise trial has ended. You can review your account options in settings.\n\nReview your settings: https://blockwise.sale/settings\n\nBlockwise"),
    )),
    # This cadence comes only from the existing Blockwise opt-in draft: welcome,
    # two days, useful guide, then three further days, a help question.
    Flow("opted_in_education", "Opted-in education", "blockwise.opted_in_education", (
        Step("Welcome", "One useful check before your next lead campaign", "Make the offer clear before you spend time polishing the ad.",
             "Hi {contactfield=firstname}\n\nBefore you build the next campaign, make the offer easy to understand. A reader should know what they get, why it matters and what to do next without guessing.\n\nOpen Ad Studio: https://blockwise.sale/ad-studio\n\nBlockwise"),
        Step("Useful guide", "Before you publish, check the basics", "A short review can make the next campaign easier to act on.",
             "Hi {contactfield=firstname}\n\nBefore you publish, review the offer, audience, location, Feed and Story assets, budget and schedule, and the questions in the lead form. Start with the part that would make a response clearer.\n\nReview your ad pack: https://blockwise.sale/ad-studio\n\nBlockwise", delay_days=2),
        Step("Check in", "What would make the next step clearer?", "Return to Blockwise when you are ready to keep building.",
             "Hi {contactfield=firstname}\n\nWhat would make the next lead-generation step clearer? Review the campaign plan and make the next change when it helps.\n\nOpen Ad Studio: https://blockwise.sale/ad-studio\n\nBlockwise", delay_days=3),
    )),
    Flow("paid_welcome", "Paid welcome", "blockwise.paid_welcome", (
        Step("Welcome", "Your Blockwise paid access is active", "Your account is ready for the next lead-generation task.",
             "Hi {contactfield=firstname}\n\nYour paid Blockwise access is active. You can return to your lead-generation work whenever you are ready.\n\nOpen your workspace: https://blockwise.sale/self-serve\n\nBlockwise"),
    )),
    Flow("cancelled", "Cancellation follow-up", "blockwise.cancelled", (
        Step("Account details", "Your Blockwise cancellation was recorded", "Review the current account details in Blockwise.",
             "Hi {contactfield=firstname}\n\nYour Blockwise cancellation was recorded. Your account page has the current details.\n\nReview your settings: https://blockwise.sale/settings\n\nBlockwise"),
    )),
    Flow("winback", "Winback", "blockwise.winback_eligible", (
        Step("Return", "Ready to return to Blockwise?", "Review the current account options when the timing is right.",
             "Hi {contactfield=firstname}\n\nIf you are considering returning to Blockwise, you can review the current account options.\n\nReview current options: https://blockwise.sale/pricing\n\nBlockwise"),
    )),
    Flow("cold_local_audit", "Cold local audit draft", "blockwise.cold_local_audit_approved", (
        Step("Held draft", "Draft: a useful look at local advertising", "Held until recipient eligibility, sender policy and audit evidence are approved.",
             "This draft is intentionally held. It must not be sent until a permitted sender, approved recipient eligibility, reviewed local-audit evidence and a public destination are all in place."),
    ), cold=True),
)

FIELD_SPECS = (
    ("blockwise_profile_id", "Blockwise profile ID"),
    ("blockwise_workspace_id", "Blockwise workspace ID"),
    ("blockwise_source_event_id", "Blockwise source event ID"),
    (CONSENT_FIELD, "Blockwise marketing consent"),
    (NURTURE_EXIT_FIELD, "Blockwise nurture exit state"),
    (COLD_RELEASE_FIELD, "Blockwise cold-flow release state"),
)


class ApiError(RuntimeError):
    pass


class Mautic:
    def __init__(self, base: str, username: str, password: str):
        self.base = base.rstrip("/") + "/api/"
        self.auth = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(self.base + path.lstrip("/"), data=data, method=method)
        request.add_header("Authorization", self.auth)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            raise ApiError(f"Mautic API {method} {path} returned HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise ApiError(f"Mautic API {method} {path} is unavailable") from error

    def collection(self, path: str, key: str) -> list[dict[str, Any]]:
        value = self.request("GET", path + ("&" if "?" in path else "?") + "limit=500").get(key, {})
        return list(value.values()) if isinstance(value, dict) else list(value)

    def total(self, path: str) -> int:
        return int(self.request("GET", path + ("&" if "?" in path else "?") + "limit=1").get("total", 0))


def named(items: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    return next((item for item in items if item.get("name") == name), None)


def email_name(flow: Flow, index: int) -> str:
    return PREFIX + flow.title if index == 0 else f"{PREFIX}{flow.title} | {index + 1:02d} {flow.steps[index].name}"


def email_key(flow: Flow, index: int) -> str:
    return f"{flow.key}:{index}"


def ensure_fields(api: Mautic, apply: bool) -> dict[str, int]:
    existing = {field.get("alias"): field for field in api.collection("fields/contact", "fields")}
    ids = {}
    for alias, label in FIELD_SPECS:
        field = existing.get(alias)
        if not field and apply:
            field = api.request("POST", "fields/contact/new", {"label": label, "alias": alias, "type": "text", "group": "professional", "isPublished": True, "isRequired": False, "isPubliclyUpdatable": False, "isVisibleOnShortForm": False, "isAvailableForSegments": False}).get("field", {})
        if field:
            if field.get("alias") != alias or field.get("type") != "text":
                raise ApiError(f"unsafe native field drift for {alias}")
            ids[alias] = int(field["id"])
    return ids


def ensure_segments(api: Mautic, apply: bool) -> dict[str, int]:
    existing = api.collection("segments", "lists")
    ids = {}
    for flow in FLOWS:
        name = PREFIX + flow.title
        segment = named(existing, name)
        if not segment and apply:
            description = f"Native source segment for authoritative event {flow.event}. "
            description += "Cold flow remains blocked." if flow.cold else "Requires explicit opted-in consent, active nurture state and no email Do Not Contact."
            segment = api.request("POST", "segments/new", {"name": name, "description": description, "isPublished": True, "isGlobal": True, "filters": []}).get("list", {})
            existing.append(segment)
        if segment:
            if not segment.get("isPublished", True):
                raise ApiError(f"segment is inactive: {name}")
            ids[flow.key] = int(segment["id"])
    return ids


def email_payload(flow: Flow, index: int) -> dict[str, Any]:
    step = flow.steps[index]
    # Plain text is intentional: the installed upstream image lacks Symfony DomCrawler,
    # which its HTML-link validator requires. It also avoids open pixels and HTML link tracking.
    return {"name": email_name(flow, index), "subject": step.subject, "language": "en", "isPublished": not flow.cold, "emailType": "template", "publicPreview": False, "preheaderText": step.preheader, "customHtml": "", "plainText": step.text + "\n\nManage email preferences: {unsubscribe_url}\nUnsubscribe from all marketing emails: {dnc_url}", "lists": []}


def email_needs_update(email: dict[str, Any], desired: dict[str, Any]) -> bool:
    keys = ("subject", "preheaderText", "plainText", "emailType", "isPublished")
    return any(email.get(key) != desired[key] for key in keys)


def ensure_emails(api: Mautic, apply: bool) -> dict[str, int]:
    existing = api.collection("emails", "emails")
    ids = {}
    for flow in FLOWS:
        for index, _step in enumerate(flow.steps):
            name = email_name(flow, index)
            desired = email_payload(flow, index)
            email = named(existing, name)
            if not email and apply:
                email = api.request("POST", "emails/new", desired).get("email", {})
                existing.append(email)
            elif email and apply and email_needs_update(email, desired):
                if int(email.get("sentCount", 0)) != 0:
                    raise ApiError(f"refusing to revise previously sent template: {name}")
                email = api.request("PATCH", f"emails/{int(email['id'])}/edit", desired).get("email", {})
                existing[existing.index(named(existing, name))] = email
            if email:
                if email.get("emailType") != "template":
                    raise ApiError(f"email is not a template: {name}")
                ids[email_key(flow, index)] = int(email["id"])
    return ids


def campaign_events(flow: Flow, emails: dict[str, int]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if flow.cold:
        event_id = "new_1"
        event = {"id": event_id, "name": "Held release gate", "description": "No send action. The cold draft remains held unless a separate approved release process records an explicit value.", "type": "lead.field_value", "eventType": "condition", "order": 1, "properties": {"field": COLD_RELEASE_FIELD, "operator": "=", "value": "approved"}, "triggerInterval": 0, "triggerIntervalUnit": "d", "triggerMode": "interval", "children": [], "parent": None, "decisionPath": "yes"}
        return [event], {"nodes": [{"id": "lists", "positionX": "400", "positionY": "65"}, {"id": event_id, "positionX": "400", "positionY": "180"}], "connections": [{"sourceId": "lists", "targetId": event_id, "anchors": {"source": "leadsource", "target": "top"}}]}
    events: list[dict[str, Any]] = []
    nodes = [{"id": "lists", "positionX": "400", "positionY": "65"}]
    connections: list[dict[str, Any]] = []
    event_number = 0
    parent: str | None = None

    def add_event(name: str, description: str, event_type: str, properties: dict[str, Any], delay_days: int = 0) -> str:
        nonlocal event_number, parent
        event_number += 1
        event_id = f"new_{event_number}"
        event = {"id": event_id, "name": name, "description": description, "type": event_type, "eventType": "condition" if event_type == "lead.field_value" else "action", "order": event_number, "properties": properties, "triggerInterval": delay_days, "triggerIntervalUnit": "d", "triggerMode": "interval", "children": [], "parent": parent, "decisionPath": "yes"}
        events.append(event)
        source = "lists" if parent is None else parent
        if parent is not None:
            next(item for item in events if item["id"] == parent)["children"].append(event_id)
        connections.append({"sourceId": source, "targetId": event_id, "anchors": {"source": "leadsource" if source == "lists" else "yes", "target": "top"}})
        nodes.append({"id": event_id, "positionX": "400", "positionY": str(180 + (event_number - 1) * 125)})
        parent = event_id
        return event_id

    for index, step in enumerate(flow.steps):
        add_event("Consent remains opted in", "Exit if the authoritative consent field is not opted_in.", "lead.field_value", {"field": CONSENT_FIELD, "operator": "=", "value": "opted_in"}, step.delay_days)
        add_event("Nurture remains active", "Exit if the source adapter has recorded reply, conversion, withdrawal, bounce or complaint.", "lead.field_value", {"field": NURTURE_EXIT_FIELD, "operator": "=", "value": "active"})
        add_event(f"Send {step.name.lower()} email", "Native marketing email action. Mautic Do Not Contact is enforced by the sender.", "email.send", {"email": emails[email_key(flow, index)], "email_type": "marketing"})
    return events, {"nodes": nodes, "connections": connections}


def campaign_payload(flow: Flow, segment_id: int, emails: dict[str, int]) -> dict[str, Any]:
    events, canvas = campaign_events(flow, emails)
    safety = "No send action exists. This is a held draft and no enrolment is permitted." if flow.cold else "Each step checks explicit opted-in consent and active nurture state. Mautic Do Not Contact is enforced by the sender."
    return {"name": PREFIX + flow.title, "description": f"Unpublished native campaign. Entry: {flow.event}. {safety}", "isPublished": False, "events": events, "forms": [], "lists": [{"id": segment_id}], "canvasSettings": canvas}


def event_count(campaign: dict[str, Any]) -> int:
    events = campaign.get("events", [])
    return len(events) if isinstance(events, (list, dict)) else 0


def event_signature(events: list[dict[str, Any]] | dict[str, dict[str, Any]]) -> list[tuple[Any, ...]]:
    values = list(events.values()) if isinstance(events, dict) else list(events)
    values.sort(key=lambda event: int(event.get("order", 0)))
    return [
        (
            event.get("type"),
            (event.get("properties") or {}).get("field"),
            (event.get("properties") or {}).get("email"),
            (event.get("properties") or {}).get("email_type"),
            int(event.get("triggerInterval", 0)),
        )
        for event in values
    ]


def campaign_needs_update(campaign: dict[str, Any], desired: dict[str, Any]) -> bool:
    return event_signature(campaign.get("events", [])) != event_signature(desired["events"])


def ensure_campaigns(api: Mautic, segments: dict[str, int], emails: dict[str, int], apply: bool) -> dict[str, int]:
    existing = api.collection("campaigns", "campaigns")
    ids = {}
    for flow in FLOWS:
        name = PREFIX + flow.title
        desired = campaign_payload(flow, segments[flow.key], emails)
        campaign = named(existing, name)
        if not campaign and apply:
            campaign = api.request("POST", "campaigns/new", desired).get("campaign", {})
            existing.append(campaign)
        elif campaign and apply and campaign_needs_update(campaign, desired):
            if api.total("contacts") != 0:
                raise ApiError(f"refusing to revise campaign with native contacts: {name}")
            # Mautic appends graph events when supplied transient new_* IDs on
            # a campaign edit. With no native contacts and this campaign still
            # unpublished, replacing only this owner-owned campaign is the
            # safe idempotent reconciliation path.
            api.request("DELETE", f"campaigns/{int(campaign['id'])}/delete")
            campaign = api.request("POST", "campaigns/new", desired).get("campaign", {})
            existing[existing.index(named(existing, name))] = campaign
        if campaign:
            if campaign.get("isPublished"):
                raise ApiError(f"campaign must remain unpublished until acceptance: {name}")
            ids[flow.key] = int(campaign["id"])
    return ids


def setup(api: Mautic, apply: bool) -> dict[str, int]:
    fields = ensure_fields(api, apply)
    segments = ensure_segments(api, apply)
    emails = ensure_emails(api, apply)
    campaigns = ensure_campaigns(api, segments, emails, apply)
    return {"fields": len(fields), "segments": len(segments), "emails": len(emails), "campaigns": len(campaigns), "unpublished_campaigns": len(campaigns)}


def contact_value(contact: dict[str, Any], alias: str) -> str | None:
    return (((contact.get("fields") or {}).get("all") or {}).get(alias))


def find_profile(api: Mautic, profile_id: str) -> dict[str, Any] | None:
    contacts = api.collection("contacts?" + urllib.parse.urlencode({"search": "blockwise_profile_id:" + profile_id}), "contacts")
    matches = [contact for contact in contacts if contact_value(contact, "blockwise_profile_id") == profile_id]
    if len(matches) > 1:
        raise ApiError("immutable profile ID is ambiguous in Mautic")
    return matches[0] if matches else None


def bridge(api: Mautic, args: argparse.Namespace) -> None:
    flow = next(flow for flow in FLOWS if flow.key == args.flow)
    if flow.cold:
        raise ApiError("cold_local_audit is blocked pending separate recipient and provider approval")
    if args.consent_state != "opted_in":
        raise ApiError("explicit opted_in consent is required for every Mautic education flow")
    if not args.apply:
        raise ApiError("bridge is dry-run by default; pass --apply after source adapter acceptance")
    contact = find_profile(api, args.profile_id)
    already_applied = bool(contact and contact_value(contact, "blockwise_source_event_id") == args.source_event_id)
    payload = {"email": args.email, "blockwise_profile_id": args.profile_id, "blockwise_workspace_id": args.workspace_id, CONSENT_FIELD: args.consent_state, NURTURE_EXIT_FIELD: "active", "blockwise_source_event_id": args.source_event_id}
    if not contact:
        contact = api.request("POST", "contacts/new", payload).get("contact", {})
    contact_id = int(contact["id"])
    if contact.get("doNotContact"):
        raise ApiError("contact has native Mautic Do Not Contact; enrolment refused")
    if already_applied:
        print("unchanged: source event already applied")
        return
    if contact_value(contact, "blockwise_source_event_id"):
        api.request("PATCH", f"contacts/{contact_id}/edit", payload)
    segments = ensure_segments(api, apply=False)
    api.request("POST", f"contacts/{contact_id}/segments/{segments[flow.key]}/add")
    print("enrolled: native campaign remains unpublished")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("MAUTIC_URL", "http://127.0.0.1:18106"))
    parser.add_argument("--username", default="owner")
    parser.add_argument("--password", default=os.environ.get("MAUTIC_ADMIN_PASSWORD"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("plan")
    sub.add_parser("apply")
    sub.add_parser("verify")
    b = sub.add_parser("bridge")
    b.add_argument("--flow", required=True, choices=[flow.key for flow in FLOWS])
    b.add_argument("--source-event-id", required=True)
    b.add_argument("--profile-id", required=True)
    b.add_argument("--workspace-id", required=True)
    b.add_argument("--email", required=True)
    b.add_argument("--consent-state", required=True, choices=["opted_in", "opted_out", "unknown"])
    b.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.password:
        raise ApiError("MAUTIC_ADMIN_PASSWORD is required")
    api = Mautic(args.url, args.username, args.password)
    if args.command == "bridge":
        bridge(api, args)
    else:
        print(json.dumps(setup(api, apply=args.command == "apply"), sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as error:
        print(f"owner-email-flows: {error}", file=sys.stderr)
        raise SystemExit(2)
