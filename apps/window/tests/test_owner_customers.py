"""Focused tests for the owner customer context.

The behaviour under test is identity safety. A customer view is where records
are most likely to be silently joined, so the tests concentrate on the rules
that prevent that: an identifier must resolve to a real record, and an email
match must never merge two people.
"""

from __future__ import annotations

import unittest
from unittest import mock

import owner_customers as oc
import owner_projections as projections


class ReferenceValidation(unittest.TestCase):
    def test_a_well_formed_reference_parses(self):
        self.assertEqual(oc.parse_reference("lead:CRM-LEAD-2026-00015"), ("lead", "CRM-LEAD-2026-00015"))
        self.assertEqual(oc.parse_reference("ticket:0003"), ("ticket", "0003"))

    def test_a_reference_that_cannot_name_a_record_is_refused(self):
        for bad in (
            "", None, "bogus", "lead", "lead:", ":0001", "lead:../etc",
            "lead:a/b", "lead:a b", "stripe:xyz", "lead:" + "x" * 80,
        ):
            self.assertIsNone(oc.parse_reference(bad), f"{bad!r} should not parse")

    def test_only_declared_sources_are_accepted(self):
        self.assertEqual(sorted(oc.CUSTOMER_SOURCES), ["lead", "ticket"])


class IdentityIsNeverMerged(unittest.TestCase):
    def test_the_payload_declares_it_is_a_single_source_record(self):
        row = {"name": "CRM-LEAD-2026-00015", "creation": "2026-09-13 19:29:31", "status": "New", "lead_name": "Controlled"}
        with mock.patch.object(oc, "read_customer", return_value=row), \
             mock.patch.object(oc, "_context_rows", return_value={"open_tickets": 0}):
            payload = oc.customer_payload("lead:CRM-LEAD-2026-00015")
        # The view must not present itself as a merged golden record.
        self.assertEqual(payload["identity"], "single_source_record")
        self.assertEqual(payload["status"], "ready")

    def test_no_forbidden_field_reaches_the_payload(self):
        row = {
            "name": "CRM-LEAD-2026-00015", "status": "New",
            "password": "hunter2", "api_secret": "abc", "card_number": "4111",
            "body": "full message body", "nested": {"a": 1}, "listy": [1, 2],
        }
        with mock.patch.object(oc, "read_customer", return_value=oc._safe_row(row)), \
             mock.patch.object(oc, "_context_rows", return_value={"open_tickets": 0}):
            payload = oc.customer_payload("lead:CRM-LEAD-2026-00015")
        text = repr(payload).lower()
        for forbidden in ("hunter2", "api_secret", "4111", "full message body"):
            self.assertNotIn(forbidden, text)
        # Structured values are dropped too, so a nested record cannot ride along.
        self.assertNotIn("nested", text)
        self.assertNotIn("listy", text)

    def test_an_unresolvable_identifier_is_never_an_empty_customer(self):
        payload = oc.customer_payload("bogus")
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["items"], [])
        self.assertIn("not a record Frank can resolve", payload["detail"])

    def test_a_missing_record_is_empty_not_ready(self):
        with mock.patch.object(oc, "read_customer", return_value=None):
            payload = oc.customer_payload("lead:NO-SUCH-LEAD")
        self.assertEqual(payload["status"], "empty")
        self.assertIn("NO-SUCH-LEAD", payload["summary"])


class FailureIsolation(unittest.TestCase):
    def test_a_crm_outage_is_unavailable_not_a_fabricated_customer(self):
        with mock.patch.object(oc, "read_customer", side_effect=projections.OwnerSourceUnavailable("down")):
            payload = oc.customer_payload("lead:CRM-LEAD-2026-00015")
        self.assertEqual(payload["status"], "unavailable")
        self.assertIn("OwnerSourceUnavailable", payload["detail"])

    def test_a_failing_context_lookup_does_not_remove_the_customer(self):
        row = {"name": "CRM-LEAD-2026-00015", "status": "New", "lead_name": "Controlled"}
        with mock.patch.object(oc, "read_customer", return_value=row), \
             mock.patch.object(oc, "_context_rows", return_value={"unavailable": [{"source": "frappe_helpdesk", "detail": "Error"}]}):
            payload = oc.customer_payload("lead:CRM-LEAD-2026-00015")
        # The customer record survives its neighbour's failure.
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["metrics"], [])
        self.assertEqual(payload["unavailable_sources"][0]["source"], "frappe_helpdesk")

    def test_a_ticket_count_of_zero_is_a_real_metric(self):
        row = {"name": "CRM-LEAD-2026-00015", "status": "New"}
        with mock.patch.object(oc, "read_customer", return_value=row), \
             mock.patch.object(oc, "_context_rows", return_value={"open_tickets": 0}):
            payload = oc.customer_payload("lead:CRM-LEAD-2026-00015")
        self.assertEqual(payload["metrics"], [{"label": "Open support tickets", "value": 0, "unit": ""}])


class DrilldownIsTyped(unittest.TestCase):
    def test_a_lead_opens_its_native_record_not_a_homepage(self):
        row = {"name": "CRM-LEAD-2026-00015", "status": "New", "lead_name": "Controlled"}
        with mock.patch.object(oc, "read_customer", return_value=row), \
             mock.patch.object(oc, "_context_rows", return_value={"open_tickets": 0}):
            payload = oc.customer_payload("lead:CRM-LEAD-2026-00015")
        target = payload["items"][0]["target"]
        self.assertEqual(target["kind"], "native-record")
        self.assertEqual(target["app"], "crm")
        self.assertTrue(target["path"].endswith("CRM-LEAD-2026-00015"))


class RouteContract(unittest.TestCase):
    def setUp(self):
        import server  # noqa: F401 - registers the blueprint

        self.client = server.app.test_client()

    def test_the_route_answers_and_is_never_cached(self):
        response = self.client.get("/api/owner/workspace/customers/bogus")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    def test_a_traversal_attempt_does_not_reach_the_route(self):
        # Flask will not match a slash inside the segment, so a path traversal
        # cannot even address this view.
        self.assertIn(self.client.get("/api/owner/workspace/customers/lead:../etc").status_code, (404, 308))


if __name__ == "__main__":
    unittest.main()
