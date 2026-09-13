"""Narrow owner CRM customer-sync connector.

This is the missing connection between three systems that already exist:

    Blockwise protected snapshot  ->  this connector  ->  native Frappe Contact

It is deliberately small. It reads bounded pages from the protected Blockwise
customer-snapshot endpoint, compares them against native Frappe CRM contacts,
and in Apply mode creates or updates one Contact per single-person signup.

What it never does
------------------
- It never changes customer access, charges money or sends email.
- It never writes Stripe, Blockwise, provider or CRM billing state except the
  approved read-only mirror fields on Contact.
- It never merges contacts by email.
- It never deletes a contact when a source record disappears.
- It never turns an Ad Radar prospect into a customer.

Design rules
------------
- Preview is the default. `--apply` is required for any write.
- Identity is matched on both immutable UUIDs. A matching email is never enough.
- One matching ID and one conflicting ID is a held conflict, not an update.
- Freshness is compared before every write: an older observation never
  overwrites a newer one already stored on the contact.
- Concurrency uses the native unique indexes, not "check, then blind overwrite".
- Retries are bounded. An uncertain write is reconciled against the current
  contact before another create is attempted.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence


# --- Fixed targets -----------------------------------------------------------

BLOCKWISE_SNAPSHOT_URL = "https://blockwise.sale"
FRAPPE_ENDPOINT = "http://127.0.0.1:18081"
FRAPPE_SITE = "owner.crm.internal"

DEFAULT_SECRET_FILE = Path("/srv/hermes/secrets/owner-crm-sync.env")
MAX_SOURCE_PAGES = 400
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
SNAPSHOT_PAGE_LIMIT_MAX = 100
SNAPSHOT_PAGE_LIMIT_DEFAULT = 50
FRAPPE_PAGE_LENGTH = 100
MAX_FRAPPE_SCAN = 20_000
MAX_WRITE_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 1.0

_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)

# Mirror fields this connector owns on a Contact.
MIRROR_TEXT_FIELDS = (
    "custom_blockwise_profile_uuid",
    "custom_blockwise_workspace_uuid",
    "custom_blockwise_subscription_status",
    "custom_blockwise_access_status",
    "custom_blockwise_trial_state",
    "custom_blockwise_sync_state",
)
MIRROR_DATETIME_FIELDS = (
    "custom_blockwise_trial_started_at",
    "custom_blockwise_trial_ends_at",
    "custom_blockwise_source_observed_at",
    "custom_blockwise_last_synced_at",
)
MIRROR_FIELDS = MIRROR_TEXT_FIELDS + MIRROR_DATETIME_FIELDS

SYNC_STATE_SYNCED = "synced"
SYNC_STATE_HELD_AMBIGUOUS = "held_ambiguous"
SYNC_STATE_HELD_STALE = "held_stale"

# Source-identity fields, in the order used for matching.
PROFILE_FIELD = "custom_blockwise_profile_uuid"
WORKSPACE_FIELD = "custom_blockwise_workspace_uuid"


class ConnectorError(RuntimeError):
    """A safe, user-facing connector failure with no payload or secret."""


# --- Secret loading ----------------------------------------------------------


@dataclass(frozen=True)
class SyncCredentials:
    blockwise_snapshot_url: str
    blockwise_signing_secret: str
    blockwise_scope: str
    frappe_api_key: str
    frappe_api_secret: str

    def redacted(self) -> dict[str, str]:
        return {
            "blockwise_snapshot_url": self.blockwise_snapshot_url,
            "blockwise_scope": self.blockwise_scope,
            "frappe_integration_user": "crm-sync@blockwise.sale",
        }


def _parse_env_file(path: Path) -> dict[str, str]:
    try:
        info = path.lstat()
    except OSError as exc:
        raise ConnectorError("owner CRM sync secret file is unavailable") from exc
    import stat as _stat

    if not _stat.S_ISREG(info.st_mode) or path.is_symlink():
        raise ConnectorError("owner CRM sync secret file must be a regular file")
    if _stat.S_IMODE(info.st_mode) != 0o600:
        raise ConnectorError("owner CRM sync secret file has unsafe permissions")
    if info.st_uid not in {0, os.geteuid()}:
        raise ConnectorError("owner CRM sync secret file has unexpected ownership")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise ConnectorError("owner CRM sync secret file is unreadable") from exc
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, value = stripped.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ConnectorError("owner CRM sync secret file has invalid syntax")
        if key in values:
            raise ConnectorError("duplicate owner CRM secret key")
        values[key] = value
    return values


def load_sync_credentials(path: Path = DEFAULT_SECRET_FILE) -> SyncCredentials:
    values = _parse_env_file(path)

    def required(key: str) -> str:
        value = values.get(key, "")
        if not value or "\n" in value or "\r" in value:
            raise ConnectorError(f"owner CRM sync secret is missing: {key}")
        return value

    signing_secret = required("OWNER_CRM_SNAPSHOT_AUTH_SECRET")
    if len(signing_secret) < 32:
        raise ConnectorError("owner CRM sync signing secret is too short")
    return SyncCredentials(
        blockwise_snapshot_url=BLOCKWISE_SNAPSHOT_URL,
        blockwise_signing_secret=signing_secret,
        blockwise_scope="owner-crm.customer-snapshot",
        frappe_api_key=required("OWNER_CRM_FRAPPE_API_KEY"),
        frappe_api_secret=required("OWNER_CRM_FRAPPE_API_SECRET"),
    )


# --- Source snapshot ---------------------------------------------------------


@dataclass(frozen=True)
class SnapshotOwner:
    profile_id: str
    name: str | None
    email: str


@dataclass(frozen=True)
class SnapshotTrial:
    state: str | None
    started_at: str | None
    ends_at: str | None


@dataclass(frozen=True)
class CustomerSnapshot:
    workspace_id: str
    owner: SnapshotOwner | None
    billing_access_state: str | None
    stripe_subscription_status: str | None
    trial: SnapshotTrial
    mapping_ambiguities: tuple[str, ...]
    source_observed_at: str

    @property
    def is_ambiguous(self) -> bool:
        return bool(self.mapping_ambiguities) or self.owner is None


def _as_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    raise ConnectorError("snapshot contained a non-text field")


def map_snapshot_row(row: Mapping[str, Any]) -> CustomerSnapshot:
    if not isinstance(row, Mapping):
        raise ConnectorError("snapshot row was not an object")
    workspace_id = _as_optional_text(row.get("workspaceId"))
    if not workspace_id or not _UUID.fullmatch(workspace_id):
        raise ConnectorError("snapshot row had an invalid workspace id")
    observed = _as_optional_text(row.get("sourceObservedAt"))
    if not observed or _normalise_timestamp(observed) is None:
        raise ConnectorError("snapshot row was missing its observation time")

    owner_raw = row.get("owner")
    owner: SnapshotOwner | None = None
    if owner_raw is not None:
        if not isinstance(owner_raw, Mapping):
            raise ConnectorError("snapshot owner was not an object")
        profile_id = _as_optional_text(owner_raw.get("profileId"))
        email = _as_optional_text(owner_raw.get("email"))
        if not profile_id or not _UUID.fullmatch(profile_id):
            raise ConnectorError("snapshot owner had an invalid profile id")
        if not email:
            raise ConnectorError("snapshot owner was missing an email")
        owner = SnapshotOwner(
            profile_id=profile_id,
            name=_as_optional_text(owner_raw.get("name")),
            email=email,
        )

    trial_raw = row.get("trial")
    if not isinstance(trial_raw, Mapping):
        raise ConnectorError("snapshot row was missing trial facts")
    trial = SnapshotTrial(
        state=_as_optional_text(trial_raw.get("state")),
        started_at=_as_optional_text(trial_raw.get("startedAt")),
        ends_at=_as_optional_text(trial_raw.get("endsAt")),
    )

    for timestamp in (trial.started_at, trial.ends_at):
        if timestamp is not None and _normalise_timestamp(timestamp) is None:
            raise ConnectorError("snapshot trial timestamp was invalid")

    ambiguities_raw = row.get("mappingAmbiguities")
    if not isinstance(ambiguities_raw, list) or not all(
        isinstance(item, str) for item in ambiguities_raw
    ):
        raise ConnectorError("snapshot ambiguities were malformed")

    return CustomerSnapshot(
        workspace_id=workspace_id,
        owner=owner,
        billing_access_state=_as_optional_text(row.get("billingAccessState")),
        stripe_subscription_status=_as_optional_text(
            row.get("stripeSubscriptionStatus")
        ),
        trial=trial,
        mapping_ambiguities=tuple(ambiguities_raw),
        source_observed_at=observed,
    )


class BlockwiseSnapshotClient:
    """Signed, bounded, read-only client for the protected snapshot endpoint."""

    def __init__(
        self,
        *,
        base_url: str,
        signing_secret: str,
        scope: str,
        opener: Callable[..., Any] | None = None,
        timeout: float = 15.0,
        now: Callable[[], float] | None = None,
        nonce_factory: Callable[[], str] | None = None,
    ) -> None:
        if base_url != BLOCKWISE_SNAPSHOT_URL:
            raise ConnectorError("snapshot client requires the fixed Blockwise origin")
        self.base_url = base_url
        self.signing_secret = signing_secret
        self.scope = scope
        self.timeout = timeout
        self._now = now or time.time
        self._nonce = nonce_factory or (lambda: secrets.token_hex(16))
        self._opener = (
            urllib.request.build_opener(_NoRedirect()).open
            if opener is None
            else (opener if callable(opener) else opener.open)
        )

    def _sign(self, method: str, path: str, body: str) -> dict[str, str]:
        timestamp = str(int(self._now()))
        nonce = self._nonce()
        body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
        payload = "\n".join(
            ["v1", timestamp, nonce, self.scope, method.upper(), path, body_hash]
        )
        signature = hmac.new(
            self.signing_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return {
            "x-blockwise-timestamp": timestamp,
            "x-blockwise-nonce": nonce,
            "x-blockwise-scope": self.scope,
            "x-blockwise-signature": signature,
        }

    def fetch_page(
        self, *, after_workspace_id: str | None, limit: int
    ) -> dict[str, Any]:
        if not 1 <= limit <= SNAPSHOT_PAGE_LIMIT_MAX:
            raise ConnectorError("snapshot page limit is out of range")
        query: dict[str, str] = {"limit": str(limit)}
        if after_workspace_id is not None:
            if not _UUID.fullmatch(after_workspace_id):
                raise ConnectorError("snapshot cursor is not a UUID")
            query["afterWorkspaceId"] = after_workspace_id
        path = "/api/internal/ops/owner-crm-snapshot?" + urllib.parse.urlencode(query)
        headers = self._sign("GET", path, "")
        request = urllib.request.Request(
            self.base_url + path, headers=headers, method="GET"
        )
        try:
            with self._opener(request, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                status = int(getattr(response, "status", response.getcode()))
        except urllib.error.HTTPError as exc:
            # Provider error bodies are never surfaced: only the status class.
            raise ConnectorError(
                f"owner CRM snapshot rejected the request ({exc.code})"
            ) from None
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            raise ConnectorError("owner CRM snapshot endpoint is unavailable") from exc
        if status != 200:
            raise ConnectorError(f"owner CRM snapshot returned status {status}")
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ConnectorError("owner CRM snapshot response was too large")
        try:
            decoded = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ConnectorError("owner CRM snapshot returned invalid JSON") from exc
        if not isinstance(decoded, dict):
            raise ConnectorError("owner CRM snapshot returned an invalid page")
        return decoded



class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        raise ConnectorError("owner CRM redirect rejected")


# --- Native Frappe contact store ---------------------------------------------


@dataclass
class MirrorRecord:
    """The subset of a Contact this connector reads and writes."""

    name: str
    profile_uuid: str | None
    workspace_uuid: str | None
    source_observed_at: str | None
    values: dict[str, Any] = field(default_factory=dict)


class FrappeContactStore:
    """Minimal native Frappe client for Contacts and Custom Fields."""

    def __init__(
        self,
        *,
        endpoint: str = FRAPPE_ENDPOINT,
        site: str = FRAPPE_SITE,
        opener: Callable[..., Any] | None = None,
        timeout: float = 15.0,
    ) -> None:
        if endpoint != FRAPPE_ENDPOINT or site != FRAPPE_SITE:
            raise ConnectorError("Frappe target is not the fixed owner CRM site")
        self.endpoint = endpoint
        self.site = site
        self.timeout = timeout
        import http.cookiejar

        self.api_token = ""
        self.cookies = http.cookiejar.CookieJar()
        if opener is None:
            self._opener = urllib.request.build_opener(
                _NoRedirect(), urllib.request.HTTPCookieProcessor(self.cookies)
            ).open
        else:
            self._opener = opener if callable(opener) else opener.open

    def close(self) -> None:
        self.cookies.clear()

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | None = None,
        form: Mapping[str, str] | None = None,
    ) -> dict[str, Any]:
        if not path.startswith("/") or "://" in path:
            raise ConnectorError("invalid Frappe API path")
        data: bytes | None = None
        headers = {
            "Accept": "application/json",
            "Host": self.site,
            "X-Frappe-Site-Name": self.site,
        }
        if self.api_token:
            headers["Authorization"] = "token " + self.api_token
        if method != "GET" and path != "/api/method/login":
            csrf = next(
                (c.value for c in self.cookies if c.name == "csrf_token"), ""
            )
            if csrf:
                headers["X-Frappe-CSRF-Token"] = csrf
        if form is not None:
            data = urllib.parse.urlencode(form).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.endpoint + path, data=data, headers=headers, method=method
        )
        try:
            with self._opener(request, timeout=self.timeout) as response:
                status = int(getattr(response, "status", response.getcode()))
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except ConnectorError:
            raise
        except urllib.error.HTTPError as exc:
            if 300 <= exc.code < 400:
                raise ConnectorError("owner CRM redirect rejected") from None
            if exc.code in {401, 403}:
                raise ConnectorError("owner CRM integration login failed") from None
            if exc.code == 409:
                raise ConnectorError("owner CRM rejected a conflicting record") from None
            if exc.code == 417:
                # Frappe uses 417 for a validation/duplicate failure.
                raise ConnectorError("owner CRM rejected an invalid record") from None
            raise ConnectorError(f"owner CRM request failed ({exc.code})") from None
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            raise ConnectorError("owner CRM loopback endpoint is unavailable") from exc
        if 300 <= status < 400:
            raise ConnectorError("owner CRM redirect rejected")
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ConnectorError("owner CRM response was too large")
        try:
            decoded = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ConnectorError("owner CRM returned invalid JSON") from exc
        if not isinstance(decoded, dict):
            raise ConnectorError("owner CRM returned an invalid response")
        return decoded

    def authenticate(self, api_key: str, api_secret: str) -> None:
        if not api_key or not api_secret or any(c in api_key + api_secret for c in "\r\n:"):
            raise ConnectorError("invalid owner CRM API credential")
        self.api_token = api_key + ":" + api_secret
        result = self._request("GET", "/api/method/frappe.auth.get_logged_user")
        if result.get("message") != "crm-sync@blockwise.sale":
            self.api_token = ""
            raise ConnectorError("owner CRM token is not the dedicated integration identity")

    def custom_field_exists(self, dt: str, fieldname: str) -> bool:
        filters = json.dumps(
            [["dt", "=", dt], ["fieldname", "=", fieldname]], separators=(",", ":")
        )
        query = urllib.parse.urlencode(
            {
                "filters": filters,
                "fields": json.dumps(["name"], separators=(",", ":")),
                "limit_page_length": "1",
            }
        )
        result = self._request("GET", "/api/resource/Custom%20Field?" + query)
        data = result.get("data")
        if not isinstance(data, list):
            raise ConnectorError("owner CRM returned invalid Custom Field data")
        return len(data) == 1

    def reconcile_hold(self, workspace_id: str, outcome: str) -> None:
        """Use native CRM Tasks, not a parallel queue; no customer data in alerts."""
        title = "Customer sync review " + workspace_id
        query = urllib.parse.urlencode({"filters": json.dumps([["title", "=", title]]),
                                       "fields": json.dumps(["name", "status"]),
                                       "limit_page_length": "2"})
        rows = self._request("GET", "/api/resource/CRM%20Task?" + query).get("data")
        if not isinstance(rows, list) or len(rows) > 1:
            raise ConnectorError("owner CRM exception task identity is ambiguous")
        held = outcome.startswith("held_") or outcome == "failed"
        if held and not rows:
            self._request("POST", "/api/resource/CRM%20Task", body={
                "title": title, "status": "Todo", "priority": "High",
                "description": "Customer sync needs review: " + outcome +
                    ". No customer access, billing or email was changed. Retry after resolving source ownership or contact identity."})
        elif not held and rows and rows[0].get("status") != "Done":
            self._request("PUT", "/api/resource/CRM%20Task/" + urllib.parse.quote(str(rows[0]["name"]), safe=""),
                          body={"status": "Done"})

    def _contact_fields(self, extra: Sequence[str]) -> list[str]:
        base = [
            "name",
            "modified",
            PROFILE_FIELD,
            WORKSPACE_FIELD,
            "custom_blockwise_source_observed_at",
            "custom_blockwise_sync_state",
        ]
        for key in extra:
            if key not in base:
                base.append(key)
        return base

    def find_contact_by_identity(
        self, *, profile_uuid: str, workspace_uuid: str
    ) -> list[MirrorRecord]:
        """Return every contact matching either immutable id (bounded)."""
        fields = json.dumps(self._contact_fields(()), separators=(",", ":"))
        or_filters = json.dumps(
            [
                [PROFILE_FIELD, "=", profile_uuid],
                [WORKSPACE_FIELD, "=", workspace_uuid],
            ],
            separators=(",", ":"),
        )
        query = urllib.parse.urlencode(
            {
                "or_filters": or_filters,
                "fields": fields,
                "limit_page_length": "10",
                "order_by": "name asc",
            }
        )
        result = self._request("GET", "/api/resource/Contact?" + query)
        data = result.get("data")
        if not isinstance(data, list) or not all(
            isinstance(item, dict) for item in data
        ):
            raise ConnectorError("owner CRM returned invalid Contact data")
        if len(data) > 10:
            raise ConnectorError("owner CRM identity search was not bounded")
        return [
            MirrorRecord(
                name=str(item.get("name") or ""),
                profile_uuid=_as_optional_text(item.get(PROFILE_FIELD)),
                workspace_uuid=_as_optional_text(item.get(WORKSPACE_FIELD)),
                source_observed_at=_as_optional_text(
                    item.get("custom_blockwise_source_observed_at")
                ),
                values=dict(item),
            )
            for item in data
        ]

    def get_contact(self, name: str) -> MirrorRecord | None:
        encoded = urllib.parse.quote(name, safe="")
        try:
            result = self._request(
                "GET",
                "/api/resource/Contact/"
                + encoded
                + "?fields="
                + urllib.parse.quote(
                    json.dumps(self._contact_fields(()), separators=(",", ":"))
                ),
            )
        except ConnectorError as exc:
            if "404" in str(exc):
                return None
            raise
        data = result.get("data")
        if data is None:
            return None
        if not isinstance(data, dict):
            raise ConnectorError("owner CRM returned an invalid Contact")
        return MirrorRecord(
            name=str(data.get("name") or name),
            profile_uuid=_as_optional_text(data.get(PROFILE_FIELD)),
            workspace_uuid=_as_optional_text(data.get(WORKSPACE_FIELD)),
            source_observed_at=_as_optional_text(
                data.get("custom_blockwise_source_observed_at")
            ),
            values=dict(data),
        )

    def create_contact(self, payload: Mapping[str, Any]) -> str:
        result = self._request("POST", "/api/resource/Contact", body=dict(payload))
        data = result.get("data")
        if not isinstance(data, dict) or not data.get("name"):
            raise ConnectorError("owner CRM did not confirm the created Contact")
        return str(data["name"])

    def update_contact(self, name: str, payload: Mapping[str, Any]) -> None:
        encoded = urllib.parse.quote(name, safe="")
        result = self._request(
            "PUT", "/api/resource/Contact/" + encoded, body=dict(payload)
        )
        data = result.get("data")
        if not isinstance(data, dict) or data.get("name") != name:
            raise ConnectorError("owner CRM did not confirm the updated Contact")

# --- Planning ----------------------------------------------------------------


@dataclass(frozen=True)
class PlannedWrite:
    action: str  # create | update | unchanged | held_ambiguous | held_stale | held_conflict
    workspace_id: str
    profile_id: str | None
    contact_name: str | None
    fields: Mapping[str, Any] = field(default_factory=dict)
    reason: str | None = None


@dataclass(frozen=True)
class PreviewReport:
    creates: int
    updates: int
    unchanged: int
    held_ambiguous: int
    held_stale: int
    held_conflict: int
    pages: int
    plans: tuple[PlannedWrite, ...]

    def summary(self) -> dict[str, int]:
        return {
            "creates": self.creates,
            "updates": self.updates,
            "unchanged": self.unchanged,
            "held_ambiguous": self.held_ambiguous,
            "held_stale": self.held_stale,
            "held_conflict": self.held_conflict,
            "pages": self.pages,
        }


def _split_name(full_name: str | None) -> tuple[str, str]:
    if not full_name or not full_name.strip():
        return "", ""
    parts = full_name.strip().split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _normalise_timestamp(value: str | None) -> str | None:
    """Return a comparable UTC 'YYYY-MM-DD HH:MM:SS' form, or None."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")
    except (ValueError, TypeError, AttributeError):
        return None


def _to_frappe_datetime(value: str | None) -> str | None:
    return _normalise_timestamp(value)


def _comparison_value(key: str, value: Any) -> str:
    if key in MIRROR_DATETIME_FIELDS:
        return _normalise_timestamp(value) or ""
    return str(value or "")


def build_mirror_values(snapshot: CustomerSnapshot) -> dict[str, Any]:
    """The approved mirror payload for one non-ambiguous snapshot."""
    assert snapshot.owner is not None
    return {
        PROFILE_FIELD: snapshot.owner.profile_id,
        WORKSPACE_FIELD: snapshot.workspace_id,
        "custom_blockwise_subscription_status": snapshot.stripe_subscription_status
        or "",
        "custom_blockwise_access_status": snapshot.billing_access_state or "",
        "custom_blockwise_trial_state": snapshot.trial.state or "",
        "custom_blockwise_trial_started_at": _to_frappe_datetime(
            snapshot.trial.started_at
        )
        or "",
        "custom_blockwise_trial_ends_at": _to_frappe_datetime(snapshot.trial.ends_at)
        or "",
        "custom_blockwise_source_observed_at": _to_frappe_datetime(
            snapshot.source_observed_at
        )
        or "",
        "custom_blockwise_sync_state": SYNC_STATE_SYNCED,
    }


def _identity_conflict(
    existing: Sequence[MirrorRecord], *, profile_uuid: str, workspace_uuid: str
) -> bool:
    """True when a record matches exactly one id and conflicts on the other."""
    for record in existing:
        profile_match = record.profile_uuid == profile_uuid
        workspace_match = record.workspace_uuid == workspace_uuid
        if profile_match != workspace_match:
            return True
    return False


def _exact_matches(
    existing: Sequence[MirrorRecord], *, profile_uuid: str, workspace_uuid: str
) -> list[MirrorRecord]:
    return [
        record
        for record in existing
        if record.profile_uuid == profile_uuid and record.workspace_uuid == workspace_uuid
    ]


def plan_snapshot(
    snapshot: CustomerSnapshot,
    existing: Sequence[MirrorRecord],
    *,
    contact_loader: Callable[[str], MirrorRecord | None],
) -> PlannedWrite:
    """Decide the single action for one snapshot without writing anything."""
    if snapshot.is_ambiguous or snapshot.owner is None:
        return PlannedWrite(
            action="held_ambiguous",
            workspace_id=snapshot.workspace_id,
            profile_id=snapshot.owner.profile_id if snapshot.owner else None,
            contact_name=None,
            reason=",".join(snapshot.mapping_ambiguities) or "owner_missing",
        )

    profile_uuid = snapshot.owner.profile_id
    workspace_uuid = snapshot.workspace_id

    if _identity_conflict(
        existing, profile_uuid=profile_uuid, workspace_uuid=workspace_uuid
    ):
        return PlannedWrite(
            action="held_conflict",
            workspace_id=workspace_uuid,
            profile_id=profile_uuid,
            contact_name=None,
            reason="identity_id_conflict",
        )

    matches = _exact_matches(
        existing, profile_uuid=profile_uuid, workspace_uuid=workspace_uuid
    )
    if len(matches) > 1:
        return PlannedWrite(
            action="held_conflict",
            workspace_id=workspace_uuid,
            profile_id=profile_uuid,
            contact_name=None,
            reason="multiple_exact_matches",
        )

    values = build_mirror_values(snapshot)
    incoming_observed = _normalise_timestamp(snapshot.source_observed_at)

    if not matches:
        return PlannedWrite(
            action="create",
            workspace_id=workspace_uuid,
            profile_id=profile_uuid,
            contact_name=None,
            fields={**values, "email": snapshot.owner.email, "name": snapshot.owner.name},
        )

    contact = matches[0]
    # Re-read the contact so a fresh observation never overwrites a newer one
    # even if the search index was stale.
    fresh = contact_loader(contact.name)
    if fresh is None:
        raise ConnectorError("owner CRM Contact disappeared during preview")
    contact = fresh
    if _identity_conflict([contact], profile_uuid=profile_uuid, workspace_uuid=workspace_uuid):
        raise ConnectorError("owner CRM identity changed during preview")
    current_observed = _normalise_timestamp(contact.source_observed_at)
    if contact.source_observed_at and current_observed is None:
        raise ConnectorError("owner CRM observation timestamp is malformed")
    if (
        current_observed is not None
        and incoming_observed is not None
        and incoming_observed < current_observed
    ):
        return PlannedWrite(
            action="held_stale",
            workspace_id=workspace_uuid,
            profile_id=profile_uuid,
            contact_name=contact.name,
            reason="older_observation",
        )

    changed = {
        key: value
        for key, value in values.items()
        if _comparison_value(key, contact.values.get(key)) != _comparison_value(key, value)
    }
    if not changed:
        return PlannedWrite(
            action="unchanged",
            workspace_id=workspace_uuid,
            profile_id=profile_uuid,
            contact_name=contact.name,
        )
    return PlannedWrite(
        action="update",
        workspace_id=workspace_uuid,
        profile_id=profile_uuid,
        contact_name=contact.name,
        fields={**changed, "email": snapshot.owner.email, "name": snapshot.owner.name},
    )


def build_preview_report(plans: Sequence[PlannedWrite], *, pages: int) -> PreviewReport:
    counts = {
        "create": 0,
        "update": 0,
        "unchanged": 0,
        "held_ambiguous": 0,
        "held_stale": 0,
        "held_conflict": 0,
    }
    for plan in plans:
        counts[plan.action] += 1
    return PreviewReport(
        creates=counts["create"],
        updates=counts["update"],
        unchanged=counts["unchanged"],
        held_ambiguous=counts["held_ambiguous"],
        held_stale=counts["held_stale"],
        held_conflict=counts["held_conflict"],
        pages=pages,
        plans=tuple(plans),
    )


# --- Apply -------------------------------------------------------------------


@dataclass(frozen=True)
class ApplyOutcome:
    created: int
    updated: int
    unchanged: int
    held_ambiguous: int
    held_stale: int
    held_conflict: int
    failed: int

    def summary(self) -> dict[str, int]:
        return {
            "created": self.created,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "held_ambiguous": self.held_ambiguous,
            "held_stale": self.held_stale,
            "held_conflict": self.held_conflict,
            "failed": self.failed,
        }


def apply_plan(
    store: FrappeContactStore,
    snapshot: CustomerSnapshot,
    *,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Recheck identity and freshness, then create or update one contact.

    Returns the resulting outcome key. Any uncertain failure is reconciled
    against the current contact before another create is attempted, and the
    number of attempts is bounded.
    """
    if snapshot.is_ambiguous or snapshot.owner is None:
        return "held_ambiguous"

    profile_uuid = snapshot.owner.profile_id
    workspace_uuid = snapshot.workspace_id
    incoming_observed = _normalise_timestamp(snapshot.source_observed_at)

    last_error: ConnectorError | None = None
    for attempt in range(1, MAX_WRITE_ATTEMPTS + 1):
        existing = store.find_contact_by_identity(
            profile_uuid=profile_uuid, workspace_uuid=workspace_uuid
        )
        if _identity_conflict(
            existing, profile_uuid=profile_uuid, workspace_uuid=workspace_uuid
        ):
            return "held_conflict"
        matches = _exact_matches(
            existing, profile_uuid=profile_uuid, workspace_uuid=workspace_uuid
        )
        if len(matches) > 1:
            return "held_conflict"

        if matches:
            contact = store.get_contact(matches[0].name)
            if contact is None:
                continue
            if _identity_conflict([contact], profile_uuid=profile_uuid, workspace_uuid=workspace_uuid):
                return "held_conflict"
            current_observed = _normalise_timestamp(contact.source_observed_at)
            if contact.source_observed_at and current_observed is None:
                raise ConnectorError("owner CRM observation timestamp is malformed")
            if (
                current_observed is not None
                and incoming_observed is not None
                and incoming_observed < current_observed
            ):
                return "held_stale"
            values = build_mirror_values(snapshot)
            changed = {
                key: value
                for key, value in values.items()
                if _comparison_value(key, contact.values.get(key)) != _comparison_value(key, value)
            }
            if not changed:
                return "unchanged"
            modified = contact.values.get("modified")
            if not modified:
                raise ConnectorError("owner CRM did not supply a concurrency token")
            values["modified"] = modified
            values["custom_blockwise_last_synced_at"] = _now_datetime()
            try:
                store.update_contact(contact.name, values)
                confirmed = store.get_contact(contact.name)
                if confirmed is None or any(
                    _comparison_value(k, confirmed.values.get(k)) != _comparison_value(k, v)
                    for k, v in values.items() if k != "modified"
                ) or _normalise_timestamp(
                    confirmed.values.get("custom_blockwise_last_synced_at")
                ) != _normalise_timestamp(values["custom_blockwise_last_synced_at"]):
                    raise ConnectorError("owner CRM did not confirm the update")
                return "update"
            except ConnectorError as exc:
                last_error = exc
                if attempt < MAX_WRITE_ATTEMPTS:
                    sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue

        # No exact match: create, then reconcile if the write is uncertain.
        payload = _contact_create_payload(snapshot)
        try:
            created_name = store.create_contact(payload)
            confirmed = store.get_contact(created_name)
            if confirmed is None or any(
                _comparison_value(k, confirmed.values.get(k)) != _comparison_value(k, v)
                for k, v in build_mirror_values(snapshot).items()
            ):
                raise ConnectorError("owner CRM did not confirm the create")
            return "create"
        except ConnectorError as exc:
            last_error = exc
            # A timeout after a successful write must not create a duplicate.
            # Reconcile against the current contact before retrying.
            if attempt < MAX_WRITE_ATTEMPTS:
                sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue

    if last_error is not None:
        raise last_error
    raise ConnectorError("owner CRM sync failed without a reported error")


def _contact_create_payload(snapshot: CustomerSnapshot) -> dict[str, Any]:
    assert snapshot.owner is not None
    first, last = _split_name(snapshot.owner.name)
    values = build_mirror_values(snapshot)
    values["custom_blockwise_last_synced_at"] = _now_datetime()
    return {
        "doctype": "Contact",
        "first_name": first or snapshot.owner.email.split("@")[0],
        "last_name": last,
        "email_ids": [{"email_id": snapshot.owner.email, "is_primary": 1}],
        **values,
    }


def _now_datetime() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())


# --- Orchestration -----------------------------------------------------------


@dataclass(frozen=True)
class RunResult:
    mode: str
    preview: PreviewReport | None = None
    applied: ApplyOutcome | None = None


def run(
    *,
    snapshot_client: BlockwiseSnapshotClient,
    store: FrappeContactStore,
    apply: bool,
    page_limit: int = SNAPSHOT_PAGE_LIMIT_DEFAULT,
    verify_fields: bool = True,
) -> RunResult:
    """Run one bounded preview or apply pass."""
    if verify_fields:
        for fieldname in MIRROR_FIELDS:
            if not store.custom_field_exists("Contact", fieldname):
                raise ConnectorError(
                    f"owner CRM is missing a required mirror field: {fieldname}"
                )

    if not 1 <= page_limit <= SNAPSHOT_PAGE_LIMIT_MAX:
        raise ConnectorError("snapshot page limit is out of range")
    snapshots: list[CustomerSnapshot] = []
    pages = 0
    after: str | None = None
    # Collect in bounded pages so a mid-pagination failure aborts before writes.
    while True:
        page = snapshot_client.fetch_page(after_workspace_id=after, limit=page_limit)
        pages += 1
        if pages > MAX_SOURCE_PAGES:
            raise ConnectorError("owner CRM snapshot exceeded total page bound")
        items = page.get("items")
        if not isinstance(items, list) or len(items) > page_limit:
            raise ConnectorError("owner CRM snapshot page was malformed")
        mapped = [map_snapshot_row(item) for item in items]
        previous = after
        for item in mapped:
            if previous is not None and item.workspace_id.lower() <= previous.lower():
                raise ConnectorError("owner CRM snapshot identities did not advance")
            previous = item.workspace_id
        snapshots.extend(mapped)
        next_after = page.get("nextAfterWorkspaceId")
        if next_after is None:
            break
        if not isinstance(next_after, str) or not _UUID.fullmatch(next_after):
            raise ConnectorError("owner CRM snapshot returned an invalid cursor")
        if not mapped or next_after != mapped[-1].workspace_id or (after and next_after <= after):
            raise ConnectorError("owner CRM snapshot cursor did not advance consistently")
        after = next_after

    plans: list[PlannedWrite] = []
    for snapshot in snapshots:
        if snapshot.is_ambiguous or snapshot.owner is None:
            plans.append(
                PlannedWrite(
                    action="held_ambiguous",
                    workspace_id=snapshot.workspace_id,
                    profile_id=snapshot.owner.profile_id if snapshot.owner else None,
                    contact_name=None,
                    reason=",".join(snapshot.mapping_ambiguities) or "owner_missing",
                )
            )
            continue
        existing = store.find_contact_by_identity(
            profile_uuid=snapshot.owner.profile_id,
            workspace_uuid=snapshot.workspace_id,
        )
        plans.append(
            plan_snapshot(snapshot, existing, contact_loader=store.get_contact)
        )

    preview = build_preview_report(plans, pages=pages)
    if not apply:
        return RunResult(mode="preview", preview=preview)

    counters = {
        "create": 0,
        "update": 0,
        "unchanged": 0,
        "held_ambiguous": 0,
        "held_stale": 0,
        "held_conflict": 0,
        "failed": 0,
    }
    for snapshot in snapshots:
        try:
            outcome = apply_plan(store, snapshot)
        except ConnectorError:
            outcome = "failed"
        counters[outcome] += 1
        if hasattr(store, "reconcile_hold"):
            try:
                store.reconcile_hold(snapshot.workspace_id, outcome)
            except ConnectorError:
                counters["failed"] += 1

    return RunResult(
        mode="apply",
        applied=ApplyOutcome(
            created=counters["create"],
            updated=counters["update"],
            unchanged=counters["unchanged"],
            held_ambiguous=counters["held_ambiguous"],
            held_stale=counters["held_stale"],
            held_conflict=counters["held_conflict"],
            failed=counters["failed"],
        ),
    )


# --- CLI ---------------------------------------------------------------------


def _cli() -> int:
    parser = argparse.ArgumentParser(
        description="Sync Blockwise customer facts into the owner CRM mirror"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the mirror; the default is a read-only preview",
    )
    parser.add_argument(
        "--limit", type=int, default=SNAPSHOT_PAGE_LIMIT_DEFAULT,
        help="bounded source page size (1-100)",
    )
    parser.add_argument(
        "--secret-file", type=Path, default=DEFAULT_SECRET_FILE,
        help="approved external secret file",
    )
    parser.add_argument(
        "--report", type=Path, default=None,
        help="private detailed report path (preview only)",
    )
    args = parser.parse_args()

    try:
        credentials = load_sync_credentials(args.secret_file)
    except ConnectorError as exc:
        print(f"owner CRM sync failed: {exc}", file=sys.stderr)
        return 1

    snapshot_client = BlockwiseSnapshotClient(
        base_url=credentials.blockwise_snapshot_url,
        signing_secret=credentials.blockwise_signing_secret,
        scope=credentials.blockwise_scope,
    )
    store = FrappeContactStore()
    try:
        store.authenticate(credentials.frappe_api_key, credentials.frappe_api_secret)
        result = run(
            snapshot_client=snapshot_client,
            store=store,
            apply=args.apply,
            page_limit=args.limit,
        )
    except ConnectorError as exc:
        print(f"owner CRM sync failed: {exc}", file=sys.stderr)
        return 1
    finally:
        store.close()

    payload: dict[str, Any] = {
        "mode": result.mode,
        "credentials": credentials.redacted(),
    }
    if result.preview is not None:
        payload["summary"] = result.preview.summary()
    if result.applied is not None:
        payload["summary"] = result.applied.summary()
    print(json.dumps(payload, separators=(",", ":")))

    if args.report is not None and result.preview is not None:
        # The detailed review report stays private, root-owned and 0600.
        if args.apply:
            print("ignoring --report in apply mode", file=sys.stderr)
        else:
            detail = [
                {
                    "action": plan.action,
                    "workspace_id": plan.workspace_id,
                    "profile_id": plan.profile_id,
                    "contact_name": plan.contact_name,
                    "reason": plan.reason,
                }
                for plan in result.preview.plans
            ]
            args.report.write_text(
                json.dumps({"plans": detail}, indent=2) + "\n", encoding="utf-8"
            )
            os.chmod(args.report, 0o600)
    return 1 if result.applied and result.applied.failed else 0


if __name__ == "__main__":
    raise SystemExit(_cli())
