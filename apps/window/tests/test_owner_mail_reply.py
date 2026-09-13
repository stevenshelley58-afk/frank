import base64
import hashlib
import hmac
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

from flask import Flask

WINDOW = Path(__file__).resolve().parents[1]
if str(WINDOW) not in sys.path:
    sys.path.insert(0, str(WINDOW))
import owner_mail_reply as module

SECRET = "s" * 40
PROFILE = "11111111-1111-4111-8111-111111111111"
WORKSPACE = "22222222-2222-4222-8222-222222222222"


def payload(**changes):
    value = {
        "event_id": "COMM-0001",
        "sender": "Human Person <person@example.com>",
        "recipients": "Blockwise <hello@blockwise.sale>",
        "cc": "",
        "bcc": "",
        "communication_medium": "Email",
        "sent_or_received": "Received",
        "in_reply_to": "",
        "email_headers": "In-Reply-To: <message@example.com>\nAuto-Submitted: no\n",
    }
    value.update(changes)
    return value


def signed(value, secret=SECRET):
    raw = json.dumps(value, separators=(",", ":")).encode()
    signature = base64.b64encode(hmac.new(secret.encode(), raw, hashlib.sha256).digest()).decode()
    return raw, {module.SIGNATURE_HEADER: signature, "Content-Type": "application/json"}


class FakeMautic:
    def __init__(self, *, stopped=False, duplicate=False, invalid_identity=False):
        self.requests = []
        fields = {
            "email": "person@example.com",
            "blockwise_profile_id": "bad" if invalid_identity else PROFILE,
            "blockwise_workspace_id": WORKSPACE,
            module.NURTURE_EXIT_FIELD: "stopped" if stopped else "active",
        }
        self.contact = {"id": 17, "email": "person@example.com", "fields": {"all": fields}}
        self.duplicate = duplicate

    def request(self, method, path, payload=None):
        self.requests.append((method, path, payload))
        if method == "GET" and path.startswith("contacts?"):
            contacts = {"17": self.contact}
            if self.duplicate:
                contacts["18"] = {**self.contact, "id": 18}
            return {"contacts": contacts, "total": len(contacts)}
        return {}

    def collection(self, path, key):
        if path == "segments":
            return [
                {"id": index, "name": "Owner CRM | " + flow.title, "isPublished": True}
                for index, flow in enumerate(module.FLOWS, 1)
            ]
        raise AssertionError(path)


class OwnerMailReplyTests(unittest.TestCase):
    def app(self):
        app = Flask(__name__)
        module.register_owner_mail_reply(app, {
            "OWNER_MAIL_REPLY_SECRET": SECRET,
            "OWNER_MAIL_REPLY_MAUTIC_USERNAME": "bridge",
            "OWNER_MAIL_REPLY_MAUTIC_PASSWORD": "private",
        })
        return app

    def test_native_frappe_signature_and_human_reply_stop_without_dnc(self):
        fake = FakeMautic()
        raw, headers = signed(payload())
        with mock.patch.object(module, "Mautic", return_value=fake):
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "stopped"})
        self.assertIn(("PATCH", "contacts/17/edit", {module.NURTURE_EXIT_FIELD: "stopped"}), fake.requests)
        removals = [request for request in fake.requests if request[1].endswith("/remove")]
        self.assertEqual(len(removals), len(module.FLOWS))
        self.assertNotIn("doNotContact", json.dumps(fake.requests))

    def test_bad_signature_is_403_before_native_api(self):
        raw, headers = signed(payload())
        headers[module.SIGNATURE_HEADER] = base64.b64encode(b"x" * 32).decode()
        with mock.patch.object(module, "Mautic") as constructor:
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(response.status_code, 403)
        constructor.assert_not_called()

    def test_auto_submitted_bulk_and_non_reply_are_ignored(self):
        variants = (
            payload(email_headers="In-Reply-To: <x>\nAuto-Submitted: auto-replied\n"),
            payload(email_headers="In-Reply-To: <x>\nPrecedence: bulk\n"),
            payload(email_headers="Auto-Submitted: no\n"),
            payload(recipients="owner@example.com"),
            payload(sent_or_received="Sent"),
        )
        for value in variants:
            with self.subTest(value=value):
                raw, headers = signed(value)
                with mock.patch.object(module, "Mautic") as constructor:
                    response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
                self.assertEqual(response.get_json(), {"status": "ignored"})
                constructor.assert_not_called()

    def test_header_only_references_prove_reply(self):
        fake = FakeMautic()
        raw, headers = signed(payload(email_headers=json.dumps({"References": "<prior@example.com>"})))
        with mock.patch.object(module, "Mautic", return_value=fake):
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(response.get_json(), {"status": "stopped"})

    def test_collision_and_invalid_immutable_identity_are_ignored(self):
        for fake in (FakeMautic(duplicate=True), FakeMautic(invalid_identity=True)):
            raw, headers = signed(payload())
            with mock.patch.object(module, "Mautic", return_value=fake):
                response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
            self.assertEqual(response.get_json(), {"status": "ignored_identity"})
            self.assertFalse(any(request[0] in {"PATCH", "POST"} for request in fake.requests))

    def test_replay_repairs_segments_without_reactivating_or_dnc(self):
        fake = FakeMautic(stopped=True)
        raw, headers = signed(payload())
        with mock.patch.object(module, "Mautic", return_value=fake):
            first = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(first.status_code, 200)
        self.assertFalse(any(request[0] == "PATCH" for request in fake.requests))
        self.assertEqual(len([request for request in fake.requests if request[1].endswith("/remove")]), len(module.FLOWS))

    def test_native_api_failure_stays_retryable(self):
        raw, headers = signed(payload())
        with mock.patch.object(module, "_stop", side_effect=module.ApiError("unavailable")):
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {"status": "retry"})

    def test_closed_payload_rejects_message_body_and_oversize_headers(self):
        for value in (
            payload(message_body="private"),
            payload(email_headers="x" * (module.MAX_HEADER_CHARACTERS + 1)),
        ):
            raw, headers = signed(value)
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
            self.assertEqual(response.status_code, 400)

    def test_registration_fails_closed(self):
        with self.assertRaises(RuntimeError):
            module.register_owner_mail_reply(Flask(__name__), {})
        with self.assertRaises(RuntimeError):
            module.register_owner_mail_reply(Flask(__name__), {
                "OWNER_MAIL_REPLY_SECRET": SECRET,
                "OWNER_MAIL_REPLY_MAUTIC_PASSWORD": "x",
                "OWNER_MAIL_REPLY_MAUTIC_URL": "https://example.com",
            })


if __name__ == "__main__":
    unittest.main()
