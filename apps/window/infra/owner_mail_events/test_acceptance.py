import importlib.util
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location("owner_reply_acceptance", ROOT / "acceptance.py")
module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class FakeMautic:
    def __init__(self, contact):
        self.contact = contact

    def request(self, method, path):
        if (method, path) != ("GET", "contacts/3"):
            raise AssertionError((method, path))
        return {"contact": self.contact}


def contact(**changes):
    value = {
        "id": "3",
        "fields": {"all": {
            "email": module.CONTACT_EMAIL,
            "blockwise_profile_id": "11111111-1111-4111-8111-111111111111",
            "blockwise_workspace_id": "22222222-2222-4222-8222-222222222222",
            module.NURTURE_EXIT_FIELD: "stopped",
        }},
        "doNotContact": [{"channel": "email", "reason": 3}],
    }
    value.update(changes)
    return value


class AcceptanceTests(unittest.TestCase):
    def test_contact_three_accepts_string_id_and_requires_dnc_and_immutable_ids(self):
        snapshot = module.contact_snapshot(FakeMautic(contact()))
        self.assertEqual(snapshot["nurture"], "stopped")
        self.assertEqual(snapshot["dnc"], [{"channel": "email", "reason": 3}])
        for invalid in (
            contact(id="3.0"),
            contact(doNotContact=[]),
            contact(fields={"all": {"email": module.CONTACT_EMAIL}}),
        ):
            with self.assertRaises(module.AcceptanceError):
                module.contact_snapshot(FakeMautic(invalid))

    def test_retained_communication_lookup_is_exact_and_requests_no_body_or_headers(self):
        client = mock.Mock()
        client._request.return_value = {"data": [{"name": "COMM-00011"}]}
        self.assertEqual(module.retained_communication(client), "COMM-00011")
        path = client._request.call_args.args[1]
        self.assertIn("Communication?", path)
        self.assertNotIn("email_headers", path)
        self.assertNotIn("content", path)
        client._request.return_value = {"data": [{"name": "A"}, {"name": "B"}]}
        with self.assertRaises(module.AcceptanceError):
            module.retained_communication(client)

    def test_native_enqueue_uses_fixed_container_and_rejects_unsafe_name(self):
        completed = mock.Mock(returncode=0)
        with mock.patch.object(module.subprocess, "run", return_value=completed) as run:
            module.enqueue_native_reply("COMM-00011")
        args = run.call_args.args[0]
        self.assertEqual(args[:6], ["docker", "exec", "-i", "-w", "/home/frappe/frappe-bench", "owner-crm-backend-1"])
        program = run.call_args.kwargs["input"]
        self.assertIn('frappe.get_doc("Communication", "COMM-00011")', program)
        self.assertNotIn("email_headers", program)
        with self.assertRaises(module.AcceptanceError):
            module.enqueue_native_reply("bad\nname")

    def test_webhook_receipt_requires_stopped_without_error(self):
        client = mock.Mock()
        client._request.return_value = {"data": [{"name": "LOG-1", "response": '{"status":"stopped"}', "error": None}]}
        self.assertEqual(module.webhook_receipt(client, "COMM-00011"), "LOG-1")
        client._request.return_value = {"data": [{"name": "LOG-2", "response": '{"status":"ignored"}', "error": None}]}
        with self.assertRaises(module.AcceptanceError):
            module.webhook_receipt(client, "COMM-00011")


if __name__ == "__main__":
    unittest.main()
