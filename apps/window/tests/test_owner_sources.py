"""Focused tests for the owner source route contract.

This module is the boundary between the projection readers and the browser, so
the tests concentrate on the two rules that must not be entrusted to a reader:
an unreadable source is never a zero, and an item without a usable destination
is never rendered as though it were reachable.
"""

from __future__ import annotations

import unittest
from unittest import mock

import owner_sources as osrc
import owner_workspace as ow


class SourceVocabulary(unittest.TestCase):
    def test_sources_match_the_frozen_owner_sections(self):
        for source_id in osrc.SOURCE_PURPOSE:
            self.assertIn(source_id, ow.OWNER_SECTIONS)
        for source_id in ow.OWNER_SECTIONS:
            self.assertIn(source_id, osrc.SOURCE_PURPOSE, f"{source_id} has no declared purpose")
            self.assertIn(source_id, osrc.SOURCE_FALLBACK_TARGET, f"{source_id} has no fallback target")

    def test_registration_refuses_an_unknown_source(self):
        with self.assertRaises(ValueError):
            osrc.register_source("not-a-section", lambda: {})

    def test_statuses_match_the_client_vocabulary(self):
        self.assertEqual(
            osrc.SOURCE_STATUSES,
            frozenset({"ready", "empty", "attention", "stale", "unavailable", "error"}),
        )


class UnavailableIsNeverZero(unittest.TestCase):
    def test_a_source_with_no_reader_is_unavailable_not_empty(self):
        with mock.patch.dict(osrc.SOURCE_READERS, {}, clear=True):
            payload = osrc.source_payload("revenue")
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["metrics"], [])
        self.assertEqual(payload["items"], [])
        # The reason names what the section will show, not just that it is absent.
        self.assertIn("recurring revenue", payload["detail"])

    def test_a_raising_reader_isolates_to_its_own_source(self):
        def boom():
            raise RuntimeError("provider refused")

        with mock.patch.dict(osrc.SOURCE_READERS, {"revenue": boom}, clear=True):
            broken = osrc.source_payload("revenue")
            healthy = osrc.source_payload("results")
        self.assertEqual(broken["status"], "unavailable")
        self.assertIn("RuntimeError", broken["detail"])
        # The other source is untouched by its neighbour's failure.
        self.assertEqual(healthy["status"], "unavailable")
        self.assertIn("reach and acquisition", healthy["detail"])

    def test_unknown_source_is_unavailable_and_the_route_404s(self):
        payload = osrc.source_payload("not-a-section")
        self.assertEqual(payload["status"], "unavailable")

    def test_a_reading_with_no_value_contributes_no_metric(self):
        snapshot = {
            "status": "attention",
            "summary": "Waiting on a source",
            "generated_at": 1000,
            "data": {
                "readings": {
                    "tickets": ow.unconfigured("frappe_helpdesk"),
                    "leads": ow.reading(status="ready", value=4, source="frappe_crm", observed_at=900),
                }
            },
        }
        payload = osrc._payload_from_snapshot("support", snapshot)
        labels = [metric["label"] for metric in payload["metrics"]]
        self.assertEqual(labels, ["leads"])
        self.assertEqual(payload["metrics"][0]["value"], 4)

    def test_standard_metrics_are_preferred_and_keep_their_labels(self):
        snapshot = {
            "status": "attention",
            "summary": "2 tickets",
            "generated_at": 1000,
            "data": {
                "readings": {"tickets_awaiting_owner": ow.reading(status="attention", value=2, source="frappe_helpdesk")},
                "metrics": [{"label": "Awaiting you", "value": 2, "unit": ""}],
            },
        }
        payload = osrc._payload_from_snapshot("support", snapshot)
        self.assertEqual(payload["metrics"], [{"label": "Awaiting you", "value": 2, "unit": ""}])


class ItemsNeedARealDestination(unittest.TestCase):
    def _snapshot_with(self, rows):
        return {"status": "ready", "summary": "x", "generated_at": 1000, "data": {"rows": rows}}

    def test_a_row_falls_back_to_its_own_section_target(self):
        payload = osrc._payload_from_snapshot("crm", self._snapshot_with([{"name": "Lead one", "detail": "New"}]))
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["target"]["kind"], "native-list")
        self.assertEqual(payload["items"][0]["target"]["app"], "crm")

    def test_a_row_without_a_label_is_dropped_and_counted(self):
        payload = osrc._payload_from_snapshot("crm", self._snapshot_with([{"detail": "no name"}, {"name": "ok"}]))
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["dropped"], 1)

    def test_every_item_always_carries_a_target(self):
        payload = osrc._payload_from_snapshot("crm", self._snapshot_with([{"name": "a"}, {"name": "b"}]))
        for item in payload["items"]:
            self.assertIsNotNone(item["target"])
            self.assertIn(item["target"]["kind"], {"native-list", "native-record", "owner-section", "owner-record"})

    def test_an_owner_section_link_becomes_a_typed_section_target(self):
        link = ow.owner_section_link("Open tickets", "support")
        target = osrc._target_from_link(link, "support")
        self.assertEqual(target, {"kind": "owner-section", "section": "support", "label": "Open tickets"})

    def test_a_customer_link_becomes_a_typed_record_target(self):
        link = ow.owner_customer_link("Acme", "acme-1")
        target = osrc._target_from_link(link, "crm")
        self.assertEqual(target["kind"], "owner-record")
        self.assertEqual(target["customerId"], "acme-1")

    def test_an_unusable_link_falls_back_rather_than_producing_a_bad_target(self):
        target = osrc._target_from_link({"label": "x", "target": {"section": "not-a-section"}}, "crm")
        self.assertEqual(target["kind"], "native-list")
        self.assertEqual(target["app"], "crm")

    def test_a_link_naming_an_unknown_section_never_reaches_the_browser(self):
        # The client drops an item whose target will not parse, so the server
        # must never emit one.
        for bad in ("not-a-section", "", None, 7):
            target = osrc._target_from_link({"target": {"section": bad}}, "support")
            self.assertIn(target["kind"], {"native-list", "owner-section"})

    def test_all_rows_unusable_reports_error_rather_than_empty(self):
        payload = osrc._payload_from_snapshot("crm", self._snapshot_with([{"detail": "no name"}]))
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["items"], [])
        self.assertEqual(payload["dropped"], 1)

    def test_an_unrecognised_status_becomes_unavailable(self):
        snapshot = {"status": "totally-fine", "generated_at": 1000, "data": {}}
        payload = osrc._payload_from_snapshot("crm", snapshot)
        self.assertEqual(payload["status"], "unavailable")


class RouteContract(unittest.TestCase):
    def setUp(self):
        import server  # noqa: F401 - registers the blueprints

        self.client = server.app.test_client()

    def test_unknown_source_is_404(self):
        self.assertEqual(self.client.get("/api/owner/workspace/sources/nope").status_code, 404)

    def test_every_declared_source_answers(self):
        for source_id in ow.OWNER_SECTIONS:
            response = self.client.get(f"/api/owner/workspace/sources/{source_id}")
            self.assertEqual(response.status_code, 200, source_id)
            body = response.get_json()
            self.assertEqual(body["source"], source_id)
            self.assertIn(body["status"], osrc.SOURCE_STATUSES)

    def test_payloads_are_never_cached(self):
        response = self.client.get("/api/owner/workspace/sources/crm")
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    def test_the_list_route_covers_the_same_vocabulary(self):
        body = self.client.get("/api/owner/workspace/sources").get_json()
        self.assertEqual(sorted(body["sources"]), sorted(ow.OWNER_SECTIONS))

    def test_no_payload_carries_a_credential_shaped_field(self):
        body = self.client.get("/api/owner/workspace/sources").get_json()
        text = repr(body).lower()
        for forbidden in ("password", "secret", "token", "api_key", "authorization"):
            self.assertNotIn(forbidden, text, f"{forbidden} reached an owner payload")


class AttachmentIsExplicit(unittest.TestCase):
    def test_attaching_reports_exactly_which_sources_are_live(self):
        import owner_sources_setup

        with mock.patch.dict(osrc.SOURCE_READERS, {}, clear=True):
            attached = owner_sources_setup.attach_owner_sources()
            self.assertEqual(sorted(attached), ["crm", "notifications", "support"])
            self.assertEqual(sorted(osrc.SOURCE_READERS), ["crm", "notifications", "support"])
            # A source with no adapter stays honestly unavailable.
            self.assertEqual(osrc.source_payload("campaigns")["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
