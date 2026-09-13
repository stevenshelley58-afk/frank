#!/usr/bin/env python3
import importlib.util, pathlib, sys, unittest
spec = importlib.util.spec_from_file_location("flows", pathlib.Path(__file__).with_name("mautic_flows.py"))
flows = importlib.util.module_from_spec(spec); assert spec.loader; sys.modules[spec.name] = flows; spec.loader.exec_module(flows)
class FakeMautic:
    def __init__(self): self.store = {"fields": [], "lists": [], "emails": [], "campaigns": []}; self.calls = []
    def collection(self, path, key): return list(self.store[key])
    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        keys = {"fields/contact/new": ("fields", "field"), "segments/new": ("lists", "list"), "emails/new": ("emails", "email"), "campaigns/new": ("campaigns", "campaign")}
        if path not in keys: raise AssertionError((method, path))
        store, response = keys[path]; item = dict(payload, id=len(self.store[store]) + 1); self.store[store].append(item); return {response: item}
class FlowTests(unittest.TestCase):
    def test_setup_is_idempotent_and_campaigns_are_unpublished(self):
        api = FakeMautic(); first = flows.setup(api, apply=True); calls = len(api.calls); second = flows.setup(api, apply=True)
        self.assertEqual(first, {"fields": 4, "segments": 8, "emails": 8, "campaigns": 8, "unpublished_campaigns": 8}); self.assertEqual(first, second); self.assertEqual(calls, len(api.calls))
        self.assertTrue(all(email["emailType"] == "template" for email in api.store["emails"])); self.assertTrue(all(not campaign["isPublished"] for campaign in api.store["campaigns"]))
    def test_copy_has_opt_out_and_no_invented_timing(self):
        for flow in flows.FLOWS:
            self.assertNotIn("—", flow.subject + flow.preheader + flow.text); self.assertNotIn("days", flow.text.lower())
            payload = flows.email_payload(flow); self.assertIn("{unsubscribe_url}", payload["plainText"]); self.assertIn("{dnc_url}", payload["plainText"]); self.assertEqual("", payload["customHtml"])
    def test_cold_flow_is_explicitly_blocked(self): self.assertTrue(next(flow for flow in flows.FLOWS if flow.key == "cold_local_audit").cold)
if __name__ == "__main__": unittest.main(verbosity=2)
