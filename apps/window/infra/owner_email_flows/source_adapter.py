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
import uuid
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
UUID_NAMESPACE = uuid.UUID("9c5a28af-b9c3-4d0b-b9e5-82061242d496")


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
    billing_access_state: str | None = None
    stripe_subscription_status: str | None = None
    trial_state: str | None = None
    trial_started_at: str | None = None
    trial_ends_at: str | None = None
    billing_event_created: int | None = None
    billing_checkout_completed_at: str | None = None
    cancel_at_period_end: bool | None = None
    current_period_end: str | None = None
    workspace_created_at: str | None = None

    @property
    def state(self) -> str:
        if self.granted is None:
            return "ungranted"
        if self.event_id is None:
            return "held_missing_event_id"
        if self.granted and (self.email_verified_at is None or not self.policy_version):
            return "held_ineligible"
        return "granted" if self.granted else "revoked"


@dataclass(frozen=True)
class LifecycleAction:
    flow: str
    identity: str


@dataclass(frozen=True)
class TimingPolicy:
    as_of: datetime
    trial_ending_window_days: int = 3
    winback_delay_days: int = 30
    event_freshness_days: int = 7

    def __post_init__(self) -> None:
        if self.as_of.tzinfo is None:
            raise AdapterError("timing as-of must be timezone-aware")
        for value in (self.trial_ending_window_days, self.winback_delay_days, self.event_freshness_days):
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 365:
                raise AdapterError("timing policy was out of range")


def _action_id(workspace_id: str, flow: str, immutable_value: str) -> str:
    """A local action identity, never a claimed Stripe event identifier."""
    return str(uuid.uuid5(UUID_NAMESPACE, f"{workspace_id}:{flow}:{immutable_value}"))


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


def _optional_timestamp(value: Any, label: str) -> str | None:
    parsed = _optional_text(value, label)
    if parsed is not None and _timestamp(parsed) is None:
        raise AdapterError(f"snapshot {label} was invalid")
    return parsed


def _optional_nonnegative_int(value: Any, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AdapterError(f"snapshot {label} was invalid")
    return value


def _optional_bool(value: Any, label: str) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        raise AdapterError(f"snapshot {label} was invalid")
    return value


def map_consent_fact(row: Mapping[str, Any]) -> ConsentFact | None:
    """Map only the committed latest-event snapshot contract."""
    common = map_snapshot_row(row)
    if common.is_ambiguous or common.owner is None:
        return None
    verified = _optional_timestamp(row.get("ownerEmailVerifiedAt"), "owner email verification")
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
        billing_access_state=common.billing_access_state,
        stripe_subscription_status=common.stripe_subscription_status,
        trial_state=common.trial.state,
        trial_started_at=common.trial.started_at,
        trial_ends_at=common.trial.ends_at,
        billing_event_created=_optional_nonnegative_int(row.get("billingEventCreated"), "billing event high-water"),
        billing_checkout_completed_at=_optional_timestamp(row.get("billingCheckoutCompletedAt"), "billing checkout completion"),
        cancel_at_period_end=_optional_bool(row.get("cancelAtPeriodEnd"), "cancel at period end"),
        current_period_end=_optional_timestamp(row.get("currentPeriodEnd"), "current period end"),
        workspace_created_at=_optional_timestamp(row.get("workspaceCreatedAt"), "workspace creation"),
    )
    return fact


def _event_window(event: str, policy: TimingPolicy) -> str | None:
    timestamp = _timestamp(event)
    assert timestamp is not None
    age = policy.as_of - timestamp
    if age.total_seconds() < 0:
        return "held_future_event"
    if age.days > policy.event_freshness_days:
        return "held_stale_event"
    return None


def _winback_window(event: str, policy: TimingPolicy) -> str | None:
    timestamp = _timestamp(event)
    assert timestamp is not None
    age = policy.as_of - timestamp
    if age.total_seconds() < 0:
        return "held_future_event"
    if age.days < policy.winback_delay_days:
        return None
    if age.days > policy.winback_delay_days + policy.event_freshness_days:
        return "held_stale_winback"
    return "eligible"


def lifecycle_action(fact: ConsentFact, policy: TimingPolicy | None = None) -> LifecycleAction | str | None:
    """Select one current lifecycle path from raw authoritative facts."""
    policy = policy or TimingPolicy(datetime.now(timezone.utc))
    if fact.state != "granted":
        return None
    if fact.billing_access_state == "paid":
        if fact.billing_checkout_completed_at is None:
            return "held_missing_checkout_completion"
        held = _event_window(fact.billing_checkout_completed_at, policy)
        if held:
            return held
        return LifecycleAction("paid_welcome", _action_id(fact.workspace_id, "paid_welcome", fact.billing_checkout_completed_at))
    if fact.billing_access_state == "canceled":
        if fact.billing_event_created is None:
            return "held_missing_billing_event"
        if fact.current_period_end is None:
            return "held_missing_cancellation_time"
        winback = _winback_window(fact.current_period_end, policy)
        if winback == "eligible":
            return LifecycleAction("winback", _action_id(fact.workspace_id, "winback", fact.current_period_end))
        if winback:
            return winback
        held = _event_window(fact.current_period_end, policy)
        if held:
            return held
        return LifecycleAction("cancelled", _action_id(fact.workspace_id, "cancelled", str(fact.billing_event_created)))
    if fact.trial_state == "ended":
        if fact.trial_ends_at is None:
            return "held_missing_trial_end"
        winback = _winback_window(fact.trial_ends_at, policy)
        if winback == "eligible":
            return LifecycleAction("winback", _action_id(fact.workspace_id, "winback", fact.trial_ends_at))
        if winback:
            return winback
        held = _event_window(fact.trial_ends_at, policy)
        if held:
            return held
        return LifecycleAction("trial_ended", _action_id(fact.workspace_id, "trial_ended", fact.trial_ends_at))
    if fact.trial_state == "active":
        if fact.trial_ends_at is not None:
            until_end = _timestamp(fact.trial_ends_at) - policy.as_of
            if 0 <= until_end.total_seconds() <= policy.trial_ending_window_days * 86400:
                return LifecycleAction("trial_ending", _action_id(fact.workspace_id, "trial_ending", fact.trial_ends_at))
        if fact.trial_started_at is None:
            return "held_missing_trial_start"
        held = _event_window(fact.trial_started_at, policy)
        if held:
            return held
        return LifecycleAction("onboarding_trial_help", _action_id(fact.workspace_id, "onboarding_trial_help", fact.trial_started_at))
    if fact.workspace_created_at is not None:
        held = _event_window(fact.workspace_created_at, policy)
        if held:
            return held
        return LifecycleAction("onboarding_trial_help", _action_id(fact.workspace_id, "onboarding_trial_help", fact.workspace_created_at))
    return "held_no_current_lifecycle"


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


def apply_fact(api: Mautic, fact: ConsentFact, *, apply: bool, timing: TimingPolicy | None = None) -> str:
    state = fact.state
    if state == "ungranted":
        return state
    if state.startswith("held_"):
        return state
    if fact.event_id is None:
        return "held_missing_event_id"
    action = lifecycle_action(fact, timing)
    if isinstance(action, str):
        return action
    flow = action.flow if action is not None else FLOW
    source_event_id = action.identity if action is not None else fact.event_id
    namespace = argparse.Namespace(
        flow=flow,
        source_event_id=source_event_id,
        profile_id=fact.profile_id,
        workspace_id=fact.workspace_id,
        email=fact.email,
        consent_state="opted_in" if state == "granted" else "opted_out",
        apply=apply,
    )
    if state == "granted":
        bridge(api, namespace)
        return "enrolled_" + flow
    suppress(api, namespace)
    return "suppressed"


def run(*, source: SnapshotClient, api: Mautic | None, apply: bool, timing: TimingPolicy | None = None) -> dict[str, int]:
    facts = collect_facts(source)
    summary = {key: 0 for key in ("suppressed", "ungranted", "held_missing_event_id", "held_ambiguous_consent", "held_ineligible", "held_missing_checkout_completion", "held_missing_billing_event", "held_missing_cancellation_time", "held_missing_trial_end", "held_missing_trial_start", "held_future_event", "held_stale_event", "held_stale_winback", "held_no_current_lifecycle", "failed")}
    for fact in facts:
        try:
            if api is None:
                action = lifecycle_action(fact, timing)
                outcome = action if isinstance(action, str) else ("eligible_" + action.flow if action else fact.state)
            else:
                outcome = apply_fact(api, fact, apply=apply, timing=timing)
        except (ApiError, AdapterError):
            outcome = "failed"
        summary[outcome] = summary.get(outcome, 0) + 1
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preview", "run"))
    parser.add_argument("--as-of", default=os.environ.get("OWNER_EMAIL_FLOWS_AS_OF"))
    parser.add_argument("--trial-ending-window-days", type=int, default=int(os.environ.get("OWNER_EMAIL_FLOWS_TRIAL_ENDING_WINDOW_DAYS", "3")))
    parser.add_argument("--winback-delay-days", type=int, default=int(os.environ.get("OWNER_EMAIL_FLOWS_WINBACK_DELAY_DAYS", "30")))
    parser.add_argument("--event-freshness-days", type=int, default=int(os.environ.get("OWNER_EMAIL_FLOWS_EVENT_FRESHNESS_DAYS", "7")))
    args = parser.parse_args()
    try:
        as_of = _timestamp(args.as_of) if args.as_of else datetime.now(timezone.utc)
        if as_of is None:
            raise AdapterError("timing as-of was invalid")
        timing = TimingPolicy(as_of, args.trial_ending_window_days, args.winback_delay_days, args.event_freshness_days)
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
        print(json.dumps(run(source=source, api=api, apply=args.command == "run", timing=timing), sort_keys=True))
        return 0
    except (AdapterError, ConnectorError, ApiError):
        print(json.dumps({"failed": 1, "error": "source_or_native_marketing_unavailable"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
