import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("owner_crm_notifications", ROOT / "setup_adapter.py")
module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)

class ManifestTests(unittest.TestCase):
    def test_closed_native_webhook_contract_contains_no_record_data(self):
        hooks = module.load_manifest(ROOT / "manifest.json")
        self.assertEqual(len(hooks), 5)
        self.assertEqual({hook["webhook_doctype"] for hook in hooks}, {"CRM Task", "HD Ticket", "CRM Lead", "Communication"})
        self.assertTrue(all(hook["webhook_docevent"] == "after_insert" for hook in hooks))
        by_type = {hook["webhook_doctype"]: hook for hook in hooks}
        self.assertIsNone(by_type["CRM Lead"]["condition"])
        self.assertEqual(by_type["Communication"]["condition"], module.INCOMING_EMAIL_CONDITION)
        self.assertTrue(all(hook["background_jobs_queue"] == "short" for hook in hooks))
        alerts = [hook for hook in hooks if hook["name"] != module.REPLY_HOOK]
        reply = next(hook for hook in hooks if hook["name"] == module.REPLY_HOOK)
        self.assertEqual(reply["timeout"], module.REPLY_TIMEOUT)
        self.assertTrue(all(hook["timeout"] == 5 for hook in hooks if hook["name"] != module.REPLY_HOOK))
        encoded = json.dumps([hook["webhook_json"] for hook in alerts]).lower()
        for forbidden in ("doc.", "contact", "customer", "description", "subject", "sender", "recipient", "body", "{{", "}}"):
            self.assertNotIn(forbidden, encoded)

    def test_payload_contract_is_derived_from_each_manifest_hook(self):
        hooks = module.load_manifest(ROOT / "manifest.json")
        for hook in hooks:
            if hook["name"] == module.REPLY_HOOK:
                continue
            payload = json.loads(hook["webhook_json"])
            self.assertEqual(payload, module.payload_for_doctype(hook["webhook_doctype"]))
            self.assertEqual(set(payload), {"topic", "title", "message", "tags"})
            self.assertEqual(payload["topic"], module.TOPIC)
            self.assertTrue(payload["title"] and payload["message"] and payload["tags"])
            self.assertFalse(any(token in json.dumps(payload).lower() for token in ("subject", "body", "sender", "recipient", "doc.", "{{", "}}")))

    def test_desired_header_is_publisher_basic_and_not_in_manifest(self):
        hook = module.load_manifest(ROOT / "manifest.json")[0]
        self.assertEqual(hook["webhook_headers"][0]["value"], "publisher-basic")
        desired = module._desired(hook, "temporary-test-secret", "r" * 40)
        self.assertTrue(desired["webhook_headers"][0]["value"].startswith("Basic "))
        self.assertNotIn("temporary-test-secret", json.dumps(hook))

    def test_frappe_empty_json_normalizes_to_manifest_null_for_field_webhook(self):
        hook = next(item for item in module.load_manifest(ROOT / "manifest.json") if item["name"] == module.REPLY_HOOK)
        desired = module._desired(hook, "unused", "r" * 40)
        actual = dict(desired)
        actual["webhook_json"] = ""
        self.assertTrue(module._compatible(actual, desired))

    def test_reply_hook_uses_native_security_and_bounded_fields_only(self):
        hook = next(item for item in module.load_manifest(ROOT / "manifest.json") if item["name"] == module.REPLY_HOOK)
        self.assertEqual(hook["request_url"], module.REPLY_URL)
        self.assertEqual(hook["request_structure"], "")
        self.assertEqual(hook["enable_security"], 1)
        self.assertEqual(hook["webhook_secret"], module.REPLY_SECRET_MARKER)
        self.assertIsNone(hook["webhook_json"])
        self.assertEqual(
            hook["webhook_data"],
            [{"key": key, "fieldname": field} for key, field in module.REPLY_FIELDS],
        )
        self.assertNotIn("content", json.dumps(hook["webhook_data"]))
        desired = module._desired(hook, "unused", "r" * 40)
        self.assertEqual(desired["webhook_secret"], "r" * 40)
        self.assertNotIn("r" * 40, json.dumps(hook))
if __name__ == "__main__": unittest.main()
