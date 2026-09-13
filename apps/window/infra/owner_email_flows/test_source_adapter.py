#!/usr/bin/env python3
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("source_adapter", HERE / "source_adapter.py")
adapter = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = adapter
spec.loader.exec_module(adapter)

PROFILE_ID = "10000000-0000-4000-8000-000000000001"
WORKSPACE_ID = "20000000-0000-4000-8000-000000000001"
EVENT_ID = "30000000-0000-4000-8000-000000000001"


def row(**overrides):
    value = {
        "workspaceId": WORKSPACE_ID,
        "owner": {"profileId": PROFILE_ID, "name": "Owner", "email": "owner@example.test"},
        "billingAccessState": "trialing",
        "stripeSubscriptionStatus": "active",
        "trial": {"state": "active", "startedAt": "2026-09-01T00:00:00Z", "endsAt": "2026-09-15T00:00:00Z"},
        "mappingAmbiguities": [],
        "sourceObservedAt": "2026-09-13T00:00:00Z",
        "ownerEmailVerifiedAt": "2026-09-01T00:00:00Z",
        "marketingConsent": {"eventId": EVENT_ID, "granted": True, "occurredAt": "2026-09-13T00:00:00Z", "policyVersion": "2026-09-13"},
    }
    value.update(overrides)
    return value


class FakeSource:
    def __init__(self, rows):
        self.rows = rows
    def fetch_page(self, *, after_workspace_id, limit):
        return {"items": self.rows if after_workspace_id is None else [], "nextAfterWorkspaceId": None}


class FakeApi:
    pass


class SourceAdapterTests(unittest.TestCase):
    def test_explicit_verified_grant_maps_to_eligible_fact(self):
        fact = adapter.map_consent_fact(row())
        self.assertEqual(fact.state, "granted")
        self.assertEqual(fact.event_id, EVENT_ID)

    def test_missing_consent_is_not_inferred(self):
        fact = adapter.map_consent_fact(row(marketingConsent=None))
        self.assertEqual(fact.state, "ungranted")

    def test_unverified_grant_is_held(self):
        fact = adapter.map_consent_fact(row(ownerEmailVerifiedAt=None))
        self.assertEqual(fact.state, "held_ineligible")

    def test_latest_revoke_wins_and_does_not_require_verified_email(self):
        fact = adapter.map_consent_fact(row(ownerEmailVerifiedAt=None, marketingConsent={"eventId": EVENT_ID, "granted": False, "occurredAt": "2026-09-14T00:00:00Z", "policyVersion": "2026-09-13"}))
        self.assertEqual(fact.state, "revoked")

    def test_missing_event_id_rejects_malformed_consent(self):
        with self.assertRaisesRegex(adapter.AdapterError, "event id"):
            adapter.map_consent_fact(row(marketingConsent={"eventId": None, "granted": True, "occurredAt": "2026-09-13T00:00:00Z", "policyVersion": "2026-09-13"}))

    def test_collect_rejects_invalid_event_id_before_any_write(self):
        with self.assertRaisesRegex(adapter.AdapterError, "event id"):
            adapter.collect_facts(FakeSource([row(marketingConsent={"eventId": "not-a-uuid", "granted": True, "occurredAt": "2026-09-13T00:00:00Z", "policyVersion": "2026-09-13"})]))

    def test_preview_never_calls_the_native_bridge(self):
        summary = adapter.run(source=FakeSource([row()]), api=None, apply=False)
        self.assertEqual(summary["granted"], 1)
        self.assertFalse(any(key.startswith("enrolled_") for key in summary))

    def test_grant_uses_only_the_authoritative_consent_event(self):
        calls = []
        original = adapter.bridge
        try:
            adapter.bridge = lambda api, args: calls.append(args)
            outcome = adapter.apply_fact(FakeApi(), adapter.map_consent_fact(row(trial={"state": "active", "startedAt": "2026-09-01T00:00:00Z", "endsAt": None})), apply=True)
        finally:
            adapter.bridge = original
        self.assertEqual(outcome, "enrolled_onboarding_trial_help")
        self.assertEqual(calls[0].flow, "onboarding_trial_help")
        self.assertNotEqual(calls[0].source_event_id, EVENT_ID)
        self.assertEqual(calls[0].consent_state, "opted_in")

    def test_revoke_calls_native_suppression_not_enrolment(self):
        calls = []
        original = adapter.suppress
        try:
            adapter.suppress = lambda api, args: calls.append(args)
            fact = adapter.map_consent_fact(row(marketingConsent={"eventId": EVENT_ID, "granted": False, "occurredAt": "2026-09-14T00:00:00Z", "policyVersion": "2026-09-13"}))
            outcome = adapter.apply_fact(FakeApi(), fact, apply=True)
        finally:
            adapter.suppress = original
        self.assertEqual(outcome, "suppressed")
        self.assertEqual(calls[0].consent_state, "opted_out")

    def test_paid_requires_authoritative_checkout_completion(self):
        fact = adapter.map_consent_fact(row(billingAccessState="paid"))
        self.assertEqual(adapter.lifecycle_action(fact), "held_missing_checkout_completion")
        fact = adapter.map_consent_fact(row(billingAccessState="paid", billingCheckoutCompletedAt="2026-09-13T01:00:00Z"))
        action = adapter.lifecycle_action(fact)
        self.assertEqual(action.flow, "paid_welcome")
        self.assertRegex(action.identity, adapter._UUID.pattern)

    def test_scheduled_cancellation_never_means_cancelled(self):
        fact = adapter.map_consent_fact(row(cancelAtPeriodEnd=True, currentPeriodEnd="2026-09-20T00:00:00Z"))
        self.assertNotEqual(getattr(adapter.lifecycle_action(fact), "flow", None), "cancelled")
        fact = adapter.map_consent_fact(row(billingAccessState="canceled", billingEventCreated=42, cancelAtPeriodEnd=True))
        action = adapter.lifecycle_action(fact)
        self.assertEqual(action.flow, "cancelled")
        self.assertNotIn("42", action.identity)

    def test_active_trial_uses_help_not_an_unapproved_near_end_reminder(self):
        fact = adapter.map_consent_fact(row())
        self.assertEqual(adapter.lifecycle_action(fact).flow, "onboarding_trial_help")

    def test_trial_end_and_replay_are_stable(self):
        ended = row(trial={"state": "ended", "startedAt": "2026-09-01T00:00:00Z", "endsAt": "2026-09-15T00:00:00Z"})
        first = adapter.lifecycle_action(adapter.map_consent_fact(ended))
        second = adapter.lifecycle_action(adapter.map_consent_fact(ended))
        self.assertEqual(first.flow, "trial_ended")
        self.assertEqual(first.identity, second.identity)

    def test_invalid_new_authoritative_values_fail_closed(self):
        with self.assertRaisesRegex(adapter.AdapterError, "billing event"):
            adapter.map_consent_fact(row(billingEventCreated=True))
        with self.assertRaisesRegex(adapter.AdapterError, "checkout completion"):
            adapter.map_consent_fact(row(billingCheckoutCompletedAt="not-a-time"))

    def test_ambiguous_owner_never_becomes_a_customer_contact(self):
        self.assertIsNone(adapter.map_consent_fact(row(mappingAmbiguities=["multiple owners"])))


if __name__ == "__main__":
    unittest.main(verbosity=2)
