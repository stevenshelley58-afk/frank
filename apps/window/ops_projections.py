"""Read-only Blockwise customer operations projections for Frank.

Hermes publishes the projection envelopes consumed here.  Frank never calls a
provider and never treats a partial or unknown envelope as current state.
"""
from __future__ import annotations

import json
import math
import os
import re
import secrets
import shutil
import threading
import time
import hmac
import hashlib
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from flask import Blueprint, abort, jsonify, request

from action_dispatcher import DispatchError, HermesDispatcher
import control_plane_view


OPS_SCHEMA_VERSION = 1
OPS_SCHEMA = "schema://frank.ops/v1"
BLOCKWISE_PROJECT_ID = "blockwise"
PROJECTION_SPECS: dict[str, dict[str, Any]] = {
    "customers": {
        "schema": "schema://frank.ops.customer-summary/v1",
        "filename": "customers.json",
        "title": "Customer summaries",
        "fields": {
            "id", "workspace_id", "display_name", "name", "email", "email_masked", "company",
            "status", "lifecycle", "plan", "mode", "region", "country_code", "managed_service_enabled", "billing_access_state", "stripe_subscription_status", "stripe_latest_invoice_status", "created_at", "updated_at", "last_seen_at",
            "source_revision", "tags",
        },
    },
    "email": {
        "schema": "schema://frank.ops.transactional-email/v1",
        "filename": "email.json",
        "title": "Transactional email history and status",
        "fields": {
            "id", "customer_id", "template", "subject", "status",
            "delivered_at", "sent_at", "created_at", "failure_code", "failure_reason",
            "provider", "updated_at",
            "delivery_status", "provider_record_suffix", "snapshot_kind", "source_event_id", "source_version",
        },
    },
    "flows": {
        "schema": "schema://frank.ops.email-flows/v1",
        "filename": "flows.json",
        "title": "Email flow and campaign summaries",
        "fields": {
            "id", "customer_id", "name", "type", "status", "stage", "campaign",
            "enrolled_at", "last_activity_at", "next_step_at", "metrics", "updated_at",
            "snapshot_kind", "provider_record_suffix", "source_event_id", "source_version",
        },
    },
    "mautic": {
        "schema": "schema://frank.ops.mautic-lifecycle/v1",
        "filename": "mautic.json",
        "title": "Mautic lifecycle",
        "fields": {
            "id", "customer_id", "stage", "score", "tags", "segments",
            "last_activity_at", "updated_at",
            "snapshot_kind", "provider_record_suffix", "source_event_id", "source_version",
        },
    },
    "enquiries": {
        "schema": "schema://frank.ops.chatwoot-enquiries/v1",
        "filename": "enquiries.json",
        "title": "Chatwoot enquiries and conversations",
        "fields": {
            "id", "customer_id", "subject", "status", "priority",
            "assignee", "last_message_at", "created_at", "updated_at", "channel", "summary",
            "workspace_id", "source_system", "enquiry_type", "requester_email", "requester_name",
            "snapshot_kind", "delivery_status", "provider_record_suffix", "source_event_id", "source_version",
        },
    },
    "bookings": {
        "schema": "schema://frank.ops.snagtime-bookings/v1",
        "filename": "bookings.json",
        "title": "SnagTime bookings",
        "fields": {
            "id", "customer_id", "booking_ref", "status", "service", "start_at", "end_at",
            "timezone", "location_label", "created_at", "updated_at",
            "provider", "scheduled_start_at", "scheduled_end_at", "booked_at", "cancelled_at", "completed_at",
        },
    },
    "billing": {
        "schema": "schema://frank.ops.stripe-billing/v1",
        "filename": "billing.json",
        "title": "Stripe billing state",
        "fields": {
            "id", "customer_id", "status", "plan",
            "currency", "amount", "interval", "current_period_end", "cancel_at_period_end",
            "past_due_since", "updated_at", "billing_access_state", "billing_email_masked", "billing_currency",
            "billing_offer_key", "billing_offer_version",
            "stripe_subscription_status", "stripe_current_period_start", "stripe_current_period_end",
            "stripe_cancel_at_period_end", "stripe_latest_invoice_status", "stripe_latest_invoice_amount_paid",
            "billing_payment_recovery_required", "billing_reconciliation_required", "offer_key", "offer_version",
            "accepted_at", "market", "first_invoice_amount", "renewal_amount",
        },
    },
    "activity": {
        "schema": "schema://frank.ops.activity/v1",
        "filename": "activity.json",
        "title": "Unified activity and receipt correlation",
        "fields": {
            "id", "customer_id", "occurred_at", "kind", "title", "summary", "source",
            "provider", "status", "receipt_id", "correlation_id", "entity_ref", "updated_at",
            "created_at",
        },
    },
    "members": {
        "schema": "schema://frank.ops.members/v1",
        "filename": "members.json",
        "title": "Workspace users and members",
        "fields": {
            "id", "customer_id", "workspace_id", "profile_id", "email", "full_name", "display_name", "role", "status", "created_at",
            "joined_at", "last_seen_at", "updated_at",
        },
    },
}

PROJECTION_NAMES = tuple(PROJECTION_SPECS)
# Every section may carry the originating workspace UUID. It is safe metadata,
# and makes cross-workspace correlation explicit without exposing providers.
for _spec in PROJECTION_SPECS.values():
    _spec["fields"].add("workspace_id")
OPS_PROJECTION_SCHEMAS = {name: spec["schema"] for name, spec in PROJECTION_SPECS.items()}
_POINTER_SCHEMA = "schema://frank.ops-pointer/v1"
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SAFE_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_SENSITIVE_KEY = re.compile(
    r"(?:password|passphrase|secret|token|api[_-]?key|private[_-]?key|credential|authorization|cookie|card|cvv|cvc|iban|bank)",
    re.I,
)
_SECRET_VALUE = re.compile(r"(?:sk|pk|rk|ghp|xox[baprs])_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|secret|token|password)\s*[:=]\s*\S+", re.I)
_RECEIPT = re.compile(r"receipt:[a-z0-9][a-z0-9/_-]{2,127}")
_ACTION_STATUSES = frozenset({"accepted", "queued", "completed", "recorded", "preview", "error", "failed"})
_STATUS = frozenset({"active", "inactive", "pending", "invited", "suspended", "closed", "sent", "delivered", "failed", "bounced", "opened", "clicked", "draft", "paused", "archived", "enrolled", "open", "new", "resolved", "snoozed", "scheduled", "confirmed", "completed", "canceled", "cancelled", "trial", "past_due", "unpaid", "setup_needed", "recorded"})
_ENUMS = {
    "lifecycle": frozenset({"email_pending", "brand_setup", "brand_review", "first_value", "meta_setup", "conversion", "activated", "active", "lead", "prospect", "trial", "customer", "retention", "churn_risk", "churned", "unknown"}),
    "stage": frozenset({"lead", "mql", "sql", "trial", "active", "customer", "retention", "churn_risk", "churned", "open", "closed"}),
    "type": frozenset({"transactional", "campaign", "automation", "sequence"}),
    "priority": frozenset({"low", "normal", "high", "urgent"}),
    "interval": frozenset({"day", "week", "month", "year"}),
    "channel": frozenset({"email", "chat", "phone", "web", "sms", "other"}),
    "role": frozenset({"owner", "admin", "member", "viewer", "operator"}),
}
_TIME_KEYS = frozenset({"created_at", "updated_at", "last_seen_at", "delivered_at", "sent_at", "enrolled_at", "last_activity_at", "next_step_at", "last_message_at", "start_at", "end_at", "current_period_end", "past_due_since", "occurred_at", "joined_at", "scheduled_start_at", "scheduled_end_at", "booked_at", "cancelled_at", "completed_at", "stripe_current_period_start", "stripe_current_period_end", "accepted_at", "email_verified_at", "country_confirmed_at", "website_submitted_at", "brand_pack_approved_at", "first_ad_pack_generated_at", "meta_connected_at", "checkout_completed_at", "first_campaign_live_at", "intro_invoice_paid_at", "onboarding_booked_at", "onboarding_completed_at", "activation_completed_at", "run_after"})
_ENVELOPE_FIELDS = frozenset({"schema", "version", "projection", "project_id", "workspace_ids", "source_scope", "source_revision", "source_receipt_ids", "publication_receipt_id", "published_at", "fresh_until", "items"})


def _masked_suffix(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 256:
        raise ProjectionError("provider reference is invalid")
    return "…" + value[-8:]


class ProjectionError(ValueError):
    """Raised when a published projection cannot be trusted."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BlockwiseOpsClient:
    """Signed, bounded client for Blockwise's Hermes-published ops API."""

    def __init__(self, base_url: str, secret: str, *, opener=None, clock=None, max_pages: int = 50, page_size: int = 100):
        parsed = urllib.parse.urlsplit(str(base_url).strip().rstrip("/"))
        if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.netloc:
            raise ProjectionError("Blockwise ops base URL is invalid")
        if not isinstance(secret, str) or len(secret) < 32 or len(secret) > 4096 or any(ord(char) < 33 or ord(char) > 126 for char in secret):
            raise ProjectionError("Blockwise ops signing secret is not strong enough")
        self.base_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))
        self.secret = secret.encode("utf-8")
        self.opener = opener or urllib.request.build_opener(_NoRedirect()).open
        self.clock = clock or time.time
        self.max_pages = min(100, max(1, int(max_pages)))
        self.page_size = min(100, max(1, int(page_size)))

    @classmethod
    def from_env(cls, **kwargs):
        base_url = os.environ.get("BLOCKWISE_OPS_BASE_URL", "").strip()
        secret_path = os.environ.get("BLOCKWISE_INTERNAL_AUTH_SECRET_FILE", "").strip()
        if not base_url or not secret_path:
            raise ProjectionError("BLOCKWISE_OPS_BASE_URL and BLOCKWISE_INTERNAL_AUTH_SECRET_FILE are required")
        path = Path(secret_path)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
            raise ProjectionError("Blockwise internal auth secret file is unavailable")
        try:
            secret = path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError) as error:
            raise ProjectionError("Blockwise internal auth secret file is unavailable") from error
        return cls(base_url, secret, **kwargs)

    def _request(self, path: str, query: Mapping[str, str] | None = None) -> Mapping[str, Any]:
        if not path.startswith("/") or ".." in path or not re.fullmatch(r"/[A-Za-z0-9._~/-]+", path):
            raise ProjectionError("Blockwise ops path is invalid")
        query_text = urllib.parse.urlencode(sorted((query or {}).items()))
        target = self.base_url + path + (("?" + query_text) if query_text else "")
        timestamp = str(int(self.clock()))
        nonce = secrets.token_urlsafe(24)
        scope = "ops.read"
        body_hash = hashlib.sha256(b"").hexdigest()
        canonical = "v1\n" + timestamp + "\n" + nonce + "\n" + scope + "\nGET\n" + path + ("?" + query_text if query_text else "") + "\n" + body_hash
        signature = hmac.new(self.secret, canonical.encode("utf-8"), hashlib.sha256).hexdigest()
        req = urllib.request.Request(target, headers={
            "Accept": "application/json", "X-Blockwise-Timestamp": timestamp,
            "X-Blockwise-Nonce": nonce, "X-Blockwise-Scope": scope,
            "X-Blockwise-Signature": signature,
        }, method="GET")
        try:
            with self.opener(req, timeout=15) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                status = getattr(response, "status", 200)
            if status != 200 or len(raw) > 4 * 1024 * 1024:
                raise ProjectionError("Blockwise ops response is unavailable")
            payload = json.loads(raw.decode("utf-8"))
        except ProjectionError:
            raise
        except (OSError, urllib.error.URLError, json.JSONDecodeError, UnicodeError) as error:
            raise ProjectionError("Blockwise ops response is unavailable") from error
        required = {"schema", "project_id", "generated_at", "fresh_until", "source_revision", "source_receipt_ids", "data"}
        if not isinstance(payload, Mapping) or set(payload) != required or payload.get("schema") != "blockwise.ops.read.v1" or payload.get("project_id") != BLOCKWISE_PROJECT_ID:
            raise ProjectionError("Blockwise ops response envelope is invalid")
        _parse_time(payload.get("generated_at"), "generated_at")
        fresh_until = _parse_time(payload.get("fresh_until"), "fresh_until")
        if not fresh_until or datetime.fromisoformat(fresh_until.replace("Z", "+00:00")).timestamp() <= self.clock():
            raise ProjectionError("Blockwise ops source is expired")
        if not isinstance(payload.get("source_revision"), str) or not payload["source_revision"] or len(payload["source_revision"] ) > 256:
            raise ProjectionError("Blockwise source revision is invalid")
        receipts = payload.get("source_receipt_ids")
        if not isinstance(receipts, list) or not receipts or any(not isinstance(item, str) or not _RECEIPT.fullmatch(item) for item in receipts):
            raise ProjectionError("Blockwise source receipts are invalid")
        return payload

    def fetch_bundle(self) -> dict[str, Any]:
        """Fetch Blockwise's exact `{data}` list/detail contract."""
        rows: list[dict[str, Any]] = []
        receipts: list[str] = []
        source_revision = ""
        source_fresh_until: str | None = None
        cursor = ""
        for _ in range(self.max_pages):
            query = {"limit": str(self.page_size)}
            if cursor:
                query["cursor"] = cursor
            envelope = self._request("/api/internal/ops/customers", query)
            source_revision = self._merge_source(envelope, receipts, source_revision)
            source_fresh_until = _min_time(source_fresh_until, envelope["fresh_until"])
            page = envelope.get("data")
            if not isinstance(page, Mapping) or set(page) != {"limit", "total", "nextCursor", "rows"}:
                raise ProjectionError("Blockwise customer list shape is invalid")
            page_rows = page["rows"]
            if not isinstance(page_rows, list) or not isinstance(page["limit"], int) or page["limit"] != self.page_size or not isinstance(page["total"], int):
                raise ProjectionError("Blockwise customer list is invalid")
            next_cursor = page.get("nextCursor")
            if next_cursor is not None and (not isinstance(next_cursor, str) or not next_cursor or len(next_cursor) > 256 or next_cursor == cursor):
                raise ProjectionError("Blockwise cursor is invalid")
            if len(page_rows) > self.page_size:
                raise ProjectionError("Blockwise customer page exceeds its bound")
            for row in page_rows:
                if not isinstance(row, Mapping) or not isinstance(row.get("id"), str) or not _UUID.fullmatch(row["id"]):
                    raise ProjectionError("Blockwise customer lacks workspace UUID")
                normalized = {"id": row["id"], "workspace_id": row["id"]}
                for key in ("name", "mode", "region", "country_code", "created_at", "updated_at", "billing_access_state", "stripe_subscription_status", "stripe_latest_invoice_status"):
                    if key in row: normalized[key] = row[key]
                if "name" in row: normalized["display_name"] = row["name"]
                owner = row.get("owner")
                if isinstance(owner, Mapping):
                    if isinstance(owner.get("email"), str): normalized["email"] = owner["email"]
                    if isinstance(owner.get("full_name"), str): normalized["display_name"] = owner["full_name"]
                if isinstance(row.get("lifecycle"), Mapping) and isinstance(row["lifecycle"].get("stage"), str): normalized["lifecycle"] = row["lifecycle"]["stage"]
                if isinstance(row.get("stripe_subscription_status"), str) and row["stripe_subscription_status"] in _STATUS: normalized["status"] = row["stripe_subscription_status"]
                rows.append(normalized)
            if next_cursor is None:
                break
            cursor = next_cursor
        else:
            raise ProjectionError("Blockwise customer pagination exceeded its bound")
        if len(rows) > self.max_pages * self.page_size:
            raise ProjectionError("Blockwise customer count exceeds its bound")
        if len({row["id"] for row in rows}) != len(rows):
            raise ProjectionError("Blockwise customer page contains a duplicate customer")
        workspace_ids = sorted({row["workspace_id"] for row in rows})
        projections: dict[str, list[dict[str, Any]] | None] = {name: None for name in PROJECTION_NAMES}
        projections["customers"] = rows
        for customer in rows:
            customer_id = customer["id"]
            envelope = self._request("/api/internal/ops/customers/" + urllib.parse.quote(customer_id, safe=""))
            source_revision = self._merge_source(envelope, receipts, source_revision)
            source_fresh_until = _min_time(source_fresh_until, envelope["fresh_until"])
            detail = envelope.get("data")
            expected_detail = {"workspace", "members", "profiles", "activation", "bookings", "enquiries", "billing", "email", "projections", "activity"}
            if not isinstance(detail, Mapping) or not expected_detail.issubset(detail) or set(detail) - expected_detail - {"providerSnapshots"}:
                raise ProjectionError("Blockwise customer detail shape is invalid")
            workspace = detail["workspace"]
            if not isinstance(workspace, Mapping) or workspace.get("id") != customer_id:
                raise ProjectionError("Blockwise customer detail workspace is invalid")
            profiles = detail["profiles"]
            if not isinstance(profiles, list) or any(not isinstance(value, Mapping) for value in profiles):
                raise ProjectionError("Blockwise profiles section is invalid")
            profile_by_id = {value.get("id"): value for value in profiles if isinstance(value.get("id"), str)}
            for source_name, projection_name in (("members", "members"), ("bookings", "bookings"), ("enquiries", "enquiries"), ("activity", "activity")):
                values = detail[source_name]
                if values is not None and (not isinstance(values, list) or any(not isinstance(value, Mapping) for value in values)):
                    raise ProjectionError("Blockwise detail section is invalid")
                if isinstance(values, list):
                    normalized_values = []
                    for value in values:
                        item = dict(value)
                        if projection_name == "members":
                            profile = profile_by_id.get(item.get("profile_id"))
                            if isinstance(profile, Mapping):
                                for profile_key, target_key in (("email", "email"), ("full_name", "full_name")):
                                    if profile_key in profile: item[target_key] = profile[profile_key]
                        normalized_values.append(self._normalize_item(item, projection_name, customer_id))
                    projections[projection_name] = (projections[projection_name] or []) + normalized_values
            email = detail["email"]
            if not isinstance(email, Mapping): raise ProjectionError("Blockwise email section is invalid")
            if "providerSnapshots" in detail:
                values = detail["providerSnapshots"]
                if not isinstance(values, list) or any(not isinstance(value, Mapping) for value in values): raise ProjectionError("Blockwise provider snapshots are invalid")
                for value in values:
                    snapshot_kind = value.get("snapshot_kind")
                    target = {"delivery": "email", "flow": "flows", "lifecycle": "mautic", "conversation": "enquiries"}.get(snapshot_kind)
                    if target is None:
                        raise ProjectionError("Blockwise provider snapshot kind is invalid")
                    if projections[target] is None: projections[target] = []
                    snapshot = dict(value)
                    aggregate_type, aggregate_id = snapshot.get("aggregate_type"), snapshot.get("aggregate_id")
                    if not isinstance(aggregate_type, str) or not aggregate_type or len(aggregate_type) > 64 or not isinstance(aggregate_id, str) or not aggregate_id or len(aggregate_id) > 256:
                        raise ProjectionError("Blockwise provider snapshot aggregate is invalid")
                    snapshot.pop("aggregate_type", None)
                    snapshot.pop("aggregate_id", None)
                    snapshot.pop("snapshot_kind", None)
                    snapshot.setdefault("provider_record_suffix", _masked_suffix(aggregate_id))
                    projections[target].append(self._normalize_item(snapshot, target, customer_id))
            billing = detail["billing"]
            if billing is not None:
                if not isinstance(billing, Mapping): raise ProjectionError("Blockwise billing section is invalid")
                billing_rows = []
                if isinstance(billing.get("workspace"), Mapping):
                    workspace_billing = dict(billing["workspace"])
                    workspace_billing["id"] = "billing:" + customer_id
                    billing_rows.append(workspace_billing)
                if isinstance(billing.get("acceptances"), list):
                    if any(not isinstance(value, Mapping) for value in billing["acceptances"]):
                        raise ProjectionError("Blockwise billing acceptances are invalid")
                    billing_rows.extend(dict(value) for value in billing["acceptances"])
                if not billing_rows: raise ProjectionError("Blockwise billing section lacks rows")
                projections["billing"] = (projections["billing"] or []) + [self._normalize_item(value, "billing", customer_id) for value in billing_rows]
        # Public enquiries include records not yet associated with a workspace;
        # retain them separately without inventing a customer correlation.
        projections["enquiries"] = projections["enquiries"] or []
        global_enquiry_ids: set[str] = {str(item["id"]) for item in projections["enquiries"] if isinstance(item.get("id"), str)}
        enquiry_cursor = ""
        for _ in range(self.max_pages):
            query = {"limit": str(self.page_size)}
            if enquiry_cursor: query["cursor"] = enquiry_cursor
            envelope = self._request("/api/internal/ops/enquiries", query)
            source_revision = self._merge_source(envelope, receipts, source_revision)
            source_fresh_until = _min_time(source_fresh_until, envelope["fresh_until"])
            enquiry_page = envelope.get("data")
            if (not isinstance(enquiry_page, Mapping) or set(enquiry_page) != {"limit", "total", "nextCursor", "rows"}
                    or not isinstance(enquiry_page["limit"], int) or enquiry_page["limit"] != self.page_size
                    or not isinstance(enquiry_page["total"], int) or not isinstance(enquiry_page["rows"], list)
                    or len(enquiry_page["rows"]) > self.page_size):
                raise ProjectionError("Blockwise enquiry list shape is invalid")
            for value in enquiry_page["rows"]:
                if not isinstance(value, Mapping): raise ProjectionError("Blockwise enquiry row is invalid")
                item = dict(value)
                if "workspace_id" not in item or item.get("workspace_id") is not None:
                    raise ProjectionError("Blockwise global enquiry must have null workspace_id")
                if not isinstance(item.get("id"), str) or not item["id"]:
                    raise ProjectionError("Blockwise enquiry lacks an internal id")
                if item["id"] in global_enquiry_ids:
                    continue
                workspace_id = item.get("workspace_id")
                if workspace_id is not None:
                    if not isinstance(workspace_id, str) or not _UUID.fullmatch(workspace_id) or workspace_id not in workspace_ids:
                        raise ProjectionError("Blockwise enquiry workspace is outside the configured project")
                    item.setdefault("customer_id", workspace_id)
                projections["enquiries"].append(self._normalize_item(item, "enquiries", None))
                global_enquiry_ids.add(item["id"])
            next_cursor = enquiry_page["nextCursor"]
            if next_cursor is None: break
            if not isinstance(next_cursor, str) or not next_cursor or len(next_cursor) > 256 or next_cursor == enquiry_cursor: raise ProjectionError("Blockwise enquiry cursor is invalid")
            enquiry_cursor = next_cursor
        else:
            raise ProjectionError("Blockwise enquiry pagination exceeded its bound")
        return {"project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": workspace_ids,
                "source_scope": {"project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": workspace_ids},
                "source_revision": source_revision, "source_receipt_ids": sorted(set(receipts)), "fresh_until": source_fresh_until, "projections": projections}

    @staticmethod
    def _merge_source(envelope: Mapping[str, Any], receipts: list[str], source_revision: str) -> str:
        receipts.extend(envelope["source_receipt_ids"])
        if source_revision and envelope["source_revision"] != source_revision:
            raise ProjectionError("Blockwise source revision changed during pagination")
        return envelope["source_revision"]

    @staticmethod
    def _normalize_item(value: dict[str, Any], projection_name: str, customer_id: str | None) -> dict[str, Any]:
        # Provider identifiers never cross the Frank projection boundary. Keep
        # only a short, non-reversible display suffix where the operator needs
        # correlation context.
        if projection_name == "email" and "message_id" in value:
            value["provider_record_suffix"] = _masked_suffix(value.pop("message_id"))
        if projection_name == "mautic" and "contact_ref" in value:
            value["provider_record_suffix"] = _masked_suffix(value.pop("contact_ref"))
        if projection_name == "enquiries":
            for key in ("conversation_id", "external_id", "source_id"):
                if key in value:
                    value["provider_record_suffix"] = _masked_suffix(value.pop(key))
        if projection_name == "activity":
            value.pop("metadata", None)
            if "action" in value: value.setdefault("title", value.pop("action"))
            if "target_type" in value: value.setdefault("kind", value.pop("target_type"))
            if "target_id" in value: value.setdefault("entity_ref", value.pop("target_id"))
        if customer_id is not None:
            value.setdefault("customer_id", customer_id)
            value.setdefault("workspace_id", customer_id)
        if projection_name == "members" and not value.get("id"):
            profile_id = value.get("profile_id")
            if not isinstance(profile_id, str) or not profile_id or customer_id is None:
                raise ProjectionError("Blockwise member lacks a profile id")
            value["id"] = "member:" + hashlib.sha256((customer_id + ":" + profile_id).encode("utf-8")).hexdigest()[:24]
        if not isinstance(value.get("id"), str) or not value["id"]:
            raise ProjectionError("Blockwise normalized section item lacks an id")
        return value

@dataclass(frozen=True)
class ProjectionSnapshot:
    name: str
    status: str
    items: list[dict[str, Any]]
    published_at: str | None = None
    fresh_until: str | None = None
    source_revision: str | None = None
    source_receipt_ids: list[str] | None = None
    publication_receipt_id: str | None = None
    message: str | None = None

    def to_dict(self, *, include_items: bool = True) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schema": PROJECTION_SPECS[self.name]["schema"],
            "version": OPS_SCHEMA_VERSION,
            "projection": self.name,
            "status": self.status,
            "published_at": self.published_at,
            "fresh_until": self.fresh_until,
            "source_revision": self.source_revision,
            "source_receipt_ids": self.source_receipt_ids or [],
            "publication_receipt_id": self.publication_receipt_id,
        }
        if include_items:
            result["items"] = self.items
        if self.message:
            result["message"] = self.message
        return result


def _safe_value(value: Any, *, depth: int = 0) -> Any:
    """Copy bounded scalar/list/object values without allowing sensitive keys."""
    if depth > 3:
        return None
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, float) and not math.isfinite(value):
            raise ProjectionError("projection contains a non-finite number")
        if isinstance(value, str) and len(value) > 500:
            raise ProjectionError("projection contains an oversized string")
        if isinstance(value, str) and _SECRET_VALUE.search(value):
            raise ProjectionError("projection contains a secret-like value")
        return value
    if isinstance(value, list):
        return [_safe_value(item, depth=depth + 1) for item in value[:50]]
    if isinstance(value, Mapping):
        output = {}
        for key, item in value.items():
            key_text = str(key)
            if not _SAFE_KEY.fullmatch(key_text) or _SENSITIVE_KEY.search(key_text):
                continue
            output[key_text] = _safe_value(item, depth=depth + 1)
        return output
    return None


def _parse_time(value: Any, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ProjectionError(f"{field} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProjectionError(f"{field} must be an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise ProjectionError(f"{field} must include a timezone")
    return value


def _min_time(current: str | None, candidate: str) -> str:
    if current is None:
        return candidate
    return candidate if datetime.fromisoformat(candidate.replace("Z", "+00:00")) < datetime.fromisoformat(current.replace("Z", "+00:00")) else current


def _safe_item(name: str, item: Any) -> dict[str, Any]:
    if not isinstance(item, Mapping):
        raise ProjectionError(f"{name} contains a non-object item")
    spec = PROJECTION_SPECS[name]
    output: dict[str, Any] = {}
    for key, value in item.items():
        key_text = str(key)
        if key_text not in spec["fields"]:
            # Unknown fields are rejected rather than silently promoted.  This
            # keeps a future provider payload from leaking through the Window.
            raise ProjectionError(f"{name} contains unsupported field {key_text}")
        if _SENSITIVE_KEY.search(key_text):
            raise ProjectionError(f"{name} contains sensitive field {key_text}")
        output[key_text] = _safe_value(value)
    item_id = output.get("id")
    if not isinstance(item_id, str) or not _ID.fullmatch(item_id):
        raise ProjectionError(f"{name} contains an invalid item id")
    for key in ("customer_id", "receipt_id", "correlation_id"):
        if key in output and output[key] is not None and (not isinstance(output[key], str) or len(output[key]) > 256):
            raise ProjectionError(f"{name} contains an invalid reference")
    for key, value in output.items():
        if key in _TIME_KEYS:
            _parse_time(value, key)
        if key in {"status", "lifecycle", "stage", "role"} and value is not None:
            allowed = _ENUMS.get(key, _STATUS)
            if not isinstance(value, str) or value not in allowed:
                raise ProjectionError(f"{name} contains an unsupported {key}")
        if key in _ENUMS and value is not None and (not isinstance(value, str) or value not in _ENUMS[key]):
            raise ProjectionError(f"{name} contains an unsupported {key}")
        if isinstance(value, str) and len(value) > 500:
            raise ProjectionError(f"{name} contains an oversized string")
        if key == "amount" and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ProjectionError(f"{name} amount must be numeric")
        if key in {"score"} and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ProjectionError(f"{name} score must be numeric")
        if key == "cancel_at_period_end" and not isinstance(value, bool):
            raise ProjectionError(f"{name} cancel_at_period_end must be boolean")
        if key in {"tags", "segments"} and (not isinstance(value, list) or any(not isinstance(item, str) or len(item) > 120 for item in value)):
            raise ProjectionError(f"{name} {key} must be a list of short strings")
    return output


class OpsProjectionStore:
    """Read-only loader for Hermes projection envelopes."""

    def __init__(self, root: str | Path | None = None, *, clock=None):
        self.root = Path(root or os.environ.get("HERMES_OPS_PROJECTION_ROOT", "/data/ops-projections")).resolve()
        self.clock = clock or time.time
        self._receipt_lock = threading.RLock()

    def _path(self, name: str, root: Path | None = None) -> Path:
        if name not in PROJECTION_SPECS:
            raise KeyError(name)
        base = root or self.root
        path = (base / PROJECTION_SPECS[name]["filename"]).resolve()
        try:
            path.relative_to(base.resolve())
        except ValueError as error:
            raise ProjectionError("projection path escapes the configured root") from error
        return path

    def _generation_root(self) -> Path | None:
        pointer = self.root / "current.json"
        if not pointer.is_file() or pointer.is_symlink():
            return None
        try:
            value = json.loads(pointer.read_text(encoding="utf-8"))
            if not isinstance(value, Mapping) or set(value) != {"schema", "version", "generation", "publication_receipt_id"} or value.get("schema") != _POINTER_SCHEMA or value.get("version") != OPS_SCHEMA_VERSION:
                raise ProjectionError("ops current pointer is invalid")
            if not isinstance(value.get("publication_receipt_id"), str) or not _RECEIPT.fullmatch(value["publication_receipt_id"]):
                raise ProjectionError("ops current pointer receipt is invalid")
            generation = value.get("generation")
            if not isinstance(generation, str) or not re.fullmatch(r"gen-[a-z0-9-]{4,80}", generation):
                raise ProjectionError("ops generation pointer is invalid")
            target = (self.root / "generations" / generation).resolve()
            target.relative_to((self.root / "generations").resolve())
            if not target.is_dir() or target.is_symlink():
                raise ProjectionError("ops generation is unavailable")
            receipt = self._publication_receipt(target)
            if receipt["publication_receipt_id"] != value["publication_receipt_id"]:
                raise ProjectionError("ops pointer receipt does not match generation")
            return target
        except (OSError, UnicodeError, json.JSONDecodeError, ProjectionError, ValueError) as error:
            raise ProjectionError(str(error)) from error

    def _load_from_root(self, name: str, generation_root: Path) -> ProjectionSnapshot:
        path = self._path(name, generation_root)
        if not path.exists():
            return ProjectionSnapshot(name, "setup_needed", [], message="Hermes has not published this projection yet.")
        if not path.is_file() or path.is_symlink():
            return ProjectionSnapshot(name, "error", [], message="Projection source is not a regular file.")
        try:
            generation_receipt = self._publication_receipt(generation_root)
            if path.stat().st_size > 4 * 1024 * 1024:
                raise ProjectionError("projection exceeds the Window size bound")
            envelope = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(envelope, Mapping):
                raise ProjectionError("projection envelope must be an object")
            if set(envelope) - _ENVELOPE_FIELDS:
                raise ProjectionError("projection envelope contains unsupported fields")
            spec = PROJECTION_SPECS[name]
            if envelope.get("schema") != spec["schema"] or envelope.get("version") != OPS_SCHEMA_VERSION or envelope.get("projection") != name:
                raise ProjectionError("projection schema or version is unsupported")
            workspace_ids = envelope.get("workspace_ids")
            if envelope.get("project_id") != BLOCKWISE_PROJECT_ID or not isinstance(workspace_ids, list) or not workspace_ids or any(not isinstance(item, str) or not _UUID.fullmatch(item) for item in workspace_ids) or workspace_ids != sorted(set(workspace_ids)):
                raise ProjectionError("projection is outside the Blockwise workspace")
            scope = envelope.get("source_scope")
            if not isinstance(scope, Mapping) or set(scope) != {"project_id", "workspace_ids", "system"} or scope.get("project_id") != BLOCKWISE_PROJECT_ID or scope.get("workspace_ids") != workspace_ids or scope.get("system") != name:
                raise ProjectionError("projection source scope is invalid")
            source_receipts = envelope.get("source_receipt_ids")
            if not isinstance(source_receipts, list) or not source_receipts or any(not isinstance(item, str) or not _RECEIPT.fullmatch(item) for item in source_receipts):
                raise ProjectionError("projection source receipt is required")
            if envelope.get("source_revision") != generation_receipt.get("source_revision") or set(source_receipts) != set(generation_receipt.get("source_receipt_ids", [])) or workspace_ids != generation_receipt.get("workspace_ids"):
                raise ProjectionError("projection provenance does not match generation receipt")
            items = envelope.get("items")
            if not isinstance(items, list):
                raise ProjectionError("projection items must be a list")
            if len(items) > 10000:
                raise ProjectionError("projection contains too many items")
            safe_items = [_safe_item(name, item) for item in items]
            for item in safe_items:
                item_workspace = item.get("workspace_id")
                if name == "enquiries" and item_workspace is None:
                    continue
                if not isinstance(item_workspace, str) or not _UUID.fullmatch(item_workspace) or item_workspace not in workspace_ids:
                    raise ProjectionError("projection row is outside the configured workspace")
            if name == "customers":
                if len({item.get("id") for item in safe_items}) != len(safe_items):
                    raise ProjectionError("customers contains a duplicate customer")
                customer_ids = {item.get("id") for item in safe_items}
            else:
                customer_snapshot = self._load_from_root("customers", generation_root) if name != "customers" else None
                customer_ids = {item.get("id") for item in (customer_snapshot.items if customer_snapshot and customer_snapshot.status in {"ready", "stale"} else [])}
                if any(item.get("customer_id") and item.get("customer_id") not in customer_ids for item in safe_items):
                    raise ProjectionError("projection references an unknown Blockwise customer")
            published_at = _parse_time(envelope.get("published_at"), "published_at")
            if not published_at:
                raise ProjectionError("published_at is required")
            fresh_until = _parse_time(envelope.get("fresh_until"), "fresh_until")
            if not fresh_until:
                raise ProjectionError("fresh_until is required")
            source_revision = envelope.get("source_revision")
            if not isinstance(source_revision, str) or not source_revision or len(source_revision) > 256:
                raise ProjectionError("source_revision is invalid")
            publication_receipt = envelope.get("publication_receipt_id")
            if not isinstance(publication_receipt, str) or not _RECEIPT.fullmatch(publication_receipt):
                raise ProjectionError("publication receipt is required")
            if publication_receipt != generation_receipt["publication_receipt_id"]:
                raise ProjectionError("projection receipt does not match generation")
            status = "stale" if fresh_until and datetime.fromisoformat(fresh_until.replace("Z", "+00:00")).timestamp() < self.clock() else "ready"
            return ProjectionSnapshot(name, status, safe_items, published_at, fresh_until, source_revision,
                                      list(source_receipts), publication_receipt,
                                      "Hermes projection is stale." if status == "stale" else None)
        except (OSError, UnicodeError, json.JSONDecodeError, ProjectionError) as error:
            return ProjectionSnapshot(name, "error", [], message=str(error))

    @staticmethod
    def _publication_receipt(generation_root: Path) -> Mapping[str, Any]:
        receipt_path = generation_root / "publication-receipt.json"
        if not receipt_path.is_file() or receipt_path.is_symlink():
            raise ProjectionError("ops publication receipt is unavailable")
        value = json.loads(receipt_path.read_text(encoding="utf-8"))
        required = {"schema", "project_id", "workspace_ids", "publication_receipt_id", "source_revision", "source_receipt_ids", "published_at", "projection_count"}
        if not isinstance(value, Mapping) or set(value) != required or value.get("schema") != "schema://frank.ops-publication-receipt/v1" or value.get("project_id") != BLOCKWISE_PROJECT_ID or not isinstance(value.get("publication_receipt_id"), str) or not _RECEIPT.fullmatch(value["publication_receipt_id"]):
            raise ProjectionError("ops publication receipt is invalid")
        workspace_ids = value.get("workspace_ids")
        source_receipts = value.get("source_receipt_ids")
        if not isinstance(workspace_ids, list) or not workspace_ids or any(not isinstance(item, str) or not _UUID.fullmatch(item) for item in workspace_ids) or workspace_ids != sorted(set(workspace_ids)) or not isinstance(value.get("source_revision"), str) or not value["source_revision"] or not isinstance(source_receipts, list) or not source_receipts or any(not isinstance(item, str) or not _RECEIPT.fullmatch(item) for item in source_receipts) or value.get("projection_count") != len(PROJECTION_SPECS):
            raise ProjectionError("ops publication receipt metadata is invalid")
        if not _parse_time(value.get("published_at"), "publication receipt published_at"):
            raise ProjectionError("ops publication receipt published_at is required")
        return value

    def load(self, name: str) -> ProjectionSnapshot:
        try:
            generation = self._generation_root()
        except ProjectionError as error:
            return ProjectionSnapshot(name, "error", [], message=str(error))
        if generation is None:
            return ProjectionSnapshot(name, "setup_needed", [], message="Hermes has not published a complete generation yet.")
        return self._load_from_root(name, generation)

    def all(self) -> dict[str, ProjectionSnapshot]:
        try:
            generation = self._generation_root()
        except ProjectionError as error:
            return {name: ProjectionSnapshot(name, "error", [], message=str(error)) for name in PROJECTION_NAMES}
        if generation is None:
            return {name: ProjectionSnapshot(name, "setup_needed", [], message="Hermes has not published a complete generation yet.") for name in PROJECTION_NAMES}
        return {name: self._load_from_root(name, generation) for name in PROJECTION_NAMES}

    def action_receipts(self, customer_id: str | None = None) -> list[dict[str, Any]]:
        with self._receipt_lock:
            values = self._action_receipts_unlocked()
        if customer_id is None:
            return values
        return [value for value in values if _receipt_matches_customer(value, customer_id)]

    def _action_receipts_unlocked(self) -> list[dict[str, Any]]:
        path = self.root / "action-receipts.json"
        if not path.is_file() or path.is_symlink():
            return []
        try:
            values = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(values, list): return []
            valid = []
            for value in values[:100]:
                try:
                    if isinstance(value, Mapping): valid.append(self._validate_action_receipt(value))
                except ProjectionError:
                    continue
            return valid
        except (OSError, UnicodeError, json.JSONDecodeError, ProjectionError):
            return []

    def record_action_receipt(self, receipt: Mapping[str, Any]) -> None:
        with self._receipt_lock:
            receipt_id = receipt.get("receipt_id")
            if not isinstance(receipt_id, str) or not _RECEIPT.fullmatch(receipt_id):
                raise ProjectionError("Hermes action receipt is invalid")
            if receipt.get("status") not in _ACTION_STATUSES:
                raise ProjectionError("Hermes action receipt status is invalid")
            safe = {"schema": "schema://frank.action-receipt/v1", **{key: _safe_value(value) for key, value in receipt.items() if key in {"receipt_id", "status", "action_id", "target_id", "idempotency_key", "correlation_id", "rollback_action_id"}}}
            safe = self._validate_action_receipt(safe)
            values = [item for item in self._action_receipts_unlocked() if item.get("receipt_id") != receipt_id]
            values.insert(0, safe)
            self.root.mkdir(parents=True, exist_ok=True)
            temporary = self.root / ".action-receipts.json.tmp"
            _durable_write(temporary, json.dumps(values[:100], sort_keys=True) + "\n")
            os.replace(temporary, self.root / "action-receipts.json")
            _fsync_directory(self.root)

    @staticmethod
    def _validate_action_receipt(value: Mapping[str, Any]) -> dict[str, Any]:
        allowed = {"schema", "receipt_id", "status", "action_id", "target_id", "idempotency_key", "correlation_id", "rollback_action_id"}
        if set(value) - allowed or value.get("schema") != "schema://frank.action-receipt/v1" or not isinstance(value.get("receipt_id"), str) or not _RECEIPT.fullmatch(value["receipt_id"]) or value.get("status") not in _ACTION_STATUSES:
            raise ProjectionError("persisted Hermes action receipt is invalid")
        result = {"schema": value["schema"], "receipt_id": value["receipt_id"], "status": value["status"]}
        for key in ("action_id", "target_id", "idempotency_key", "correlation_id", "rollback_action_id"):
            if key in value:
                if not isinstance(value[key], str) or not 256 >= len(value[key]) >= 1 or _SECRET_VALUE.search(value[key]):
                    raise ProjectionError("persisted Hermes action receipt field is invalid")
                result[key] = value[key]
        return result


def _customer_id(item: Mapping[str, Any]) -> str | None:
    value = item.get("customer_id")
    if isinstance(value, str) and value:
        return value
    value = item.get("id")
    return value if isinstance(value, str) else None


def _receipt_matches_customer(receipt: Mapping[str, Any], customer_id: str) -> bool:
    for key in ("target_id", "target_customer_id", "correlation_id"):
        value = receipt.get(key)
        if isinstance(value, str) and (value == customer_id or value.endswith(":" + customer_id)):
            return True
    return False


def _overall_status(snapshots: Mapping[str, ProjectionSnapshot]) -> str:
    statuses = {item.status for item in snapshots.values()}
    if "error" in statuses:
        return "error"
    if "stale" in statuses:
        return "stale"
    if "setup_needed" in statuses:
        return "setup_needed"
    if "ready" in statuses:
        return "ready"
    return "setup_needed"


def publish_bundle(bundle: Mapping[str, Any], root: str | Path, *, now: float | None = None, freshness_seconds: int = 900) -> str:
    """Validate and atomically publish a Hermes-safe bundle.

    This is the hand-off used by the Hermes-side export job.  It accepts only
    already-scoped, metadata-only rows; it never has provider credentials.
    """
    if not isinstance(bundle, Mapping) or bundle.get("project_id") != BLOCKWISE_PROJECT_ID:
        raise ProjectionError("publisher requires project_id=blockwise")
    if now is not None and (not isinstance(now, (int, float)) or isinstance(now, bool) or not math.isfinite(now)):
        raise ProjectionError("publisher timestamp is invalid")
    if isinstance(freshness_seconds, bool) or not isinstance(freshness_seconds, int) or not 60 <= freshness_seconds <= 86400:
        raise ProjectionError("publisher freshness window is invalid")
    workspace_ids = bundle.get("workspace_ids")
    if not isinstance(workspace_ids, list) or not workspace_ids or any(not isinstance(item, str) or not _UUID.fullmatch(item) for item in workspace_ids) or workspace_ids != sorted(set(workspace_ids)):
        raise ProjectionError("publisher requires real workspace UUIDs")
    source_scope = bundle.get("source_scope")
    if source_scope is not None:
        if (not isinstance(source_scope, Mapping) or set(source_scope) != {"project_id", "workspace_ids"}
                or source_scope.get("project_id") != BLOCKWISE_PROJECT_ID
                or source_scope.get("workspace_ids") != workspace_ids):
            raise ProjectionError("publisher source scope does not match Blockwise workspaces")
    source_revision = bundle.get("source_revision")
    if not isinstance(source_revision, str) or not source_revision or len(source_revision) > 256:
        raise ProjectionError("publisher requires source_revision")
    source_receipts = bundle.get("source_receipt_ids")
    if not isinstance(source_receipts, list) or not source_receipts or any(not isinstance(item, str) or not _RECEIPT.fullmatch(item) for item in source_receipts):
        raise ProjectionError("publisher requires source_receipt_ids")
    source_fresh_until = bundle.get("fresh_until")
    if source_fresh_until is not None:
        source_fresh_until = _parse_time(source_fresh_until, "source fresh_until")
        if datetime.fromisoformat(source_fresh_until.replace("Z", "+00:00")).timestamp() <= (now if now is not None else time.time()):
            raise ProjectionError("publisher source is expired")
    projections = bundle.get("projections")
    if not isinstance(projections, Mapping) or set(projections) != set(PROJECTION_NAMES):
        raise ProjectionError("publisher requires projections")
    stamp = datetime.fromtimestamp(now if now is not None else time.time(), timezone.utc)
    published_at = stamp.isoformat().replace("+00:00", "Z")
    local_fresh_until = datetime.fromtimestamp((now if now is not None else time.time()) + freshness_seconds, timezone.utc).isoformat().replace("+00:00", "Z")
    fresh_until = _min_time(source_fresh_until, local_fresh_until) if source_fresh_until else local_fresh_until
    publication_receipt = "receipt:ops/" + stamp.strftime("%Y%m%d%H%M%S") + "-" + secrets.token_hex(6)
    output_root = Path(root)
    if output_root.exists() and (output_root.is_symlink() or not output_root.is_dir()):
        raise ProjectionError("publisher output root must be a regular directory")
    output_root.mkdir(parents=True, exist_ok=True)
    output_root = output_root.resolve()
    import tempfile
    generations_root = output_root / "generations"
    generations_root.mkdir(exist_ok=True)
    generation_name = "gen-" + stamp.strftime("%Y%m%d%H%M%S") + "-" + secrets.token_hex(6)
    with tempfile.TemporaryDirectory(prefix=".ops-publish-", dir=str(generations_root)) as staging:
        stage = Path(staging)
        for name, spec in PROJECTION_SPECS.items():
            rows = projections.get(name, [])
            if rows is None:
                continue
            if not isinstance(rows, list):
                raise ProjectionError(f"publisher projection {name} must be a list")
            envelope = {"schema": spec["schema"], "version": OPS_SCHEMA_VERSION, "projection": name,
                        "project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": workspace_ids,
                        "source_scope": {"project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": workspace_ids, "system": name},
                        "source_revision": source_revision, "source_receipt_ids": source_receipts,
                        "publication_receipt_id": publication_receipt, "published_at": published_at,
                        "fresh_until": fresh_until, "items": rows}
            target = stage / spec["filename"]
            _durable_write(target, json.dumps(envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
        receipt = {"schema": "schema://frank.ops-publication-receipt/v1", "project_id": BLOCKWISE_PROJECT_ID,
                   "workspace_ids": workspace_ids, "publication_receipt_id": publication_receipt,
                   "source_revision": source_revision, "source_receipt_ids": source_receipts,
                   "published_at": published_at, "projection_count": len(PROJECTION_SPECS)}
        _durable_write(stage / "publication-receipt.json", json.dumps(receipt, sort_keys=True) + "\n")
        check = OpsProjectionStore(output_root, clock=lambda: now if now is not None else time.time())
        if any(check._load_from_root(name, stage).status not in {"ready", "setup_needed"} for name in PROJECTION_NAMES):
            raise ProjectionError("publisher bundle failed projection validation")
        _fsync_directory(stage)
        final_generation = generations_root / generation_name
        os.replace(stage, final_generation)
        _fsync_directory(generations_root)
        pointer = {"schema": _POINTER_SCHEMA, "version": OPS_SCHEMA_VERSION, "generation": generation_name, "publication_receipt_id": publication_receipt}
        temporary = output_root / ".current.json.tmp"
        _durable_write(temporary, json.dumps(pointer, sort_keys=True) + "\n")
        os.replace(temporary, output_root / "current.json")
        _fsync_directory(output_root)
        _gc_generations(generations_root, generation_name, keep=3)
    return publication_receipt


def _durable_write(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8") as output:
        output.write(text)
        output.flush()
        os.fsync(output.fileno())


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _gc_generations(generations_root: Path, current: str, *, keep: int = 3) -> None:
    """Bound old complete generations after the new pointer is durable."""
    candidates = sorted((item for item in generations_root.iterdir() if item.is_dir() and not item.is_symlink() and re.fullmatch(r"gen-[a-z0-9-]{4,80}", item.name)), key=lambda item: item.name, reverse=True)
    retained = {current, *(item.name for item in candidates[:max(1, keep)])}
    for item in candidates:
        if item.name not in retained:
            shutil.rmtree(item)


def create_blueprint(*, store: OpsProjectionStore | None = None, dispatcher_factory=None) -> Blueprint:
    projection_store = store or OpsProjectionStore()
    api = Blueprint("ops_projections", __name__)

    @api.get("/api/ops/overview")
    def overview():
        snapshots = projection_store.all()
        customers = snapshots["customers"]
        return jsonify({
            "schema": OPS_SCHEMA,
            "version": OPS_SCHEMA_VERSION,
            "status": _overall_status(snapshots),
            "customers": customers.items,
            "projections": {name: snapshot.to_dict(include_items=False) for name, snapshot in snapshots.items()},
        })

    @api.get("/api/ops/projections/<name>")
    def projection(name: str):
        if name not in PROJECTION_SPECS:
            abort(404)
        snapshot = projection_store.load(name)
        return jsonify(snapshot.to_dict())

    @api.get("/api/ops/customers")
    def customers():
        snapshot = projection_store.load("customers")
        query = str(request.args.get("q", "")).strip().lower()
        limit = min(200, max(1, request.args.get("limit", type=int) or 100))
        rows = snapshot.items
        if query:
            rows = [row for row in rows if query in " ".join(str(row.get(key, "")) for key in ("id", "display_name", "name", "email", "company")).lower()]
        return jsonify({"schema": OPS_SCHEMA, "version": OPS_SCHEMA_VERSION, "status": snapshot.status, "customers": rows[:limit], "message": snapshot.message})

    @api.get("/api/ops/customers/<customer_id>")
    def customer_detail(customer_id: str):
        if not _ID.fullmatch(customer_id):
            abort(404)
        snapshots = projection_store.all()
        customer = next((row for row in snapshots["customers"].items if row.get("id") == customer_id), None)
        if customer is None:
            abort(404)
        sections: dict[str, list[dict[str, Any]]] = {}
        for name, snapshot in snapshots.items():
            if name == "customers":
                continue
            sections[name] = [row for row in snapshot.items if _customer_id(row) == customer_id]
        return jsonify({"schema": OPS_SCHEMA, "version": OPS_SCHEMA_VERSION, "status": _overall_status(snapshots), "customer": customer, "sections": sections, "action_receipts": projection_store.action_receipts(customer_id), "projections": {name: item.to_dict(include_items=False) for name, item in snapshots.items()}})

    @api.get("/api/ops/activity")
    def activity():
        snapshot = projection_store.load("activity")
        customer_id = str(request.args.get("customer_id", "")).strip()
        rows = snapshot.items
        if customer_id:
            rows = [row for row in rows if _customer_id(row) == customer_id]
        receipts = projection_store.action_receipts(customer_id or None)
        return jsonify({"schema": OPS_SCHEMA, "version": OPS_SCHEMA_VERSION, "status": snapshot.status, "activity": rows[:200], "action_receipts": receipts, "message": snapshot.message})

    @api.post("/api/ops/actions")
    def dispatch_ops_action():
        body = request.get_json(silent=True)
        if not isinstance(body, Mapping):
            abort(400, description="typed ops action request required")
        action_id = body.get("action_id")
        target_id = body.get("target_id")
        arguments = body.get("arguments")
        if not isinstance(action_id, str) or not isinstance(target_id, str) or not isinstance(arguments, Mapping):
            abort(400, description="typed ops action request required")
        attestation = request.headers.get("X-Frank-Operator-Attestation") or request.headers.get("X-Operator-Attestation", "")
        try:
            dispatcher = dispatcher_factory() if dispatcher_factory else HermesDispatcher(_actions_path())
            result = dispatcher.dispatch(action_id=action_id, target_id=target_id, arguments=arguments, attestation=attestation)
        except DispatchError as error:
            return jsonify({"schema": "schema://frank.action-receipt/v1", "status": "preview", "applies": False, "error": str(error)}), 503
        result = result if isinstance(result, Mapping) else {}
        receipt_id = result.get("receipt_id")
        status = str(result.get("status", ""))
        response_target = result.get("target_id")
        response_action = result.get("action_id")
        requested_key = arguments.get("idempotency_key")
        response_key = result.get("idempotency_key")
        correlation_id = result.get("correlation_id")
        correlation_valid = correlation_id is None or (isinstance(correlation_id, str) and 1 <= len(correlation_id) <= 256 and not _SECRET_VALUE.search(correlation_id))
        response_schema = result.get("schema")
        schema_valid = response_schema is None or (isinstance(response_schema, str) and response_schema.startswith("schema://") and len(response_schema) <= 256)
        target_valid = response_target is None or response_target == target_id
        action_valid = response_action is None or response_action == action_id
        key_valid = response_key is None or response_key == requested_key
        hermes_applies = result.get("applies")
        authoritative = isinstance(receipt_id, str) and _RECEIPT.fullmatch(receipt_id) and status in {"accepted", "queued", "completed", "recorded"} and result.get("preview") is not True and (hermes_applies is None or hermes_applies is True) and schema_valid and correlation_valid and target_valid and action_valid and key_valid
        # Hermes controls the receipt shape. Keep the Window response to the
        # documented correlation fields even if an injected boundary returns
        # extra data; provider payloads and credentials never cross this API.
        response = {"schema": "schema://frank.action-receipt/v1", "applies": authoritative}
        for key in ("status", "receipt_id", "action_id", "target_id", "idempotency_key", "correlation_id", "rollback_action_id", "message"):
            if key in result:
                response[key] = _safe_value(result[key])
        if authoritative:
            try:
                projection_store.record_action_receipt(result)
            except ProjectionError:
                return jsonify({"schema": "schema://frank.action-receipt/v1", "status": "preview", "applies": False, "error": "Hermes receipt could not be durably recorded"}), 503
        else:
            response["status"] = "preview"
        return jsonify(response), (200 if authoritative else 503)

    return api


def _actions_path() -> Path:
    """Use the same canonical repository/control-plane root as Control view."""
    return control_plane_view.CONTROL_ROOT / "actions.yaml"


__all__ = ["BLOCKWISE_PROJECT_ID", "OPS_SCHEMA", "OPS_SCHEMA_VERSION", "OPS_PROJECTION_SCHEMAS", "PROJECTION_NAMES", "PROJECTION_SPECS", "BlockwiseOpsClient", "OpsProjectionStore", "ProjectionError", "create_blueprint", "publish_bundle"]
