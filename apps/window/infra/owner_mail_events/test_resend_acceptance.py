import importlib.util
from pathlib import Path
import re
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("resend_acceptance", ROOT / "resend_acceptance.py")
module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class FakeApi:
    def __init__(self):
        self.calls = []
        self.contact = None

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET" and path.startswith("contacts?"):
            self.assert_safe_query(path)
            return {"contacts": {}}
        if method == "POST" and path == "contacts/new":
            self.contact = {
                "id": 41,
                "fields": {"all": dict(payload)},
                "doNotContact": [],
            }
            return {"contact": self.contact}
        if method == "GET" and path == "contacts/41":
            return {"contact": self.contact}
        raise AssertionError((method, path, payload))

    @staticmethod
    def assert_safe_query(path):
        if "%2Bowner-crm-" not in path or "%40resend.dev" not in path:
            raise AssertionError("simulator plus label was not URL encoded")


class AcceptanceTests(unittest.TestCase):
    def test_only_documented_labelled_simulators_are_allowed(self):
        token = "0123456789ab"
        self.assertEqual(
            module.simulator_address("bounced", token),
            "bounced+owner-crm-0123456789ab@resend.dev",
        )
        self.assertEqual(
            module.simulator_address("complained", token),
            "complained+owner-crm-0123456789ab@resend.dev",
        )
        for kind, token in (("delivered", "0123456789ab"), ("bounced", "short"), ("bounced", "0123456789az")):
            with self.assertRaises(module.AcceptanceError):
                module.simulator_address(kind, token)

    def test_contact_is_unique_explicit_consent_active_and_not_a_customer_fixture(self):
        api = FakeApi()
        contact_id, expected = module.create_contact(api, "bounced", "0123456789ab")
        self.assertEqual(contact_id, 41)
        self.assertEqual(expected[module.CONSENT_FIELD], "opted_in")
        self.assertEqual(expected[module.NURTURE_EXIT_FIELD], "active")
        self.assertRegex(expected["blockwise_profile_id"], module.UUID_PATTERN)
        self.assertRegex(expected["blockwise_workspace_id"], module.UUID_PATTERN)
        self.assertEqual(expected["email"], "bounced+owner-crm-0123456789ab@resend.dev")
        payload = next(call[2] for call in api.calls if call[:2] == ("POST", "contacts/new"))
        self.assertEqual(payload["firstname"], "Owner CRM")
        self.assertEqual(payload["lastname"], "Bounced Simulator Acceptance")

    def test_native_email_is_unpublished_list_mail_and_respects_dnc(self):
        payload = module.email_payload("run-0123456789ab", 9)
        self.assertEqual(payload["emailType"], "list")
        self.assertIs(payload["isPublished"], False)
        self.assertIs(payload["sendToDnc"], False)
        self.assertEqual(payload["lists"], [9])
        self.assertIn("{unsubscribe_url}", payload["customHtml"])
        self.assertIn("{dnc_url}", payload["plainText"])

    def test_provider_lookup_accepts_bounded_first_page_with_more_results(self):
        class Resend:
            def request(self, method, path, payload=None):
                self.call = (method, path, payload)
                return {
                    "object": "list",
                    "has_more": True,
                    "data": [{
                        "id": "11111111-1111-4111-8111-111111111111",
                        "to": ["bounced+owner-crm-0123456789ab@resend.dev"],
                        "subject": "unique acceptance",
                        "last_event": "bounced",
                    }],
                }
        resend = Resend()
        result = module.provider_message(
            resend,
            "unique acceptance",
            "bounced+owner-crm-0123456789ab@resend.dev",
        )
        self.assertEqual(result["last_event"], "bounced")
        self.assertEqual(resend.call[:2], ("GET", "/emails?limit=100"))

    def test_runtime_hold_rejects_published_owner_campaign_and_running_worker(self):
        class Api:
            def collection(self, path, key):
                return [{"name": "Owner CRM | Education", "isPublished": True}]
        with self.assertRaises(module.AcceptanceError):
            module.ensure_marketing_held(Api(), {"isPublished": False})

        class Held:
            def collection(self, path, key):
                return [{"name": "Owner CRM | Education", "isPublished": False}]
        result = mock.Mock(returncode=0, stdout="true\n")
        with mock.patch.object(module.subprocess, "run", return_value=result):
            with self.assertRaises(module.AcceptanceError):
                module.ensure_marketing_held(Held(), {"isPublished": False})

    def test_helper_contains_no_direct_resend_send_or_unsafe_recipient(self):
        source = (ROOT / "resend_acceptance.py").read_text(encoding="utf-8")
        self.assertNotIn('resend.request("POST"', source)
        self.assertNotRegex(source, re.compile(r"@(?!resend\\.dev)[a-z0-9.-]+\\.[a-z]{2,}", re.I))


if __name__ == "__main__":
    unittest.main()
