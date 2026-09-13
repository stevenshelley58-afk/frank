#!/usr/bin/env python3
"""Create one held native Mautic newsletter audience and review draft."""
from __future__ import annotations

import argparse
import json
import os
from typing import Any

from mautic_flows import ApiError, CONSENT_FIELD, FLOWS, Mautic, NURTURE_EXIT_FIELD, email_payload

SEGMENT_NAME = "Owner CRM | Newsletter subscribers"
EMAIL_NAME = "Owner CRM | Newsletter draft | Campaign basics"
SEGMENT_DESCRIPTION = (
    "Dynamic newsletter audience. Requires current explicit opted_in marketing "
    "consent and active nurture state. Native Mautic email Do Not Contact still applies."
)

def desired_filters() -> list[dict[str, Any]]:
    return [
        {
            "object": "lead",
            "glue": "and",
            "field": CONSENT_FIELD,
            "type": "text",
            "operator": "=",
            "properties": {"filter": "opted_in"},
        },
        {
            "object": "lead",
            "glue": "and",
            "field": NURTURE_EXIT_FIELD,
            "type": "text",
            "operator": "=",
            "properties": {"filter": "active"},
        },
    ]


def filter_signature(filters: Any) -> list[tuple[str, str, str, str, str]]:
    values = list(filters.values()) if isinstance(filters, dict) else list(filters or [])
    return sorted(
        (
            str(item.get("object", "")),
            str(item.get("glue", "")),
            str(item.get("field", "")),
            str(item.get("operator", "")),
            str((item.get("properties") or {}).get("filter", item.get("filter", ""))),
        )
        for item in values
        if isinstance(item, dict)
    )


def exactly_named(items: list[dict[str, Any]], name: str, kind: str) -> dict[str, Any] | None:
    matches = [item for item in items if item.get("name") == name]
    if len(matches) > 1:
        raise ApiError(f"duplicate native {kind} objects need review: {name}")
    return matches[0] if matches else None


def segment_payload() -> dict[str, Any]:
    return {
        "name": SEGMENT_NAME,
        "description": SEGMENT_DESCRIPTION,
        "isPublished": False,
        "isGlobal": True,
        "filters": desired_filters(),
    }


def ensure_segment(api: Mautic, apply: bool) -> dict[str, Any] | None:
    segment = exactly_named(api.collection("segments", "lists"), SEGMENT_NAME, "segment")
    desired = segment_payload()
    if segment is None and apply:
        segment = api.request("POST", "segments/new", desired).get("list", {})
    if segment is None:
        return None
    if filter_signature(segment.get("filters")) != filter_signature(desired["filters"]):
        raise ApiError("newsletter audience drift: expected only opted_in consent and active nurture")
    if segment.get("isPublished") not in (False, 0):
        if not apply:
            raise ApiError("newsletter audience must remain unpublished")
        segment = api.request(
            "PATCH", f"segments/{int(segment['id'])}/edit", {"isPublished": False}
        ).get("list", {})
    if segment.get("isPublished") not in (False, 0):
        raise ApiError("newsletter audience must remain unpublished")
    return segment


def newsletter_payload(segment_id: int) -> dict[str, Any]:
    # Mautic 7 has no REST clone endpoint. Reuse the maintained approved guide
    # payload, then make it a held list email for this exact dynamic audience.
    education = next(flow for flow in FLOWS if flow.key == "opted_in_education")
    payload = dict(email_payload(education, 1))
    payload.update(
        {
            "name": EMAIL_NAME,
            "subject": "Before you publish, check the campaign basics",
            "preheaderText": "Review the offer, audience, creative, budget and lead form.",
            "emailType": "list",
            "isPublished": False,
            "lists": [segment_id],
        }
    )
    return payload


def list_ids(email: dict[str, Any]) -> list[int]:
    values = email.get("lists") or []
    if isinstance(values, dict):
        values = list(values.values())
    ids = []
    for value in values:
        raw = value.get("id") if isinstance(value, dict) else value
        try:
            ids.append(int(raw))
        except (TypeError, ValueError) as error:
            raise ApiError("newsletter email audience readback was malformed") from error
    return sorted(ids)


def verify_email(email: dict[str, Any], desired: dict[str, Any]) -> None:
    if email.get("emailType") != "list":
        raise ApiError("newsletter draft must be a native list email")
    if email.get("isPublished") not in (False, 0):
        raise ApiError("newsletter draft must remain unpublished")
    if int(email.get("sentCount", 0)) != 0:
        raise ApiError("newsletter draft has already been sent and must not be reconciled")
    for key in ("name", "subject", "preheaderText", "customHtml", "plainText"):
        actual, expected = email.get(key), desired[key]
        if key == "customHtml":
            actual = str(actual).replace("<br />", "<br>")
            expected = str(expected).replace("<br />", "<br>")
        if actual != expected:
            raise ApiError(f"newsletter draft drift requires manual review: {key}")
    if list_ids(email) != sorted(desired["lists"]):
        raise ApiError("newsletter draft audience drift requires manual review")


def ensure_email(api: Mautic, segment_id: int, apply: bool) -> dict[str, Any] | None:
    email = exactly_named(api.collection("emails", "emails"), EMAIL_NAME, "email")
    desired = newsletter_payload(segment_id)
    if email is None and apply:
        email = api.request("POST", "emails/new", desired).get("email", {})
    if email is not None:
        verify_email(email, desired)
    return email


def setup(api: Mautic, apply: bool) -> dict[str, Any]:
    segment = ensure_segment(api, apply)
    email = ensure_email(api, int(segment["id"]), apply) if segment else None
    return {
        "segment": None if segment is None else int(segment["id"]),
        "email": None if email is None else int(email["id"]),
        "email_type": None if email is None else email.get("emailType"),
        "email_published": None if email is None else bool(email.get("isPublished")),
        "audience_filters": 0 if segment is None else len(filter_signature(segment.get("filters"))),
    }


def setup(api: Mautic, apply: bool) -> dict[str, Any]:
    segment = ensure_segment(api, apply)
    email = None if segment is None else ensure_email(api, int(segment["id"]), apply)
    return {
        "segment_id": None if segment is None else int(segment["id"]),
        "email_id": None if email is None else int(email["id"]),
        "audience_filters": 0 if segment is None else len(filter_signature(segment.get("filters"))),
        "email_type": None if email is None else email.get("emailType"),
        "email_published": None if email is None else bool(email.get("isPublished")),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("MAUTIC_URL", "http://127.0.0.1:18106"))
    parser.add_argument("--username", default="owner")
    parser.add_argument("--password", default=os.environ.get("MAUTIC_ADMIN_PASSWORD"))
    parser.add_argument("command", choices=("plan", "apply", "verify"))
    args = parser.parse_args()
    if not args.password:
        raise ApiError("MAUTIC_ADMIN_PASSWORD is required")
    result = setup(Mautic(args.url, args.username, args.password), apply=args.command == "apply")
    if args.command == "verify" and (result["segment_id"] is None or result["email_id"] is None):
        raise ApiError("newsletter native objects are missing")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
