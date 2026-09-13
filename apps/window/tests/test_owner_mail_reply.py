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
SOURCE = (
    b"Date: Sun, 13 Sep 2026 15:11:59 +0800\r\n"
    b"From: Human Person <person@example.com>\r\n"
    b"To: Blockwise <hello@blockwise.sale>\r\n"
    b"In-Reply-To: <message@example.com>\r\n"
    b"References: <message@example.com>\r\n"
    b"Auto-Submitted: no\r\n"
    b"\r\n"
)


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
        "uid": "11",
        "email_account": module.OWNER_EMAIL_ACCOUNT,
        "communication_date": "2026-09-13 15:11:59.479460",
        "message_id": "",
    }
    value.update(changes)
    return value


def signed(value, secret=SECRET):
    raw = json.dumps(value, separators=(",", ":")).encode()
    signature = base64.b64encode(hmac.new(secret.encode(), raw, hashlib.sha256).digest()).decode()
    return raw, {module.SIGNATURE_HEADER: signature, "Content-Type": "application/json"}


class FakeReader:
    def __init__(self, raw=SOURCE, error=None):
        self.raw = raw
        self.error = error
        self.uids = []

    def read(self, uid):
        self.uids.append(uid)
        if self.error:
            raise self.error
        return self.raw


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
            "OWNER_MAIL_EVENTS_MAUTIC_USERNAME": "bridge",
            "OWNER_MAIL_EVENTS_MAUTIC_PASSWORD": "private",
            "OWNER_MAIL_EVENTS_IMAP_USERNAME": "mail-user",
            "OWNER_MAIL_EVENTS_IMAP_PASSWORD": "mail-private",
            "OWNER_MAIL_EVENTS_IMAP_HOST": module.IMAP_HOST,
            "OWNER_MAIL_EVENTS_IMAP_FOLDER": module.IMAP_FOLDER,
            "OWNER_MAIL_EVENTS_IMAP_UIDVALIDITY": "1286881107",
        })
        return app

    def post(self, value, reader=None, mautic=None):
        raw, headers = signed(value)
        patches = [
            mock.patch.object(module.ImapHeaderReader, "read", side_effect=(reader or FakeReader()).read),
            mock.patch.object(module, "Mautic", return_value=mautic or FakeMautic()),
        ]
        with patches[0], patches[1]:
            return self.app().test_client().post(module.ROUTE, data=raw, headers=headers)

    def test_native_frappe_signature_and_exact_header_reply_stop_without_dnc(self):
        fake = FakeMautic()
        response = self.post(payload(), mautic=fake)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "stopped"})
        self.assertIn(("PATCH", "contacts/17/edit", {module.NURTURE_EXIT_FIELD: "stopped"}), fake.requests)
        self.assertEqual(len([item for item in fake.requests if item[1].endswith("/remove")]), len(module.FLOWS))
        self.assertNotIn("doNotContact", json.dumps(fake.requests))

    def test_bad_signature_is_403_before_header_or_native_api(self):
        raw, headers = signed(payload())
        headers[module.SIGNATURE_HEADER] = base64.b64encode(b"x" * 32).decode()
        with mock.patch.object(module.ImapHeaderReader, "read") as read, mock.patch.object(module, "Mautic") as constructor:
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(response.status_code, 403)
        read.assert_not_called()
        constructor.assert_not_called()

    def test_auto_bulk_list_report_and_non_reply_sources_are_ignored(self):
        variants = (
            SOURCE.replace(b"Auto-Submitted: no", b"Auto-Submitted: auto-replied"),
            SOURCE.replace(b"Auto-Submitted: no", b"Precedence: bulk"),
            SOURCE.replace(b"Auto-Submitted: no", b"List-Id: <list.example>"),
            SOURCE.replace(b"Auto-Submitted: no", b"Content-Type: multipart/report; report-type=delivery-status"),
            SOURCE.replace(b"In-Reply-To: <message@example.com>\r\nReferences: <message@example.com>\r\n", b""),
        )
        for raw_source in variants:
            with self.subTest(raw_source=raw_source):
                response = self.post(payload(), reader=FakeReader(raw_source))
                self.assertEqual(response.get_json(), {"status": "ignored"})

    def test_strict_raw_sender_recipient_date_and_message_id_equality(self):
        variants = (
            (SOURCE.replace(b"person@example.com", b"other@example.com"), {}),
            (SOURCE.replace(b"hello@blockwise.sale", b"other@example.com"), {}),
            (SOURCE.replace(b"15:11:59", b"15:12:59"), {}),
            (SOURCE.replace(b"\r\n\r\n", b"\r\nMessage-ID: <raw@example.com>\r\n\r\n"), {}),
            (SOURCE.replace(b"\r\n\r\n", b"\r\nMessage-ID: <raw@example.com>\r\n\r\n"), {"message_id": "<different@example.com>"}),
        )
        for raw_source, changes in variants:
            with self.subTest(changes=changes):
                response = self.post(payload(**changes), reader=FakeReader(raw_source))
                self.assertEqual(response.get_json(), {"status": "ignored"})

    def test_absent_source_date_is_allowed_but_signed_native_date_is_required(self):
        source = SOURCE.replace(b"Date: Sun, 13 Sep 2026 15:11:59 +0800\r\n", b"")
        self.assertEqual(self.post(payload(), reader=FakeReader(source)).get_json(), {"status": "stopped"})
        self.assertEqual(self.post(payload(communication_date=""), reader=FakeReader(source)).status_code, 400)

    def test_message_id_matches_when_frappe_persists_it(self):
        source = SOURCE.replace(b"\r\n\r\n", b"\r\nMessage-ID: <raw@example.com>\r\n\r\n")
        response = self.post(payload(message_id="<raw@example.com>"), reader=FakeReader(source))
        self.assertEqual(response.get_json(), {"status": "stopped"})

    def test_wrong_account_uid_direction_or_recipient_never_reads_mailbox(self):
        variants = (
            payload(email_account="Other"),
            payload(uid="0"),
            payload(recipients="owner@example.com"),
            payload(sent_or_received="Sent"),
        )
        for value in variants:
            reader = FakeReader()
            response = self.post(value, reader=reader)
            self.assertEqual(response.get_json(), {"status": "ignored"})
            self.assertEqual(reader.uids, [])

    def test_collision_and_invalid_immutable_identity_are_ignored(self):
        for fake in (FakeMautic(duplicate=True), FakeMautic(invalid_identity=True)):
            response = self.post(payload(), mautic=fake)
            self.assertEqual(response.get_json(), {"status": "ignored_identity"})
            self.assertFalse(any(request[0] in {"PATCH", "POST"} for request in fake.requests))

    def test_replay_repairs_segments_without_reactivating_or_dnc(self):
        fake = FakeMautic(stopped=True)
        response = self.post(payload(), mautic=fake)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(any(request[0] == "PATCH" for request in fake.requests))
        self.assertEqual(len([request for request in fake.requests if request[1].endswith("/remove")]), len(module.FLOWS))

    def test_native_or_header_source_failure_stays_retryable(self):
        raw, headers = signed(payload())
        with mock.patch.object(module.ImapHeaderReader, "read", side_effect=module.HeaderSourceUnavailable("unavailable")):
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(response.status_code, 503)
        with mock.patch.object(module.ImapHeaderReader, "read", return_value=SOURCE), mock.patch.object(module, "_stop", side_effect=module.ApiError("unavailable")):
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
        self.assertEqual(response.status_code, 503)

    def test_closed_payload_rejects_message_body_and_removed_email_headers(self):
        for value in (payload(message_body="private"), payload(email_headers="In-Reply-To: <x>")):
            raw, headers = signed(value)
            response = self.app().test_client().post(module.ROUTE, data=raw, headers=headers)
            self.assertEqual(response.status_code, 400)

    def test_imap_reader_checks_uidvalidity_fetches_headers_only_and_bounds_result(self):
        client = mock.Mock()
        client.login.return_value = ("OK", [])
        client.select.return_value = ("OK", [b"1"])
        client.response.return_value = ("UIDVALIDITY", [b"1286881107"])
        client.uid.return_value = ("OK", [(b"1 (UID 11 BODY[HEADER] {7}", b"Header\r\n"), b")"])
        with mock.patch.object(module.imaplib, "IMAP4_SSL", return_value=client):
            reader = module.ImapHeaderReader("user", "pass", "1286881107")
            self.assertEqual(reader.read("11"), b"Header\r\n")
        client.select.assert_called_once_with("INBOX", readonly=True)
        client.uid.assert_called_once_with("fetch", "11", "(UID BODY.PEEK[HEADER])")
        client.response.return_value = ("UIDVALIDITY", [b"999"])
        with mock.patch.object(module.imaplib, "IMAP4_SSL", return_value=client):
            with self.assertRaises(module.HeaderSourceUnavailable):
                module.ImapHeaderReader("user", "pass", "1286881107").read("11")

    def test_registration_fails_closed(self):
        with self.assertRaises(RuntimeError):
            module.register_owner_mail_reply(Flask(__name__), {})
        with self.assertRaises(RuntimeError):
            module.register_owner_mail_reply(Flask(__name__), {
                "OWNER_MAIL_REPLY_SECRET": SECRET,
                "OWNER_MAIL_EVENTS_MAUTIC_USERNAME": "bridge",
                "OWNER_MAIL_EVENTS_MAUTIC_PASSWORD": "x",
                "OWNER_MAIL_EVENTS_IMAP_USERNAME": "mail",
                "OWNER_MAIL_EVENTS_IMAP_PASSWORD": "x",
                "OWNER_MAIL_EVENTS_IMAP_HOST": module.IMAP_HOST,
                "OWNER_MAIL_EVENTS_IMAP_FOLDER": module.IMAP_FOLDER,
                "OWNER_MAIL_EVENTS_IMAP_UIDVALIDITY": "1",
                "OWNER_MAIL_REPLY_MAUTIC_URL": "https://example.com",
            })


if __name__ == "__main__":
    unittest.main()
