#!/usr/bin/env python3
"""Paused Hermes bridge from protected consent facts to native Mautic only."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import stat
from typing import Any, Mapping, Protocol

if not (Path(__file__).resolve().parent / "customer_sync.py").exists():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "owner_crm_sync"))

from customer_sync import (
    BlockwiseSnapshotClient,
    ConnectorError,
    MAX_SOURCE_PAGES,
    SNAPSHOT_PAGE_LIMIT_DEFAULT,
    SNAPSHOT_PAGE_LIMIT_MAX,
    _UUID,
    load_sync_credentials,
    map_snapshot_row,
)
from mautic_flows import ApiError, Mautic, bridge, suppress

MAUTIC_URL = "http://127.0.0.1:18106"
DEFAULT_SECRET_FILE = Path("/srv/hermes/secrets/owner-email-flows.env")
FLOW = "opted_in_education"


class AdapterError(RuntimeError):
    """Safe aggregate failure. Never include source records or credentials."""


@dataclass(frozen=True)
class MarketingCredentials:
    username: str
    password: str


@dataclass(frozen=True)
class ConsentFact:
    profile_id: str
    workspace_id: str
    email: str
    email_verified_at: str | None
    granted: bool | None
    occurred_at: str | None
    policy_version: str | None
    event_id: str | None

    @property
    def state(self) -> str:
        if self.granted is None:
            return "ungranted"
        if self.event_id is None:
            return "held_missing_event_id"
        if self.granted and (self.email_verified_at is None or not self.policy_version):
            return "held_ineligible"
        return "granted" if self.granted else "revoked"


def _timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _optional_text(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 255:
        raise AdapterError(f"snapshot {label} was malformed")
    return value


def map_consent_fact(row: Mapping[str, Any]) -> ConsentFact | None:
    """Map only the committed latest-event snapshot contract."""
    common = map_snapshot_row(row)
    if common.is_ambiguous or common.owner is None:
        return None
    verified = _optional_text(row.get("ownerEmailVerifiedAt"), "owner email verification")
    if verified is not None and _timestamp(verified) is None:
        raise AdapterError("snapshot owner email verification was invalid")
    raw = row.get("marketingConsent")
    granted: bool | None = None
    occurred: str | None = None
    policy: str | None = None
    event_id: str | None = None
    if raw is not None:
        if not isinstance(raw, Mapping):
            raise AdapterError("snapshot marketing consent was malformed")
        granted_value = raw.get("granted")
        if not isinstance(granted_value, bool):
            raise AdapterError("snapshot marketing consent grant was malformed")
        granted = granted_value
        occurred = _optional_text(raw.get("occurredAt"), "consent timestamp")
        policy = _optional_text(raw.get("policyVersion"), "policy version")
        event_id = _optional_text(raw.get("eventId"), "event id")
        if occurred is None or _timestamp(occurred) is None:
            raise AdapterError("snapshot consent timestamp was invalid")
        if not policy:
            raise AdapterError("snapshot consent policy version was missing")
        if event_id is None or not _UUID.fullmatch(event_id):
            raise AdapterError("snapshot consent event id was invalid")
    fact = ConsentFact(
        profile_id=common.owner.profile_id,
        workspace_id=common.workspace_id,
        email=common.owner.email,
        email_verified_at=verified,
        granted=granted,
        occurred_at=occurred,
        policy_version=policy,
        event_id=event_id,
    )
    return fact


def _parse_secret(path: Path) -> dict[str, str]:
    try:
        info = path.lstat()
    except OSError as exc:
        raise AdapterError("owner email flow secret file is unavailable") from exc
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
        raise AdapterError("owner email flow secret file has unsafe permissions")
    if info.st_uid not in {0, os.geteuid()}:
        raise AdapterError("owner email flow secret file has unexpected ownership")
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise AdapterError("owner email flow secret file is unreadable") from exc
    for line in lines:
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        key, separator, secret = value.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise AdapterError("owner email flow secret file has invalid syntax")
        values[key] = secret
    return values


def load_marketing_credentials(path: Path = DEFAULT_SECRET_FILE) -> MarketingCredentials:
    values = _parse_secret(path)
    username = values.get("OWNER_EMAIL_FLOWS_MAUTIC_USERNAME", "")
    password = values.get("OWNER_EMAIL_FLOWS_MAUTIC_PASSWORD", "")
    if not username or not password or any(char in username + password for char in "\r\n"):
        raise AdapterError("owner email flow Mautic credential is missing")
    return MarketingCredentials(username=username, password=password)


class SnapshotClient(Protocol):
    def fetch_page(self, *, after_workspace_id: str | None, limit: int) -> dict[str, Any]: ...


def collect_facts(source: SnapshotClient, *, page_limit: int = SNAPSHOT_PAGE_LIMIT_DEFAULT) -> list[ConsentFact]:
    if not 1 <= page_limit <= SNAPSHOT_PAGE_LIMIT_MAX:
        raise AdapterError("snapshot page limit is out of range")
    facts: list[ConsentFact] = []
    after: str | None = None
    pages = 0
    while True:
        page = source.fetch_page(after_workspace_id=after, limit=page_limit)
        pages += 1
        if pages > MAX_SOURCE_PAGES:
            raise AdapterError("snapshot exceeded its page bound")
        rows = page.get("items")
        if not isinstance(rows, list) or len(rows) > page_limit:
            raise AdapterError("snapshot page was malformed")
        previous = after
        for row in rows:
            fact = map_consent_fact(row)
            workspace = row.get("workspaceId") if isinstance(row, Mapping) else None
            if not isinstance(workspace, str) or not _UUID.fullmatch(workspace):
                raise AdapterError("snapshot workspace id was malformed")
            if previous is not None and workspace.lower() <= previous.lower():
                raise AdapterError("snapshot identities did not advance")
            previous = workspace
            if fact is not None:
                facts.append(fact)
        next_after = page.get("nextAfterWorkspaceId")
        if next_after is None:
            return facts
        if not isinstance(next_after, str) or not _UUID.fullmatch(next_after) or not rows or next_after != previous:
            raise AdapterError("snapshot cursor did not advance consistently")
        after = next_after


def apply_fact(api: Mautic, fact: ConsentFact, *, apply: bool) -> str:
    state = fact.state
    if state == "ungranted":
        return state
    if state.startswith("held_"):
        return state
    if fact.event_id is None:
        return "held_missing_event_id"
    namespace = argparse.Namespace(
        flow=FLOW,
        source_event_id=fact.event_id,
        profile_id=fact.profile_id,
        workspace_id=fact.workspace_id,
        email=fact.email,
        consent_state="opted_in" if state == "granted" else "opted_out",
        apply=apply,
    )
    if state == "granted":
        bridge(api, namespace)
        return "enrolled"
    suppress(api, namespace)
    return "suppressed"


def run(*, source: SnapshotClient, api: Mautic | None, apply: bool) -> dict[str, int]:
    facts = collect_facts(source)
    summary = {key: 0 for key in ("enrolled", "suppressed", "ungranted", "held_missing_event_id", "held_ambiguous_consent", "held_ineligible", "failed")}
    for fact in facts:
        try:
            outcome = apply_fact(api, fact, apply=apply) if api is not None else fact.state
        except (ApiError, AdapterError):
            outcome = "failed"
        summary[outcome] = summary.get(outcome, 0) + 1
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preview", "run"))
    args = parser.parse_args()
    try:
        snapshot = load_sync_credentials()
        source = BlockwiseSnapshotClient(
            base_url=snapshot.blockwise_snapshot_url,
            signing_secret=snapshot.blockwise_signing_secret,
            scope=snapshot.blockwise_scope,
        )
        api = None
        if args.command == "run":
            marketing = load_marketing_credentials()
            api = Mautic(MAUTIC_URL, marketing.username, marketing.password)
        print(json.dumps(run(source=source, api=api, apply=args.command == "run"), sort_keys=True))
        return 0
    except (AdapterError, ConnectorError, ApiError):
        print(json.dumps({"failed": 1, "error": "source_or_native_marketing_unavailable"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
