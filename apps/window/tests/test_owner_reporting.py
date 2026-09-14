"""Focused tests for Results and Revenue reporting.

The property under test is that "not connected" can never be presented as a
measurement. That is the specific failure the acceptance ledger exists to
prevent, so it is asserted structurally rather than trusted to a renderer.
"""

from __future__ import annotations

import unittest
from unittest import mock

import owner_reporting as reporting


class DeclaredSources(unittest.TestCase):
    def test_every_source_declares_what_it_needs_and_its_limits(self):
        for source_id, declared in reporting.REPORTING_SOURCES.items():
            self.assertTrue(declared["label"], source_id)
            self.assertTrue(declared["measures"], source_id)
            self.assertTrue(declared["needs"], source_id)
            self.assertTrue(declared["authority"], source_id)
            # A number without its limits invites the owner to over-read it.
            self.assertTrue(declared["limits"], source_id)
            self.assertIn(declared["section"], {"results", "revenue"}, source_id)

    def test_results_and_revenue_both_declare_sources(self):
        sections = {item["section"] for item in reporting.REPORTING_SOURCES.values()}
        self.assertEqual(sections, {"results", "revenue"})

    def test_cash_and_recurring_revenue_are_one_authority_not_two_claims(self):
        # Stripe owns both quantities. The declaration must say they are
        # different quantities rather than implying a single revenue number.
        limits = reporting.REPORTING_SOURCES["stripe"]["limits"].lower()
        self.assertIn("cash collected", limits)
        self.assertIn("recurring revenue", limits)
        self.assertIn("currencies", limits)


class UnconfiguredIsNotZero(unittest.TestCase):
    def test_a_source_without_a_reader_is_unconfigured_not_empty(self):
        with mock.patch.dict(reporting.REPORTING_READERS, {}, clear=True):
            payload = reporting.source_report("ga4")
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["connection"]["state"], "unconfigured")
        self.assertEqual(payload["metrics"], [])
        self.assertEqual(payload["items"], [])

    def test_the_unconfigured_detail_names_the_exact_connection_step(self):
        with mock.patch.dict(reporting.REPORTING_READERS, {}, clear=True):
            payload = reporting.source_report("stripe")
        # The owner must learn what to connect, not merely that something is missing.
        self.assertIn("Stripe", payload["connection"]["needs"])
        self.assertIn("read access", payload["connection"]["needs"])

    def test_an_unknown_source_is_not_reported(self):
        payload = reporting.source_report("not-a-source")
        self.assertEqual(payload["status"], "unavailable")

    def test_a_recorded_connector_state_alone_is_not_an_observation(self):
        # A connector marked ready in the environment is still unconfigured here
        # when no reader exists, because a recorded state is not data.
        with mock.patch.dict(reporting.REPORTING_READERS, {}, clear=True), \
             mock.patch.dict("os.environ", {"GA4_CONNECTOR_STATUS": "ready"}):
            payload = reporting.source_report("ga4")
        self.assertEqual(payload["connection"]["state"], "unconfigured")
        self.assertEqual(payload["connection"]["recorded_connector_state"], "ready")


class ReaderFailuresAreIsolated(unittest.TestCase):
    def test_a_failing_reader_is_error_not_unconfigured(self):
        def boom():
            raise RuntimeError("provider refused")

        with mock.patch.dict(reporting.REPORTING_READERS, {"ga4": boom}, clear=True):
            payload = reporting.source_report("ga4")
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["connection"]["state"], "error")
        self.assertIn("RuntimeError", payload["detail"])
        self.assertEqual(payload["metrics"], [])

    def test_a_working_reader_keeps_its_own_values_and_limits(self):
        observed = {
            "status": "ready",
            "summary": "12 sessions",
            "metrics": [{"label": "Sessions", "value": 12, "unit": ""}],
            "items": [],
        }
        with mock.patch.dict(reporting.REPORTING_READERS, {"ga4": lambda: observed}, clear=True):
            payload = reporting.source_report("ga4")
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["metrics"][0]["value"], 12)
        # The declared limits still travel with the observed value.
        self.assertTrue(payload["connection"]["limits"])

    def test_a_reader_that_returns_nonsense_is_an_error(self):
        with mock.patch.dict(reporting.REPORTING_READERS, {"ga4": lambda: "not a dict"}, clear=True):
            payload = reporting.source_report("ga4")
        self.assertEqual(payload["status"], "error")


class SectionIsolation(unittest.TestCase):
    def test_one_failing_source_does_not_remove_another(self):
        def boom():
            raise RuntimeError("down")

        def fine():
            return {"status": "ready", "summary": "ok", "metrics": [{"label": "Sessions", "value": 3, "unit": ""}], "items": []}

        with mock.patch.dict(reporting.REPORTING_READERS, {"ga4": boom, "clarity": fine}, clear=True):
            section = reporting.section_payload("results")
        self.assertEqual(section["errored_sources"], ["ga4"])
        self.assertIn("clarity", section["ready_sources"])
        # The section still reports, and names what is broken.
        self.assertEqual(section["status"], "attention")
        self.assertIn("still need a connection", section["summary"])

    def test_an_all_unconfigured_section_says_so_without_inventing_a_number(self):
        with mock.patch.dict(reporting.REPORTING_READERS, {}, clear=True):
            section = reporting.section_payload("revenue")
        self.assertEqual(section["connection_state"], "unconfigured")
        # The host vocabulary has no "unconfigured", so it degrades to
        # unavailable rather than to a status the client would render as empty.
        self.assertEqual(section["status"], "unavailable")
        self.assertEqual(section["ready_sources"], [])
        self.assertEqual(section["metrics"], [])

    def test_an_all_connected_section_reports_ready(self):
        def fine():
            return {"status": "ready", "summary": "ok", "metrics": [{"label": "Payments", "value": 2, "unit": ""}], "items": []}

        with mock.patch.dict(reporting.REPORTING_READERS, {"stripe": fine}, clear=True):
            section = reporting.section_payload("revenue")
        self.assertEqual(section["status"], "ready")
        self.assertEqual(section["ready_sources"], ["stripe"])


class Registration(unittest.TestCase):
    def test_an_unknown_source_cannot_be_registered(self):
        with self.assertRaises(ValueError):
            reporting.register_reader("not-a-source", lambda: {})

    def test_attaching_publishes_both_sections(self):
        import owner_sources as sources

        with mock.patch.dict(sources.SOURCE_READERS, {}, clear=True), \
             mock.patch.dict(reporting.REPORTING_READERS, {}, clear=True):
            attached = reporting.attach_reporting_sources()
            self.assertEqual(sorted(attached), ["results", "revenue"])
            for section in ("results", "revenue"):
                self.assertIn(section, sources.SOURCE_READERS)
                payload = sources.source_payload(section)
                self.assertEqual(payload["connection_state"], "unconfigured")


class NoCredentialReachesAPayload(unittest.TestCase):
    def test_a_reporting_payload_carries_no_secret_shaped_field(self):
        with mock.patch.dict(reporting.REPORTING_READERS, {}, clear=True):
            section = reporting.section_payload("results")
        text = repr(section).lower()
        for forbidden in ("password", "secret", "token", "api_key", "api key", "authorization", "bearer"):
            self.assertNotIn(forbidden, text, f"{forbidden} reached a reporting payload")


if __name__ == "__main__":
    unittest.main()
