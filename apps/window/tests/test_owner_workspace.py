"""Focused tests for the owner workspace read contract.

The most important test here is the cross-language parity check: the browser
owns the route grammar in ``web/js/view-routing.js`` and the server owns the
section vocabulary in ``owner_workspace.py``. If those two lists drift, a
drill-down target silently stops resolving, so the drift is caught here rather
than in the browser.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

import owner_workspace as ow

WINDOW_ROOT = Path(__file__).resolve().parent.parent
VIEW_ROUTING = WINDOW_ROOT / "web" / "js" / "view-routing.js"


def _js_owner_sections() -> list[str]:
    source = VIEW_ROUTING.read_text(encoding="utf-8")
    match = re.search(r"export const OWNER_SECTIONS = Object\.freeze\(\[(.*?)\]\)", source, re.S)
    if not match:
        raise AssertionError("OWNER_SECTIONS is no longer declared as a frozen array in view-routing.js")
    return re.findall(r'"([^"]+)"', match.group(1))


class OwnerSectionVocabulary(unittest.TestCase):
    def test_python_and_browser_section_lists_are_identical(self):
        self.assertEqual(list(ow.OWNER_SECTIONS), _js_owner_sections())

    def test_every_section_has_a_canonical_path(self):
        for section in ow.OWNER_SECTIONS:
            self.assertEqual(ow.owner_section_path(section), f"/project/blockwise/{section}")

    def test_unknown_section_falls_back_to_the_overview(self):
        # A stale link must not become a broken navigation target.
        self.assertEqual(ow.owner_section_path("not-a-section"), "/project/blockwise")
        self.assertEqual(ow.owner_section_path(None), "/project/blockwise")
        self.assertEqual(ow.owner_section_path(""), "/project/blockwise")


class OwnerCustomerPaths(unittest.TestCase):
    def test_opaque_identifier_is_accepted(self):
        self.assertEqual(ow.owner_customer_path("abc-123_XYZ"), "/project/blockwise/customer/abc-123_XYZ")

    def test_separators_and_traversal_are_refused(self):
        for value in ("a/b", "..", "../secret", "", None, "a b", "a\\b"):
            self.assertEqual(ow.owner_customer_path(value), "/project/blockwise")


class ReadingHonesty(unittest.TestCase):
    def test_missing_is_not_zero(self):
        # A ready reading must carry a value, so a failed source cannot be
        # rendered as a real zero by a careless consumer.
        with self.assertRaises(ValueError):
            ow.reading(status="ready", source="stripe")
        with self.assertRaises(ValueError):
            ow.reading(status="stale", source="stripe")

    def test_failed_source_cannot_carry_a_value(self):
        with self.assertRaises(ValueError):
            ow.reading(status="error", value=0, source="stripe")
        with self.assertRaises(ValueError):
            ow.reading(status="unavailable", value=0, source="stripe")

    def test_unknown_status_is_refused(self):
        with self.assertRaises(ValueError):
            ow.reading(status="fine", value=1, source="stripe")

    def test_zero_is_a_real_ready_value(self):
        item = ow.reading(status="ready", value=0, source="frappe_crm")
        self.assertEqual(item["value"], 0)
        self.assertEqual(item["status"], "ready")

    def test_unconfigured_source_is_unavailable_and_not_zero(self):
        item = ow.unconfigured("stripe")
        self.assertEqual(item["status"], "unavailable")
        self.assertIsNone(item["value"])


class OwnerSnapshot(unittest.TestCase):
    def _snapshot(self, **readings):
        return ow.owner_snapshot(summary="Blockwise", readings=readings, now=1000)

    def test_envelope_uses_the_existing_v1_schema(self):
        snap = self._snapshot(leads=ow.reading(status="ready", value=3, source="frappe_crm"))
        self.assertEqual(snap["schema"], "schema://frank.widget-snapshot/v1")
        self.assertEqual(snap["source_truth"], "provider")
        self.assertEqual(snap["generated_at"], 1000)

    def test_one_unavailable_source_degrades_but_does_not_blank_the_page(self):
        snap = self._snapshot(
            leads=ow.reading(status="ready", value=3, source="frappe_crm", observed_at=900),
            revenue=ow.unconfigured("stripe"),
        )
        self.assertEqual(snap["status"], "stale")
        # The healthy reading survives, so the page is not blanked.
        self.assertEqual(snap["data"]["readings"]["leads"]["value"], 3)
        self.assertEqual(snap["data"]["readings"]["revenue"]["status"], "unavailable")

    def test_all_sources_unavailable_is_unavailable_not_ready(self):
        snap = self._snapshot(a=ow.unconfigured("stripe"), b=ow.unconfigured("ga4"))
        self.assertEqual(snap["status"], "unavailable")

    def test_all_sources_erroring_is_error(self):
        snap = self._snapshot(
            a=ow.reading(status="error", source="frappe_crm"),
            b=ow.reading(status="error", source="ga4"),
        )
        self.assertEqual(snap["status"], "error")

    def test_no_readings_is_empty(self):
        self.assertEqual(self._snapshot()["status"], "empty")

    def test_attention_outranks_ready(self):
        snap = self._snapshot(
            leads=ow.reading(status="ready", value=3, source="frappe_crm"),
            tickets=ow.reading(status="attention", value=2, source="frappe_helpdesk"),
        )
        self.assertEqual(snap["status"], "attention")

    def test_observation_and_refresh_times_are_separate(self):
        snap = self._snapshot(
            leads=ow.reading(status="ready", value=1, source="frappe_crm", observed_at=750),
            tickets=ow.reading(status="ready", value=1, source="frappe_helpdesk", observed_at=900),
        )
        # Refreshed time is when Frank built the snapshot; observed time is the
        # newest real source observation, and they are not the same claim.
        self.assertEqual(snap["data"][ow.REFRESHED_AT], 1000)
        self.assertEqual(snap["data"][ow.OBSERVED_AT], 900)

    def test_timezone_assumption_is_labelled(self):
        snap = self._snapshot(leads=ow.reading(status="ready", value=1, source="frappe_crm"))
        self.assertTrue(snap["data"]["timezone_is_assumption"])
        self.assertEqual(snap["data"]["timezone"], ow.DEFAULT_TIMEZONE_ASSUMPTION)

    def test_metric_authority_is_declared_for_every_metric(self):
        snap = self._snapshot(leads=ow.reading(status="ready", value=1, source="frappe_crm"))
        authority = snap["data"]["authority"]
        # Trial state and payment state must never share one authority.
        self.assertEqual(authority["trial_state"], "blockwise")
        self.assertEqual(authority["payment_state"], "stripe")
        self.assertNotEqual(authority["trial_state"], authority["payment_state"])


class OwnerLinks(unittest.TestCase):
    def test_section_link_carries_a_typed_internal_target(self):
        link = ow.owner_section_link("CRM", "crm")
        self.assertEqual(link["kind"], "internal")
        self.assertEqual(link["path"], "/project/blockwise/crm")
        self.assertEqual(link["target"]["view"], "project")

    def test_customer_link_carries_a_typed_internal_target(self):
        link = ow.owner_customer_link("Acme", "acme-1")
        self.assertEqual(link["path"], "/project/blockwise/customer/acme-1")
        self.assertEqual(link["target"]["customer"], "acme-1")

    def test_a_customer_link_cannot_inject_a_foreign_url(self):
        link = ow.owner_customer_link("Bad", "https://evil.example")
        self.assertEqual(link["path"], "/project/blockwise")


class AttentionCollection(unittest.TestCase):
    def test_a_failing_source_does_not_remove_another_source_items(self):
        def good():
            return [ow.attention_item(item_id="t1", label="Reply", source="frappe_helpdesk", detail="Awaiting owner")]

        def bad():
            raise RuntimeError("provider refused")

        result = ow.collect_attention({"helpdesk": good, "stripe": bad})
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["items"][0]["id"], "t1")
        self.assertEqual(result["unavailable_sources"][0]["source"], "stripe")

    def test_items_without_a_stable_id_are_dropped(self):
        result = ow.collect_attention({"x": lambda: [{"label": "no id"}]})
        self.assertEqual(result["count"], 0)

    def test_attention_item_requires_a_source_and_id(self):
        with self.assertRaises(ValueError):
            ow.attention_item(item_id="", label="x", source="y", detail="")
        with self.assertRaises(ValueError):
            ow.attention_item(item_id="x", label="x", source="", detail="")


if __name__ == "__main__":
    unittest.main()
