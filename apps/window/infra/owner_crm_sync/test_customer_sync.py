"""Tests for the narrow owner CRM customer-sync connector.

These exercise the safety properties the brief requires: identity matching on
both immutable ids, held conflicts, held ambiguity, freshness ordering, bounded
retry, reconciliation after an uncertain create, and that preview writes nothing.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


sync = load_module("customer_sync", "customer_sync.py")


def snapshot_row(**overrides):
    row = {
        "workspaceId": "20000000-0000-4000-8000-000000000001",
        "owner": {
            "profileId": "10000000-0000-4000-8000-000000000001",
            "name": "Sole Owner",
            "email": "sole-owner@example.test",
        },
        "billingAccessState": "trialing",
        "stripeSubscriptionStatus": "active",
        "trial": {
            "state": "active",
            "startedAt": "2026-09-01T00:00:00Z",
            "endsAt": "2026-09-15T00:00:00Z",
        },
        "mappingAmbiguities": [],
        "sourceObservedAt": "2026-09-13T00:00:00Z",
    }
    row.update(overrides)
    return row


class FakeStore:
    """In-memory native Frappe stand-in with bounded identity search."""

    def __init__(self, contacts=None, fail_create=False, fail_after_create=False):
        self.contacts = dict(contacts or {})
        self.created = []
        self.updated = []
        self.emails = []
        self.fail_create = fail_create
        self.fail_after_create = fail_after_create
        self._seq = 0

    def _next_name(self):
        self._seq += 1
        return f"CONTACT-{self._seq:04d}"

    def custom_field_exists(self, dt, fieldname):
        return dt == "Contact" and fieldname in sync.MIRROR_FIELDS

    def find_contact_by_identity(self, *, profile_uuid, workspace_uuid):
        result = []
        for record in self.contacts.values():
            if record.profile_uuid == profile_uuid or record.workspace_uuid == workspace_uuid:
                result.append(record)
        return result

    def get_contact(self, name):
        return self.contacts.get(name)

    def create_contact(self, payload):
        if self.fail_create:
            self.fail_create = False
            raise sync.ConnectorError("owner CRM request failed (504)")
        name = self._next_name()
        record = sync.MirrorRecord(
            name=name,
            profile_uuid=payload.get(sync.PROFILE_FIELD),
            workspace_uuid=payload.get(sync.WORKSPACE_FIELD),
            source_observed_at=payload.get("custom_blockwise_source_observed_at"),
            values={**payload, "modified": "2026-09-13 00:00:00.000001"},
        )
        self.contacts[name] = record
        self.created.append(name)
        if self.fail_after_create:
            # The write succeeded but the response was lost.
            self.fail_after_create = False
            raise sync.ConnectorError("owner CRM request failed (504)")
        return name

    def update_contact(self, name, payload):
        record = self.contacts[name]
        record.values.update(payload)
        if sync.PROFILE_FIELD in payload:
            record.profile_uuid = payload[sync.PROFILE_FIELD]
        if sync.WORKSPACE_FIELD in payload:
            record.workspace_uuid = payload[sync.WORKSPACE_FIELD]
        if "custom_blockwise_source_observed_at" in payload:
            record.source_observed_at = payload["custom_blockwise_source_observed_at"]
        self.updated.append((name, dict(payload)))

    def set_primary_email(self, contact_name, email):
        self.emails.append((contact_name, email))


class SnapshotMappingTests(unittest.TestCase):
    def test_maps_a_complete_row(self):
        snapshot = sync.map_snapshot_row(snapshot_row())
        self.assertFalse(snapshot.is_ambiguous)
        self.assertEqual(snapshot.workspace_id, "20000000-0000-4000-8000-000000000001")
        self.assertEqual(snapshot.owner.profile_id, "10000000-0000-4000-8000-000000000001")
        self.assertEqual(snapshot.trial.ends_at, "2026-09-15T00:00:00Z")

    def test_ambiguous_owner_is_marked(self):
        row = snapshot_row(owner=None, mappingAmbiguities=["owner_multiple_memberships"])
        snapshot = sync.map_snapshot_row(row)
        self.assertTrue(snapshot.is_ambiguous)
        self.assertIsNone(snapshot.owner)

    def test_rejects_a_row_without_observation_time(self):
        with self.assertRaisesRegex(sync.ConnectorError, "observation"):
            sync.map_snapshot_row(snapshot_row(sourceObservedAt=None))

    def test_rejects_a_non_uuid_workspace(self):
        with self.assertRaisesRegex(sync.ConnectorError, "workspace id"):
            sync.map_snapshot_row(snapshot_row(workspaceId="not-a-uuid"))


class PlanningTests(unittest.TestCase):
    def _snapshot(self, **overrides):
        return sync.map_snapshot_row(snapshot_row(**overrides))

    def test_new_identity_plans_a_create(self):
        plan = sync.plan_snapshot(
            self._snapshot(), [], contact_loader=lambda name: None
        )
        self.assertEqual(plan.action, "create")

    def test_ambiguous_snapshot_is_held_not_created(self):
        plan = sync.plan_snapshot(
            self._snapshot(owner=None, mappingAmbiguities=["owner_missing"]),
            [],
            contact_loader=lambda name: None,
        )
        self.assertEqual(plan.action, "held_ambiguous")
        self.assertIn("owner_missing", plan.reason)

    def test_one_matching_and_one_conflicting_id_is_held(self):
        existing = [
            sync.MirrorRecord(
                name="CONTACT-0001",
                profile_uuid="10000000-0000-4000-8000-000000000001",
                workspace_uuid="99999999-0000-4000-8000-000000000009",
                source_observed_at=None,
                values={},
            )
        ]
        plan = sync.plan_snapshot(
            self._snapshot(), existing, contact_loader=lambda name: existing[0]
        )
        self.assertEqual(plan.action, "held_conflict")
        self.assertEqual(plan.reason, "identity_id_conflict")

    def test_identical_values_plan_unchanged(self):
        record = sync.MirrorRecord(
            name="CONTACT-0001",
            profile_uuid="10000000-0000-4000-8000-000000000001",
            workspace_uuid="20000000-0000-4000-8000-000000000001",
            source_observed_at="2026-09-13 00:00:00",
            values={
                sync.PROFILE_FIELD: "10000000-0000-4000-8000-000000000001",
                sync.WORKSPACE_FIELD: "20000000-0000-4000-8000-000000000001",
                "custom_blockwise_subscription_status": "active",
                "custom_blockwise_access_status": "trialing",
                "custom_blockwise_trial_state": "active",
                "custom_blockwise_trial_started_at": "2026-09-01 00:00:00",
                "custom_blockwise_trial_ends_at": "2026-09-15 00:00:00",
                "custom_blockwise_source_observed_at": "2026-09-13 00:00:00",
                "custom_blockwise_sync_state": "synced",
            },
        )
        plan = sync.plan_snapshot(
            self._snapshot(), [record], contact_loader=lambda name: record
        )
        self.assertEqual(plan.action, "unchanged")

    def test_older_observation_is_held_stale(self):
        record = sync.MirrorRecord(
            name="CONTACT-0001",
            profile_uuid="10000000-0000-4000-8000-000000000001",
            workspace_uuid="20000000-0000-4000-8000-000000000001",
            source_observed_at="2026-09-14 00:00:00",
            values={"custom_blockwise_subscription_status": "active"},
        )
        plan = sync.plan_snapshot(
            self._snapshot(), [record], contact_loader=lambda name: record
        )
        self.assertEqual(plan.action, "held_stale")

    def test_a_matching_email_alone_never_merges(self):
        # A contact with the same email but no matching ids is not this identity.
        other = sync.MirrorRecord(
            name="CONTACT-0001",
            profile_uuid=None,
            workspace_uuid=None,
            source_observed_at=None,
            values={"email_id": "sole-owner@example.test"},
        )
        plan = sync.plan_snapshot(
            self._snapshot(), [other], contact_loader=lambda name: other
        )
        self.assertEqual(plan.action, "create")


class ApplyTests(unittest.TestCase):
    def _snapshot(self, **overrides):
        return sync.map_snapshot_row(snapshot_row(**overrides))

    def test_apply_creates_and_reads_back(self):
        store = FakeStore()
        outcome = sync.apply_plan(store, self._snapshot())
        self.assertEqual(outcome, "create")
        self.assertEqual(len(store.created), 1)
        record = store.contacts[store.created[0]]
        # Read-back must show the mirror values and a sync timestamp.
        self.assertEqual(
            record.values[sync.PROFILE_FIELD],
            "10000000-0000-4000-8000-000000000001",
        )
        self.assertTrue(record.values["custom_blockwise_last_synced_at"])

    def test_uncertain_create_is_reconciled_not_duplicated(self):
        store = FakeStore(fail_after_create=True)
        outcome = sync.apply_plan(store, self._snapshot(), sleep=lambda _s: None)
        self.assertIn(outcome, {"create", "unchanged"})
        # Exactly one contact exists despite the reported failure.
        self.assertEqual(len(store.contacts), 1)
        self.assertEqual(len(store.created), 1)

    def test_bounded_retry_when_writes_keep_failing(self):
        store = FakeStore()
        original = store.create_contact

        def always_fail(payload):
            raise sync.ConnectorError("owner CRM request failed (504)")

        store.create_contact = always_fail
        with self.assertRaises(sync.ConnectorError):
            sync.apply_plan(store, self._snapshot(), sleep=lambda _s: None)
        store.create_contact = original

    def test_out_of_order_apply_is_held(self):
        existing = sync.MirrorRecord(
            name="CONTACT-0001",
            profile_uuid="10000000-0000-4000-8000-000000000001",
            workspace_uuid="20000000-0000-4000-8000-000000000001",
            source_observed_at="2026-09-14 00:00:00",
            values={
                sync.PROFILE_FIELD: "10000000-0000-4000-8000-000000000001",
                sync.WORKSPACE_FIELD: "20000000-0000-4000-8000-000000000001",
                "custom_blockwise_source_observed_at": "2026-09-14 00:00:00",
            },
        )
        store = FakeStore(contacts={existing.name: existing})
        outcome = sync.apply_plan(store, self._snapshot(), sleep=lambda _s: None)
        self.assertEqual(outcome, "held_stale")
        self.assertEqual(store.updated, [])


class PreviewTests(unittest.TestCase):
    def _snapshot(self, **overrides):
        return sync.map_snapshot_row(snapshot_row(**overrides))

    def test_preview_writes_nothing(self):
        store = FakeStore()
        client = _SinglePageClient([self._snapshot()])
        result = sync.run(snapshot_client=client, store=store, apply=False)
        self.assertEqual(result.mode, "preview")
        self.assertEqual(store.created, [])
        self.assertEqual(store.updated, [])
        self.assertEqual(result.preview.creates, 1)

    def test_counts_are_reported_per_category(self):
        snapshots = [
            self._snapshot(),
            self._snapshot(
                workspaceId="20000000-0000-4000-8000-000000000002",
                owner=None,
                mappingAmbiguities=["owner_multiple_memberships"],
            ),
        ]
        store = FakeStore()
        client = _SinglePageClient(snapshots)
        result = sync.run(snapshot_client=client, store=store, apply=False)
        self.assertEqual(result.preview.creates, 1)
        self.assertEqual(result.preview.held_ambiguous, 1)

    def test_missing_mirror_field_fails_before_reading(self):
        class BareStore(FakeStore):
            def custom_field_exists(self, dt, fieldname):
                return False

        client = _SinglePageClient([])
        with self.assertRaisesRegex(sync.ConnectorError, "missing a required mirror field"):
            sync.run(snapshot_client=client, store=BareStore(), apply=False)

    def test_mid_pagination_failure_aborts_before_writes(self):
        class FailingClient(_SinglePageClient):
            def fetch_page(self, *, after_workspace_id, limit):
                if after_workspace_id is None:
                    return {
                        "items": [snapshot_row()],
                        "nextAfterWorkspaceId": "20000000-0000-4000-8000-000000000002",
                    }
                raise sync.ConnectorError("owner CRM snapshot endpoint is unavailable")

        store = FakeStore()
        with self.assertRaises(sync.ConnectorError):
            sync.run(snapshot_client=FailingClient([]), store=store, apply=True)
        self.assertEqual(store.created, [])


class _SinglePageClient:
    def __init__(self, snapshots):
        self._rows = [_snapshot_to_row(s) for s in snapshots]

    def fetch_page(self, *, after_workspace_id, limit):
        if after_workspace_id is not None:
            return {"items": [], "nextAfterWorkspaceId": None}
        return {"items": self._rows, "nextAfterWorkspaceId": None}


def _snapshot_to_row(snapshot):
    return {
        "workspaceId": snapshot.workspace_id,
        "owner": None
        if snapshot.owner is None
        else {
            "profileId": snapshot.owner.profile_id,
            "name": snapshot.owner.name,
            "email": snapshot.owner.email,
        },
        "billingAccessState": snapshot.billing_access_state,
        "stripeSubscriptionStatus": snapshot.stripe_subscription_status,
        "trial": {
            "state": snapshot.trial.state,
            "startedAt": snapshot.trial.started_at,
            "endsAt": snapshot.trial.ends_at,
        },
        "mappingAmbiguities": list(snapshot.mapping_ambiguities),
        "sourceObservedAt": snapshot.source_observed_at,
    }


class SignatureTests(unittest.TestCase):
    def test_signature_uses_the_scope_bound_payload(self):
        client = sync.BlockwiseSnapshotClient(
            base_url="https://blockwise.sale",
            signing_secret="x" * 40,
            scope="owner-crm.customer-snapshot",
            now=lambda: 1_700_000_000,
            nonce_factory=lambda: "fixed-nonce",
        )
        headers = client._sign("GET", "/api/internal/ops/owner-crm-snapshot?limit=1", "")
        self.assertEqual(headers["x-blockwise-scope"], "owner-crm.customer-snapshot")
        # The signature must depend on the scope.
        other = sync.BlockwiseSnapshotClient(
            base_url="https://blockwise.sale",
            signing_secret="x" * 40,
            scope="some.other.scope",
            now=lambda: 1_700_000_000,
            nonce_factory=lambda: "fixed-nonce",
        )
        other_headers = other._sign(
            "GET", "/api/internal/ops/owner-crm-snapshot?limit=1", ""
        )
        self.assertNotEqual(
            headers["x-blockwise-signature"], other_headers["x-blockwise-signature"]
        )


class RegressionTests(unittest.TestCase):
    def test_native_identity_request_uses_or_not_and(self):
        import urllib.parse
        store = sync.FrappeContactStore()
        paths = []
        store._request = lambda method, path: (paths.append(path) or {"data": []})
        store.find_contact_by_identity(profile_uuid="p", workspace_uuid="w")
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(paths[0]).query)
        self.assertIn("or_filters", params)
        self.assertNotIn("filters", params)

    def test_apply_conflicting_single_identity_never_writes(self):
        row = sync.map_snapshot_row(snapshot_row())
        record = sync.MirrorRecord("conflict", row.owner.profile_id, "other", None, {})
        store = FakeStore({"conflict": record})
        self.assertEqual(sync.apply_plan(store, row), "held_conflict")
        self.assertEqual(store.created + store.updated, [])

    def test_invalid_timestamp_is_rejected(self):
        for invalid in ["yesterday", "2026-99-99T10:00:00Z"]:
            with self.assertRaises(sync.ConnectorError):
                sync.map_snapshot_row(snapshot_row(sourceObservedAt=invalid))

    def test_timestamp_offsets_and_microseconds_are_preserved(self):
        self.assertEqual(sync._normalise_timestamp("2026-09-13T08:00:00.123456+08:00"),
                         "2026-09-13 00:00:00.123456")

    def test_repeat_create_is_unchanged_without_email_mutation(self):
        store = FakeStore()
        snap = sync.map_snapshot_row(snapshot_row())
        sync.apply_plan(store, snap)
        self.assertEqual(sync.apply_plan(store, snap), "unchanged")
        self.assertEqual(store.emails, [])
        self.assertEqual(store.contacts[store.created[0]].values["email_ids"],
                         [{"email_id": snap.owner.email, "is_primary": 1}])

    def test_update_carries_native_modified_and_preserves_operator_fields(self):
        store = FakeStore()
        snap = sync.map_snapshot_row(snapshot_row())
        sync.apply_plan(store, snap)
        record = store.contacts[store.created[0]]
        record.values["first_name"] = "Operator choice"
        record.values["email_ids"].append({"email_id":"operator@example.test", "is_primary":0})
        later = sync.map_snapshot_row(snapshot_row(stripeSubscriptionStatus="past_due",
            sourceObservedAt="2026-09-14T00:00:00Z"))
        self.assertEqual(sync.apply_plan(store, later), "update")
        self.assertEqual(store.updated[0][1]["modified"], "2026-09-13 00:00:00.000001")
        self.assertEqual(record.values["first_name"], "Operator choice")
        self.assertEqual(len(record.values["email_ids"]), 2)

    def test_cyclic_pages_abort_before_writes(self):
        class Cycle:
            def fetch_page(self, **kw):
                return {"items":[snapshot_row()], "nextAfterWorkspaceId":snapshot_row()["workspaceId"]}
        store = FakeStore()
        with self.assertRaises(sync.ConnectorError):
            sync.run(snapshot_client=Cycle(), store=store, apply=True)
        self.assertEqual(store.created, [])

    def test_numeric_native_task_name_is_supported(self):
        store = sync.FrappeContactStore()
        writes=[]
        store._request=lambda method,path,**kw: ({"data":[{"name":123,"status":"Todo"}]} if method=="GET" else (writes.append(path) or {"data":{}}))
        store.reconcile_hold("workspace", "unchanged")
        self.assertEqual(writes, ["/api/resource/CRM%20Task/123"])

    def test_wrong_source_origin_fails_before_network(self):
        with self.assertRaises(sync.ConnectorError):
            sync.BlockwiseSnapshotClient(base_url="https://evil.test", signing_secret="x"*40, scope="scope")


if __name__ == "__main__":
    unittest.main()
