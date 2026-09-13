#!/usr/bin/env python3
import importlib.util
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).parent
flow_spec = importlib.util.spec_from_file_location("mautic_flows", HERE / "mautic_flows.py")
flows = importlib.util.module_from_spec(flow_spec)
assert flow_spec.loader
sys.modules[flow_spec.name] = flows
flow_spec.loader.exec_module(flows)
spec = importlib.util.spec_from_file_location("newsletter", HERE / "newsletter.py")
newsletter = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = newsletter
spec.loader.exec_module(newsletter)


class FakeMautic:
    def __init__(self):
        self.store = {"lists": [], "emails": []}
        self.calls = []

    def collection(self, path, key):
        return list(self.store[key])

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        targets = {
            "segments/new": ("lists", "list"),
            "emails/new": ("emails", "email"),
        }
        if method == "POST" and path in targets:
            store, response = targets[path]
            item = dict(payload, id=len(self.store[store]) + 1, sentCount=0)
            if store == "emails":
                item["lists"] = [{"id": value} for value in payload["lists"]]
            self.store[store].append(item)
            return {response: item}
        raise AssertionError((method, path, payload))


class NewsletterTests(unittest.TestCase):
    def test_apply_is_idempotent_and_held(self):
        api = FakeMautic()
        first = newsletter.setup(api, apply=True)
        call_count = len(api.calls)
        second = newsletter.setup(api, apply=True)
        self.assertEqual(first, second)
        self.assertEqual(call_count, len(api.calls))
        self.assertEqual(first["audience_filters"], 2)
        email = api.store["emails"][0]
        self.assertEqual(email["emailType"], "list")
        self.assertFalse(email["isPublished"])
        self.assertEqual(email["lists"], [{"id": 1}])
        self.assertEqual(email["sentCount"], 0)

    def test_native_html_void_element_normalization_is_accepted(self):
        api = FakeMautic()
        newsletter.setup(api, apply=True)
        api.store["emails"][0]["customHtml"] = api.store["emails"][0]["customHtml"].replace("<br>", "<br />")
        api.calls.clear()
        newsletter.setup(api, apply=True)
        self.assertEqual(api.calls, [])

    def test_audience_is_only_explicit_current_newsletter_consent(self):
        filters = newsletter.desired_filters()
        self.assertEqual(
            [(item["field"], item["operator"], item["properties"]["filter"]) for item in filters],
            [
                (flows.CONSENT_FIELD, "=", "opted_in"),
                (flows.NURTURE_EXIT_FIELD, "=", "active"),
            ],
        )

    def test_drift_fails_closed_without_edit_or_delete(self):
        api = FakeMautic()
        newsletter.setup(api, apply=True)
        api.calls.clear()
        api.store["lists"][0]["filters"][0]["properties"]["filter"] = "unknown"
        with self.assertRaisesRegex(flows.ApiError, "audience drift"):
            newsletter.setup(api, apply=True)
        self.assertEqual(api.calls, [])

    def test_copy_reuses_approved_guide_and_has_real_cta(self):
        payload = newsletter.newsletter_payload(9)
        self.assertIn("https://blockwise.sale/ad-studio", payload["plainText"])
        self.assertIn("{unsubscribe_url}", payload["plainText"])
        self.assertIn("{dnc_url}", payload["plainText"])
        self.assertNotIn("—", payload["subject"] + payload["preheaderText"] + payload["plainText"])
        self.assertFalse(payload["isPublished"])
        self.assertEqual(payload["emailType"], "list")

    def test_no_send_contact_import_campaign_or_schedule_endpoint(self):
        source = (HERE / "newsletter.py").read_text(encoding="utf-8")
        for forbidden in ("contacts/new", "campaigns/new", "/send", "cron", "DELETE"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
