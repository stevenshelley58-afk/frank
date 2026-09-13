import http.server
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest import mock
import urllib.parse
import threading

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("owner_crm_setup_adapter", ROOT / "setup_adapter.py")
adapter = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = adapter
SPEC.loader.exec_module(adapter)


class Response:
    def __init__(self, payload, status=200):
        self.status = status
        self._payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, _limit=-1):
        return self._payload

    def getcode(self):
        return self.status


class FakeFrappe:
    def __init__(self, fields=None, records=None, redirect=False):
        self.fields = dict(fields or {})
        self.records = {dt: list(values) for dt, values in (records or {}).items()}
        self.requests = []
        self.posts = []
        self.updates = []
        self.redirect = redirect

    def __call__(self, request, timeout=0):
        path = urllib.parse.urlsplit(request.full_url).path
        self.requests.append((request.method, path, request.full_url, dict(request.headers)))
        if self.redirect:
            return Response({}, status=302)
        if path == "/api/method/login":
            return Response({"message": "Logged In"})
        if path == "/api/method/logout":
            return Response({"message": "Logged Out"})
        if path.startswith("/api/resource/DocType/"):
            name = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            return Response({"data": {"name": name}})
        if path in {"/api/resource/CRM%20Lead", "/api/resource/Contact"} and request.method == "GET":
            dt = urllib.parse.unquote(path.split("/api/resource/", 1)[1])
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
            fieldname = json.loads(query["fields"][0])[0]
            offset = int(query["limit_start"][0])
            page_length = int(query["limit_page_length"][0])
            values = self.records.get(dt, [])
            return Response({"data": [{fieldname: value} for value in values[offset:offset + page_length]]})
        if path.startswith("/api/resource/Custom%20Field/") and request.method == "PUT":
            name = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            payload = json.loads(request.data.decode())
            self.fields[name.split("-", 1)[1]]["unique"] = payload["unique"]
            self.updates.append(payload)
            return Response({"data": self.fields[name.split("-", 1)[1]]})
        if path == "/api/resource/Custom%20Field" and request.method == "GET":
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
            filters = json.loads(query["filters"][0])
            fieldname = next(item[2] for item in filters if item[0] == "fieldname")
            field = self.fields.get(fieldname)
            return Response({"data": [field] if field else []})
        if path == "/api/resource/Custom%20Field" and request.method == "POST":
            payload = json.loads(request.data.decode())
            self.fields[payload["fieldname"]] = payload
            self.posts.append(payload)
            return Response({"data": payload})
        raise AssertionError(f"unexpected request: {request.method} {path}")


class OwnerCrmSetupTests(unittest.TestCase):
    def fields(self):
        return adapter.load_manifest(ROOT / "manifest.json")

    def client(self, fake):
        return adapter.FrappeRestClient(opener=fake)

    def test_manifest_targets_native_crm_lead_and_contact_without_sendability(self):
        fields = self.fields()
        self.assertEqual({field["dt"] for field in fields}, {"CRM Lead", "Contact"})
        names = {field["name"] for field in fields}
        self.assertIn("CRM Lead-custom_blockwise_eligibility", names)
        eligibility = next(field for field in fields if field["name"].endswith("eligibility"))
        self.assertEqual(eligibility["default"], "review_required")
        self.assertEqual(eligibility["read_only"], 0)
        self.assertIn("Contact-custom_blockwise_last_synced_at", names)
        encoded = json.dumps(fields).lower()
        self.assertNotIn("consent", encoded)
        self.assertNotIn("sendability", encoded)

    def test_manifest_carries_the_documented_mirror_fields(self):
        fields = self.fields()
        names = {field["name"] for field in fields}
        # The field contract requires a destination for every mirrored fact.
        for required in (
            "Contact-custom_blockwise_profile_uuid",
            "Contact-custom_blockwise_workspace_uuid",
            "Contact-custom_blockwise_subscription_status",
            "Contact-custom_blockwise_access_status",
            "Contact-custom_blockwise_trial_state",
            "Contact-custom_blockwise_trial_started_at",
            "Contact-custom_blockwise_trial_ends_at",
            "Contact-custom_blockwise_source_observed_at",
            "Contact-custom_blockwise_last_synced_at",
            "Contact-custom_blockwise_sync_state",
        ):
            self.assertIn(required, names)
        # Observation time and sync time are distinct destinations.
        self.assertNotEqual(
            "Contact-custom_blockwise_source_observed_at",
            "Contact-custom_blockwise_last_synced_at",
        )
        sync_state = next(
            field for field in fields if field["name"].endswith("sync_state")
        )
        self.assertEqual(set(sync_state["options"].splitlines()), {
            "synced", "held_ambiguous", "held_stale",
        })
        self.assertEqual(sync_state["read_only"], 1)

    def test_manifest_field_count_is_not_pinned(self):
        # Adding a documented field must not require editing a fixed count.
        manifest = json.loads((ROOT / "manifest.json").read_text())
        self.assertGreaterEqual(len(manifest["fields"]), 13)
        candidate = json.loads(json.dumps(manifest))
        candidate["fields"].append({
            "name": "Contact-custom_blockwise_extra_probe",
            "doctype": "Custom Field",
            "dt": "Contact",
            "fieldname": "custom_blockwise_extra_probe",
            "label": "Blockwise extra probe",
            "fieldtype": "Data",
            "unique": 0,
            "read_only": 1,
            "description": "Test-only probe field.",
        })
        validated = adapter.validate_manifest(candidate)
        self.assertEqual(len(validated), len(manifest["fields"]) + 1)

    def test_source_uuid_fields_are_native_unique_and_optional(self):
        fields = self.fields()
        unique_names = {
            field["name"] for field in fields if field["unique"] == 1
        }
        self.assertEqual(unique_names, {
            "CRM Lead-custom_blockwise_prospect_source_uuid",
            "Contact-custom_blockwise_profile_uuid",
            "Contact-custom_blockwise_workspace_uuid",
        })
        self.assertTrue(all(field["unique"] in (0, 1) for field in fields))
        self.assertTrue(all(field["read_only"] in (0, 1) for field in fields))

    def test_manifest_rejects_non_strict_unique_flags(self):
        manifest = json.loads((ROOT / "manifest.json").read_text())
        for value in (None, 2, "1"):
            candidate = json.loads(json.dumps(manifest))
            candidate["fields"][0]["unique"] = value
            with self.assertRaisesRegex(adapter.SetupError, "unique"):
                adapter.validate_manifest(candidate)

    def test_existing_source_field_only_upgrades_unique_flag(self):
        fields = self.fields()
        existing = {field["fieldname"]: dict(field) for field in fields}
        source = next(field for field in fields if field["name"].startswith("CRM Lead-"))
        existing[source["fieldname"]]["unique"] = 0
        fake = FakeFrappe(existing, records={"CRM Lead": ["123e4567-e89b-42d3-a456-426614174000", None]})
        plan = adapter.run_setup(client=self.client(fake), apply=False)
        self.assertEqual(
            [item.action for item in plan if item.field["name"] == source["name"]],
            ["upgrade_unique"],
        )
        adapter.run_setup(client=self.client(fake), apply=True)
        self.assertEqual(fake.posts, [])
        self.assertEqual(fake.updates, [{"unique": 1}])
        adapter.run_setup(client=self.client(fake), apply=True)
        self.assertEqual(fake.updates, [{"unique": 1}])

    def test_duplicate_source_values_fail_before_any_write(self):
        fields = self.fields()
        existing = {field["fieldname"]: dict(field) for field in fields}
        source = next(field for field in fields if field["name"].startswith("CRM Lead-"))
        existing[source["fieldname"]]["unique"] = 0
        value = "123e4567-e89b-42d3-a456-426614174000"
        fake = FakeFrappe(existing, records={"CRM Lead": [value, value.upper()]})
        with self.assertRaisesRegex(adapter.SetupError, "duplicate source identity"):
            adapter.run_setup(client=self.client(fake), apply=True)
        self.assertEqual(fake.posts, [])
        self.assertEqual(fake.updates, [])

    def test_invalid_source_values_fail_before_any_write(self):
        fields = self.fields()
        source = next(field for field in fields if field["name"].startswith("CRM Lead-"))
        conflicting = dict(source)
        conflicting["unique"] = 0
        fake = FakeFrappe({source["fieldname"]: conflicting}, records={"CRM Lead": ["not-a-uuid"]})
        with self.assertRaisesRegex(adapter.SetupError, "invalid source identity"):
            adapter.run_setup(client=self.client(fake), apply=True)
        self.assertEqual(fake.posts, [])
        self.assertEqual(fake.updates, [])

    def test_dry_run_is_default_and_never_posts_or_touches_records(self):
        fake = FakeFrappe()
        plan = adapter.run_setup(client=self.client(fake), apply=False)
        self.assertTrue(all(item.action == "create" for item in plan))
        self.assertEqual(fake.posts, [])
        paths = [request[1] for request in fake.requests]
        self.assertEqual(set(paths), {"/api/resource/DocType/CRM%20Lead", "/api/resource/DocType/Contact", "/api/resource/Custom%20Field"})

    def test_apply_is_idempotent(self):
        fake = FakeFrappe()
        fields = self.fields()
        first = adapter.run_setup(client=self.client(fake), apply=True)
        self.assertEqual(len(fake.posts), len(fields))
        self.assertTrue(all(item.action == "create" for item in first))
        fake.requests.clear()
        second = adapter.run_setup(client=self.client(fake), apply=True)
        self.assertEqual(len(fake.posts), len(fields))
        self.assertTrue(all(item.action == "unchanged" for item in second))

    def test_incompatible_existing_field_fails_before_any_write(self):
        fields = self.fields()
        conflicting = dict(fields[0])
        conflicting["label"] = "Wrong definition"
        fake = FakeFrappe({fields[0]["fieldname"]: conflicting})
        with self.assertRaisesRegex(adapter.SetupError, "incompatible existing"):
            adapter.run_setup(client=self.client(fake), apply=True)
        self.assertEqual(fake.posts, [])

    def test_redirects_fail_closed(self):
        fake = FakeFrappe(redirect=True)
        with self.assertRaisesRegex(adapter.SetupError, "redirect rejected"):
            adapter.run_setup(client=self.client(fake), apply=False)

    def test_target_cannot_be_redirected_or_overridden(self):
        with self.assertRaises(adapter.SetupError):
            adapter.FrappeRestClient(endpoint="http://127.0.0.1:18082", opener=lambda *_a, **_k: None)
        with self.assertRaises(adapter.SetupError):
            adapter.FrappeRestClient(site="other.internal", opener=lambda *_a, **_k: None)

    def test_credentials_are_external_and_only_password_is_returned(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "owner-crm.env"
            path.write_text("OWNER_CRM_ADMIN_PASSWORD=short-lived-secret\nOWNER_CRM_DB_PASSWORD=do-not-use\n")
            self.assertEqual(
                adapter.load_credentials(path, enforce_permissions=False),
                ("Administrator", "short-lived-secret"),
            )

    def test_real_loopback_transport_uses_cookie_csrf_and_logout(self):
        state = {"methods": [], "created": 0, "logout_cookie": "", "csrf_headers": []}
        fields = self.fields()

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def send_payload(self, payload, status=200, headers=None):
                raw = json.dumps(payload).encode()
                self.send_response(status)
                for key, value in (headers or {}).items():
                    values = value if isinstance(value, (list, tuple)) else (value,)
                    for item in values:
                        self.send_header(key, item)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self):
                state["methods"].append(self.command + " " + self.path)
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                if self.path == "/api/method/login":
                    self.send_payload(
                        {"message": "Logged In"},
                        headers={"Set-Cookie": ["sid=temporary-session; Path=/", "csrf_token=temporary-csrf; Path=/"]},
                    )
                    return
                if self.path == "/api/method/logout":
                    state["logout_cookie"] = self.headers.get("Cookie", "")
                    self.send_payload({"message": "Logged Out"})
                    return
                if self.path == "/api/resource/Custom%20Field":
                    self.assert_request_csrf()
                    payload = json.loads(body.decode())
                    state["created"] += 1
                    self.send_payload({"data": payload})
                    return
                self.send_payload({"error": "not found"}, 404)

            def do_GET(self):
                state["methods"].append(self.command + " " + self.path)
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://example.invalid/")
                    self.end_headers()
                    return
                if self.path.startswith("/api/resource/DocType/"):
                    name = urllib.parse.unquote(self.path.rsplit("/", 1)[-1])
                    self.send_payload({"data": {"name": name}})
                    return
                if self.path.startswith("/api/resource/Custom%20Field?"):
                    self.send_payload({"data": []})
                    return
                self.send_payload({"error": "not found"}, 404)

            def assert_request_csrf(self):
                state["csrf_headers"].append(self.headers.get("X-Frappe-CSRF-Token", ""))
                if self.headers.get("X-Frappe-CSRF-Token") != "temporary-csrf":
                    self.send_payload({"error": "csrf"}, 403)
                    raise AssertionError("missing CSRF header")

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        endpoint = "http://127.0.0.1:" + str(server.server_port)
        try:
            with mock.patch.object(adapter, "DEFAULT_ENDPOINT", endpoint):
                client = adapter.FrappeRestClient(endpoint=endpoint)
                client.login("Administrator", "temporary-password")
                plan = adapter.plan_setup(client, fields)
                for item in plan:
                    client.create_custom_field(item.field)
                client.logout()
                client.close()
                self.assertEqual(state["created"], len(fields))
                self.assertEqual(state["csrf_headers"], ["temporary-csrf"] * len(fields))
                self.assertIn("sid=temporary-session", state["logout_cookie"])
                with self.assertRaisesRegex(adapter.SetupError, "redirect rejected"):
                    client._request("GET", "/redirect")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_owned_bootstrap_logs_out_and_clears_session(self):
        fake = FakeFrappe()
        client = self.client(fake)
        with mock.patch.object(adapter, "load_credentials", return_value=("Administrator", "secret")):
            with mock.patch.object(adapter, "FrappeRestClient", return_value=client):
                adapter.run_setup(manifest_path=ROOT / "manifest.json", apply=False)
        methods = [method for method, path, *_ in fake.requests]
        self.assertEqual(methods[0], "POST")
        self.assertEqual(methods[-1], "POST")
        self.assertEqual(fake.requests[0][1], "/api/method/login")
        self.assertEqual(fake.requests[-1][1], "/api/method/logout")
        self.assertEqual(list(client.cookies), [])

    def test_credentials_reject_missing_password(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "owner-crm.env"
            path.write_text("OWNER_CRM_DB_PASSWORD=not-admin\n")
            with self.assertRaisesRegex(adapter.SetupError, "password is missing"):
                adapter.load_credentials(path, enforce_permissions=False)


if __name__ == "__main__":
    unittest.main()
