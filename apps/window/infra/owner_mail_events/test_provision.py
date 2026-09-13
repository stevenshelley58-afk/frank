import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("owner_mail_events_provision", ROOT / "provision.py")
module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)

WEBHOOK_ID = "11111111-1111-4111-8111-111111111111"


class FakeMautic:
    def __init__(self):
        self.role = None
        self.user = None
        self.calls = []

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET" and path == "roles?limit=100":
            return {"roles": {} if self.role is None else {"7": self.role}}
        if method == "GET" and path == "users?limit=100":
            return {"users": {} if self.user is None else {"9": self.user}}
        if method == "POST" and path == "roles/new":
            self.role = {"id": "7", "name": module.ROLE, "isAdmin": False, "rawPermissions": payload["rawPermissions"]}
            return {"role": self.role}
        if method == "PATCH" and path == "roles/7/edit":
            self.role = {"id": "7", "name": module.ROLE, "isAdmin": False, "rawPermissions": payload["rawPermissions"]}
            return {"role": self.role}
        if method == "POST" and path == "users/new":
            self.user = {"id": "9", "username": module.USERNAME, "role": {"id": "7"}}
            return {"user": self.user}
        raise AssertionError((method, path))


class FakeResend:
    def __init__(self):
        self.webhook = None
        self.calls = []

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET" and path == "/webhooks?limit=100":
            return {"object": "list", "has_more": False, "data": [] if self.webhook is None else [self.webhook]}
        if method == "POST" and path == "/webhooks":
            self.webhook = {
                "object": "webhook", "id": WEBHOOK_ID, "status": "enabled",
                "endpoint": module.WEBHOOK_ENDPOINT, "events": sorted(module.WEBHOOK_EVENTS),
                "signing_secret": "whsec_" + "w" * 32,
            }
            return self.webhook
        if method == "GET" and path == "/webhooks/" + WEBHOOK_ID:
            return dict(self.webhook)
        if method == "PATCH" and path == "/webhooks/" + WEBHOOK_ID:
            self.webhook.update(payload)
            return {"object": "webhook", "id": WEBHOOK_ID}
        raise AssertionError((method, path))


class ProvisionTests(unittest.TestCase):
    def secret(self, root, name, text):
        path = Path(root) / name
        path.write_text(text, encoding="utf-8")
        path.chmod(0o600)
        return path

    def test_permissions_are_exactly_non_admin_without_send_create_or_delete(self):
        self.assertEqual(module.PERMISSIONS, {
            "lead:leads": ["viewown", "viewother", "editown", "editother"],
            "lead:lists": ["viewother", "editother"],
            "email:emails": ["viewother"],
        })
        encoded = json.dumps(module.PERMISSIONS)
        for forbidden in ("create", "delete", "publish", "send", "admin"):
            self.assertNotIn(forbidden, encoded.lower())

    def test_quoted_dsn_password_is_url_decoded(self):
        self.assertEqual(
            module.resend_key_from_dsn("'resend+smtp://resend:re_test%2Dkey@smtp.resend.com:465'"),
            "re_test-key",
        )
        self.assertEqual(
            module.resend_key_from_dsn("smtps://resend:re_test%2Dkey@smtp.resend.com:465"),
            "re_test-key",
        )
        with self.assertRaises(module.ProvisionError):
            module.resend_key_from_dsn("smtp://resend:re_test@example.com:465")

    def test_apply_creates_separate_identity_webhook_and_root_only_secret_then_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            admin = self.secret(directory, "admin.env", "MAUTIC_ADMIN_PASSWORD=admin-private\nMAUTIC_MAILER_DSN='resend+smtp://resend:re_test%2Dkey@smtp.resend.com:465'\n")
            runtime = Path(directory) / "runtime.env"
            mautic, resend = FakeMautic(), FakeResend()
            first = module.provision(apply=True, admin_path=admin, runtime_path=runtime, mautic=mautic, resend=resend)
            self.assertEqual(first["status"], "applied")
            values = module.read_env(runtime)
            self.assertEqual(values["OWNER_MAIL_EVENTS_MAUTIC_USERNAME"], module.USERNAME)
            self.assertEqual(values["OWNER_MAIL_EVENTS_RESEND_API_KEY"], "re_test-key")
            self.assertGreaterEqual(len(values["OWNER_MAIL_REPLY_SECRET"]), 32)
            self.assertTrue(values["RESEND_WEBHOOK_SECRET"].startswith("whsec_"))
            self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o600)
            before = dict(values)
            second = module.provision(apply=True, admin_path=admin, runtime_path=runtime, mautic=mautic, resend=resend)
            self.assertEqual(second["actions"], ["unchanged"])
            self.assertEqual(module.read_env(runtime), before)
            self.assertEqual(len([call for call in resend.calls if call[:2] == ("POST", "/webhooks")]), 1)
            self.assertEqual(len([call for call in mautic.calls if call[:2] == ("POST", "users/new")]), 1)

    def test_dry_run_reports_both_missing_native_identities_without_writes(self):
        api = FakeMautic()
        username, password, plan = module.ensure_mautic(api, {}, False)
        self.assertEqual((username, password), (module.USERNAME, ""))
        self.assertEqual(plan, ["create_mautic_role", "create_mautic_user"])
        self.assertFalse(any(call[0] in {"POST", "PATCH"} for call in api.calls))

    def test_existing_webhook_is_updated_not_duplicated(self):
        api = FakeResend()
        api.webhook = {
            "object": "webhook", "id": WEBHOOK_ID, "status": "disabled",
            "endpoint": module.WEBHOOK_ENDPOINT, "events": ["email.sent"],
            "signing_secret": "whsec_" + "w" * 32,
        }
        secret, plan = module.ensure_resend(api, {}, True)
        self.assertTrue(secret.startswith("whsec_"))
        self.assertEqual(plan, ["update_resend_webhook"])
        self.assertFalse(any(call[:2] == ("POST", "/webhooks") for call in api.calls))
        self.assertEqual(set(api.webhook["events"]), module.WEBHOOK_EVENTS)

    def test_ambiguous_webhook_and_non_decimal_native_id_fail_closed(self):
        api = FakeResend()
        api.webhook = {
            "object": "webhook", "id": WEBHOOK_ID, "status": "enabled",
            "endpoint": module.WEBHOOK_ENDPOINT, "events": sorted(module.WEBHOOK_EVENTS),
            "signing_secret": "whsec_" + "w" * 32,
        }
        original = api.request
        api.request = lambda method, path, payload=None: ({"object": "list", "has_more": False, "data": [api.webhook, dict(api.webhook)]} if path == "/webhooks?limit=100" else original(method, path, payload))
        with self.assertRaises(module.ProvisionError):
            module.ensure_resend(api, {}, True)
        with self.assertRaises(module.ProvisionError):
            module.decimal_id("7.0", "role")


if __name__ == "__main__":
    unittest.main()
