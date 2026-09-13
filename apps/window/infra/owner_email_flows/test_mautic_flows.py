#!/usr/bin/env python3
import importlib.util
import pathlib
import sys
import unittest

spec = importlib.util.spec_from_file_location("flows", pathlib.Path(__file__).with_name("mautic_flows.py"))
flows = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = flows
spec.loader.exec_module(flows)


class FakeMautic:
    def __init__(self):
        self.store = {"fields": [], "lists": [], "emails": [], "campaigns": []}
        self.calls = []

    def collection(self, path, key):
        return list(self.store[key])

    def total(self, path):
        self.calls.append(("GET", path, None))
        return 0

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        create = {
            "fields/contact/new": ("fields", "field"),
            "segments/new": ("lists", "list"),
            "emails/new": ("emails", "email"),
            "campaigns/new": ("campaigns", "campaign"),
        }
        if path in create:
            store, response = create[path]
            item = dict(payload, id=len(self.store[store]) + 1)
            self.store[store].append(item)
            return {response: item}
        if path.startswith("emails/") and path.endswith("/edit"):
            item = next(item for item in self.store["emails"] if item["id"] == int(path.split("/")[1]))
            item.update(payload)
            return {"email": item}
        if path.startswith("campaigns/") and path.endswith("/edit"):
            item = next(item for item in self.store["campaigns"] if item["id"] == int(path.split("/")[1]))
            item.update(payload)
            return {"campaign": item}
        if path.startswith("campaigns/") and path.endswith("/delete"):
            self.store["campaigns"] = [item for item in self.store["campaigns"] if item["id"] != int(path.split("/")[1])]
            return {}
        raise AssertionError((method, path))


class FlowTests(unittest.TestCase):
    def test_setup_is_idempotent_and_campaigns_are_unpublished(self):
        api = FakeMautic()
        first = flows.setup(api, apply=True)
        calls = len(api.calls)
        second = flows.setup(api, apply=True)
        self.assertEqual(first, {"fields": 6, "segments": 8, "emails": 10, "campaigns": 8, "unpublished_campaigns": 8})
        self.assertEqual(first, second)
        self.assertEqual(calls, len(api.calls))
        self.assertTrue(all(email["emailType"] == "template" for email in api.store["emails"]))
        self.assertTrue(all(not campaign["isPublished"] for campaign in api.store["campaigns"]))

    def test_opt_in_education_is_the_only_documented_multi_step_cadence(self):
        education = next(flow for flow in flows.FLOWS if flow.key == "opted_in_education")
        self.assertEqual([step.delay_days for step in education.steps], [0, 2, 3])
        self.assertEqual(len(education.steps), 3)
        for flow in flows.FLOWS:
            if flow.key != "opted_in_education":
                self.assertEqual(len(flow.steps), 1)

    def test_campaigns_fail_closed_and_use_marketing_delivery(self):
        sample_emails = {flows.email_key(flow, index): index + 1 for flow in flows.FLOWS for index, _step in enumerate(flow.steps)}
        for flow in flows.FLOWS:
            events, _canvas = flows.campaign_events(flow, sample_emails)
            if flow.cold:
                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]["properties"]["field"], flows.COLD_RELEASE_FIELD)
                self.assertNotIn("email.send", [event["type"] for event in events])
                continue
            self.assertEqual(len(events), len(flow.steps) * 3)
            for index, _step in enumerate(flow.steps):
                group = events[index * 3:(index + 1) * 3]
                self.assertEqual(group[0]["properties"]["field"], flows.CONSENT_FIELD)
                self.assertEqual(group[0]["properties"]["value"], "opted_in")
                self.assertEqual(group[1]["properties"]["field"], flows.NURTURE_EXIT_FIELD)
                self.assertEqual(group[1]["properties"]["value"], "active")
                self.assertEqual(group[2]["properties"]["email_type"], "marketing")

    def test_campaign_reconciliation_detects_unsafe_same_count_drift(self):
        flow = next(flow for flow in flows.FLOWS if flow.key == "cold_local_audit")
        emails = {flows.email_key(candidate, index): index + 1 for candidate in flows.FLOWS for index, _step in enumerate(candidate.steps)}
        desired = flows.campaign_payload(flow, 1, emails)
        legacy = dict(desired, events=[{"type": "email.send", "order": 1, "properties": {"email": 1, "email_type": "transactional"}, "triggerInterval": 0}])
        self.assertTrue(flows.campaign_needs_update(legacy, desired))

    def test_campaign_reconciliation_replaces_stale_unpublished_campaign(self):
        api = FakeMautic()
        flows.setup(api, apply=True)
        campaign = api.store["campaigns"][0]
        campaign["events"] = [{"type": "email.send", "order": 1, "properties": {"email": 1, "email_type": "transactional"}, "triggerInterval": 0}]
        api.calls.clear()
        flows.setup(api, apply=True)
        self.assertIn(("DELETE", f"campaigns/{campaign['id']}/delete", None), api.calls)

    def test_copy_has_opt_out_and_no_em_dash(self):
        for flow in flows.FLOWS:
            for index, step in enumerate(flow.steps):
                self.assertNotIn("—", step.subject + step.preheader + step.text)
                payload = flows.email_payload(flow, index)
                self.assertIn("{unsubscribe_url}", payload["plainText"])
                self.assertIn("{dnc_url}", payload["plainText"])
                self.assertEqual("", payload["customHtml"])
                if not flow.cold:
                    self.assertIn("https://blockwise.sale/", step.text)
                    self.assertNotIn("https://blockwise.sale\n", step.text)
            if flow.cold:
                self.assertFalse(flows.email_payload(flow, 0)["isPublished"])
        self.assertNotIn("error.read", pathlib.Path(flows.__file__).read_text(encoding="utf-8"))

    def test_cold_flow_is_explicitly_blocked(self):
        self.assertTrue(next(flow for flow in flows.FLOWS if flow.key == "cold_local_audit").cold)


if __name__ == "__main__":
    unittest.main(verbosity=2)
