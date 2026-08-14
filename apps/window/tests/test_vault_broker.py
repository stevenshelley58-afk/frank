import json
import secrets
import tempfile
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server
import vault_broker


class _Response:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, _limit=-1):
        return self.payload


class _VaultUpstream:
    def __init__(self):
        self.calls = []
        self.secret_value = "generated-at-runtime-" + secrets.token_urlsafe(24)

    def __call__(self, request, timeout=None):
        body = json.loads(request.data.decode("utf-8")) if request.data else {}
        self.calls.append((request.method, request.full_url, body, timeout))
        if request.full_url.endswith("/health"):
            return _Response({"ok": True, "status": "verified", "secretValue": self.secret_value})
        # Simulate a bad upstream response that accidentally echoes a value.
        return _Response({"secret": {
            "id": "remote-id", "secretKey": body.get("secret_name", "RESEND_API_KEY"),
            "version": len(self.calls), "secretValue": self.secret_value,
        }})


class _RedirectServer:
    def __init__(self, location=None):
        self.location = location
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                owner.requests.append({
                    "path": self.path,
                    "authorization": self.headers.get("Authorization", ""),
                })
                if owner.location:
                    self.send_response(302)
                    self.send_header("Location", owner.location)
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b"{}")

            def log_message(self, *_args):
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class VaultBrokerApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.upstream = _VaultUpstream()
        self.store = vault_broker.MetadataStore(Path(self.temp.name) / "vault-metadata.json")
        self.adapter = vault_broker.HermesVaultAdapter(
            base_url="https://hermes.example.invalid/api/vault-broker",
            key="hermes-test-broker-key",
            opener=self.upstream,
        )
        vault_broker.configure(adapter=self.adapter, store=self.store)
        self.client = server.app.test_client()
        self.origin = {"Origin": "https://frank.fail"}

    def tearDown(self):
        vault_broker.configure()
        self.temp.cleanup()

    def _create_body(self):
        return {
            "project_id": "infisical-project",
            "environment": "dev",
            "secret_path": "/frank/resend",
            "secret_name": "RESEND_API_KEY",
            "scope_kind": "project",
            "scope_id": "blockwise",
            "provider": "resend",
            "capabilities": ["email.send"],
            "secret_value": self.upstream.secret_value,
        }

    def test_accidental_upstream_value_is_filtered_at_adapter_and_api_boundaries(self):
        body = self._create_body()
        adapter_response = self.adapter.create(
            project_id=body["project_id"], environment=body["environment"],
            secret_path=body["secret_path"], secret_name=body["secret_name"],
            secret_value=body["secret_value"],
        )
        self.assertNotIn("secretValue", json.dumps(adapter_response))

        response = self.client.post(
            "/api/vault/secrets", json=body,
            headers={**self.origin, "Idempotency-Key": "create-" + secrets.token_hex(12)},
        )
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        response_text = response.get_data(as_text=True)
        self.assertNotIn(self.upstream.secret_value, response_text)
        self.assertNotIn("secretValue", response_text)
        ref = response.get_json()["secret"]["ref"]

        listing = self.client.get("/api/vault/secrets")
        self.assertEqual(listing.status_code, 200)
        self.assertNotIn(self.upstream.secret_value, listing.get_data(as_text=True))
        persisted = Path(self.temp.name, "vault-metadata.json").read_text(encoding="utf-8")
        self.assertNotIn(self.upstream.secret_value, persisted)
        self.assertNotIn("secretValue", persisted)
        self.assertNotIn(self.upstream.secret_value, json.dumps(self.store._read()["audit"]))

        revealed = self.client.get("/api/vault/secrets/" + ref.rsplit("/", 1)[-1])
        self.assertEqual(revealed.status_code, 404)
        self.assertNotIn(self.upstream.secret_value, revealed.get_data(as_text=True))

    def test_write_only_lifecycle_scoping_binding_and_replay_guard(self):
        body = self._create_body()
        key = "create-" + secrets.token_hex(12)
        created = self.client.post("/api/vault/secrets", json=body, headers={**self.origin, "Idempotency-Key": key})
        self.assertEqual(created.status_code, 201)
        ref = created.get_json()["secret"]["ref"]
        self.assertTrue(ref.startswith("vault://frank/"))
        self.assertEqual(created.get_json()["secret"]["consumer"], "hermes-resend-mcp")

        replay = self.client.post("/api/vault/secrets", json=body, headers={**self.origin, "Idempotency-Key": key})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(len(self.upstream.calls), 1)  # replay does not invoke the upstream twice

        rotated = self.client.post(
            "/api/vault/secrets/" + ref.rsplit("/", 1)[-1] + "/rotate",
            json={"secret_value": "replacement-" + secrets.token_urlsafe(18)},
            headers={**self.origin, "Idempotency-Key": "rotate-" + secrets.token_hex(12)},
        )
        self.assertEqual(rotated.status_code, 200, rotated.get_data(as_text=True))

        binding = self.client.post(
            "/api/provider-broker/bindings", json={
                "vault_ref": ref, "provider": "resend", "capabilities": ["email.status"],
            }, headers={**self.origin, "Idempotency-Key": "bind--" + secrets.token_hex(12)},
        )
        self.assertEqual(binding.status_code, 201, binding.get_data(as_text=True))
        self.assertEqual(binding.get_json()["binding"]["capabilities"], ["email.status"])

        deleted = self.client.delete(
            "/api/vault/secrets/" + ref.rsplit("/", 1)[-1],
            headers={**self.origin, "Idempotency-Key": "delete-" + secrets.token_hex(12)},
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/vault/secrets").get_json()["secrets"], [])

    def test_origin_size_and_permission_failures_are_honest_and_secret_free(self):
        denied = self.client.post(
            "/api/vault/secrets", json=self._create_body(),
            headers={"Origin": "https://evil.example", "Idempotency-Key": "denied-" + secrets.token_hex(12)},
        )
        self.assertEqual(denied.status_code, 403)
        self.assertNotIn(self.upstream.secret_value, denied.get_data(as_text=True))

        original_max = vault_broker.MAX_REQUEST_BYTES
        vault_broker.MAX_REQUEST_BYTES = 10
        try:
            too_large = self.client.post(
                "/api/vault/secrets", json=self._create_body(),
                headers={**self.origin, "Idempotency-Key": "large--" + secrets.token_hex(12)},
            )
        finally:
            vault_broker.MAX_REQUEST_BYTES = original_max
        self.assertEqual(too_large.status_code, 413)
        self.assertNotIn(self.upstream.secret_value, too_large.get_data(as_text=True))

        def forbidden(_request, timeout=None):
            raise urllib.error.HTTPError("https://hermes.example.invalid", 403, "opaque", {}, None)

        vault_broker.configure(
            adapter=vault_broker.HermesVaultAdapter(
                base_url="https://hermes.example.invalid/api/vault-broker",
                key="hermes-test-broker-key", opener=forbidden,
            ), store=self.store,
        )
        failed = self.client.post(
            "/api/vault/secrets", json=self._create_body(),
            headers={**self.origin, "Idempotency-Key": "forbid-" + secrets.token_hex(12)},
        )
        self.assertEqual(failed.status_code, 403)
        self.assertEqual(failed.get_json()["error"]["code"], "vault_permission_denied")
        self.assertNotIn(self.upstream.secret_value, failed.get_data(as_text=True))

    def test_missing_or_null_origin_is_rejected_for_browser_mutations(self):
        body = self._create_body()
        missing = self.client.post(
            "/api/vault/secrets", json=body,
            headers={"Idempotency-Key": "missing-origin-" + secrets.token_hex(8)},
        )
        null = self.client.post(
            "/api/vault/secrets", json=body,
            headers={"Origin": "null", "Idempotency-Key": "null-origin--" + secrets.token_hex(8)},
        )
        self.assertEqual(missing.status_code, 403)
        self.assertEqual(null.status_code, 403)
        self.assertEqual(self.upstream.calls, [])

    def test_dedicated_key_is_required_and_health_is_cached_and_non_secret(self):
        with patch.dict("os.environ", {
            "HERMES_VAULT_BROKER_URL": "https://hermes.example.invalid/api/vault-broker",
            "HERMES_API_KEY": "broad-hermes-key-must-not-work",
            "HERMES_VAULT_BROKER_KEY": "",
        }, clear=False):
            unconfigured = vault_broker.HermesVaultAdapter(opener=self.upstream)
        self.assertEqual(unconfigured.status(), "setup_needed")

        self.assertEqual(self.adapter.status(), "verified")
        self.assertEqual(self.adapter.status(), "verified")
        health_calls = [call for call in self.upstream.calls if call[1].endswith("/health")]
        self.assertEqual(len(health_calls), 1)
        self.assertNotIn(self.upstream.secret_value, self.client.get("/api/vault/status").get_data(as_text=True))

    def test_broker_requests_never_follow_same_or_cross_host_redirects(self):
        for cross_host in (False, True):
            with self.subTest(cross_host=cross_host):
                target = _RedirectServer() if cross_host else None
                source = None
                try:
                    location = (target.url + "/received") if target else None
                    source = _RedirectServer(location)
                    if not cross_host:
                        source.location = source.url + "/same-host-second-hop"
                    adapter = vault_broker.HermesVaultAdapter(
                        base_url=source.url + "/api/vault-broker",
                        key="dedicated-broker-key",
                    )
                    with self.assertRaises(vault_broker.VaultRemoteError):
                        adapter.create(
                            project_id="project", environment="dev", secret_path="/frank",
                            secret_name="RESEND_API_KEY", secret_value="runtime-only-value",
                        )
                    self.assertEqual(len(source.requests), 1)
                    self.assertEqual(source.requests[0]["authorization"], "Bearer dedicated-broker-key")
                    if target:
                        self.assertEqual(target.requests, [])
                        self.assertTrue(all(not item["authorization"] for item in target.requests))
                    else:
                        self.assertEqual(len(source.requests), 1)
                finally:
                    if source:
                        source.close()
                    if target:
                        target.close()

    def test_vault_status_has_exact_additive_state_mapping(self):
        expected = {
            "setup_needed": (False, "Secure vault broker setup is required."),
            "unavailable": (False, "Secure vault broker is unavailable."),
            "permission_denied": (False, "Secure vault broker permission was denied."),
            "error": (False, "Secure vault broker returned an error."),
            "verified": (True, "Secure vault broker is verified."),
        }
        for state, (configured, message) in expected.items():
            with self.subTest(state=state), patch.object(self.adapter, "status", return_value=state):
                response = self.client.get("/api/vault/status")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), {
                    "schema": "schema://frank.vault-status/v1",
                    "provider": "infisical-ce",
                    "status": state,
                    "configured": configured,
                    "message": message,
                    "enterprise_features": False,
                })

    def test_corrupt_metadata_fails_closed_without_overwrite(self):
        self.store.path.write_text("{not-json", encoding="utf-8")
        before = self.store.path.read_text(encoding="utf-8")
        response = self.client.get("/api/vault/secrets")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.store.path.read_text(encoding="utf-8"), before)
        self.assertNotIn("not-json", response.get_data(as_text=True))

    def test_create_metadata_and_audit_are_one_atomic_write(self):
        original_write = self.store.write

        def fail_write(_data):
            raise OSError("injected write failure")

        self.store.write = fail_write
        try:
            response = self.client.post(
                "/api/vault/secrets", json=self._create_body(),
                headers={**self.origin, "Idempotency-Key": "atomic--" + secrets.token_hex(8)},
            )
        finally:
            self.store.write = original_write
        self.assertEqual(response.status_code, 502)
        self.assertFalse(self.store.path.exists())
        self.assertEqual([call[0] for call in self.upstream.calls], ["POST", "POST"])

    def test_rotate_delete_and_bind_metadata_projections_are_atomic(self):
        created = self.client.post(
            "/api/vault/secrets", json=self._create_body(),
            headers={**self.origin, "Idempotency-Key": "atomic-create-" + secrets.token_hex(8)},
        ).get_json()["secret"]
        ref_id = created["ref"].rsplit("/", 1)[-1]

        original_write = self.store.write

        def fail_write(_data):
            raise vault_broker.MetadataStoreError()

        before_rotate = self.store.path.read_text(encoding="utf-8")
        self.store.write = fail_write
        try:
            rotated = self.client.post(
                f"/api/vault/secrets/{ref_id}/rotate",
                json={"secret_value": "replacement-" + secrets.token_urlsafe(12)},
                headers={**self.origin, "Idempotency-Key": "atomic-rotate-" + secrets.token_hex(8)},
            )
        finally:
            self.store.write = original_write
        self.assertEqual(rotated.status_code, 503)
        self.assertEqual(rotated.get_json()["error"]["code"], "metadata_store_error")
        self.assertEqual(self.store.path.read_text(encoding="utf-8"), before_rotate)

        before_delete = self.store.path.read_text(encoding="utf-8")
        self.store.write = fail_write
        try:
            deleted = self.client.delete(
                f"/api/vault/secrets/{ref_id}",
                headers={**self.origin, "Idempotency-Key": "atomic-delete-" + secrets.token_hex(8)},
            )
        finally:
            self.store.write = original_write
        self.assertEqual(deleted.status_code, 503)
        self.assertEqual(deleted.get_json()["error"]["code"], "metadata_store_error")
        self.assertEqual(self.store.path.read_text(encoding="utf-8"), before_delete)

        generic = self._create_body()
        generic.pop("provider")
        generic.pop("consumer", None)
        generic.pop("capabilities", None)
        generic_created = self.client.post(
            "/api/vault/secrets", json=generic,
            headers={**self.origin, "Idempotency-Key": "atomic-generic-" + secrets.token_hex(8)},
        ).get_json()["secret"]
        before_bind = self.store.path.read_text(encoding="utf-8")
        self.store.write = fail_write
        try:
            bound = self.client.post(
                "/api/provider-broker/bindings", json={
                    "vault_ref": generic_created["ref"], "provider": "resend", "capabilities": ["email.send"],
                }, headers={**self.origin, "Idempotency-Key": "atomic-bind--" + secrets.token_hex(8)},
            )
        finally:
            self.store.write = original_write
        self.assertEqual(bound.status_code, 503)
        self.assertEqual(bound.get_json()["error"]["code"], "metadata_store_error")
        self.assertEqual(self.store.path.read_text(encoding="utf-8"), before_bind)

    def test_secret_cannot_be_duplicated_into_any_persisted_metadata_field(self):
        metadata_fields = (
            "project_id", "environment", "secret_path", "secret_name", "scope_kind",
            "scope_id", "provider", "consumer", "capabilities",
        )
        for field in metadata_fields:
            with self.subTest(field=field):
                secret_value = secrets.token_hex(16)
                body = self._create_body()
                body["secret_value"] = secret_value
                body[field] = [secret_value] if field == "capabilities" else secret_value
                response = self.client.post(
                    "/api/vault/secrets", json=body,
                    headers={**self.origin, "Idempotency-Key": "metadata-" + secrets.token_hex(8)},
                )
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertNotIn(secret_value, response.get_data(as_text=True))

        if self.store.path.exists():
            persisted = self.store.path.read_text(encoding="utf-8")
            self.assertNotIn("secret", persisted)
        self.assertEqual(self.upstream.calls, [])

    def test_escaped_secret_is_compared_as_a_scalar_metadata_value(self):
        secret_value = 'quote-" slash-\\ line-\n unicode-☃'
        body = self._create_body()
        body["secret_value"] = secret_value
        body["notes"] = secret_value
        # The unsupported field must not be allowed to become an echo path;
        # use a supported metadata field for the actual regression.
        body.pop("notes")
        body["scope_id"] = secret_value
        response = self.client.post(
            "/api/vault/secrets", json=body,
            headers={**self.origin, "Idempotency-Key": "escaped--" + secrets.token_hex(8)},
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(secret_value, response.get_data(as_text=True))
        self.assertFalse(self.store.path.exists())
        self.assertEqual(self.upstream.calls, [])

    def test_provider_catalog_is_honest_and_connections_contract_is_unchanged(self):
        catalog = self.client.get("/api/provider-broker/catalog").get_json()["providers"]
        by_provider = {item["provider"]: item for item in catalog}
        self.assertEqual(by_provider["resend"]["status"], "ready")
        self.assertEqual(by_provider["resend"]["consumer"], "hermes-resend-mcp")
        self.assertEqual(by_provider["mautic-smtp"]["status"], "setup_needed")
        self.assertEqual(by_provider["activepieces"]["status"], "setup_needed")

        connections = self.client.get("/api/connections").get_json()
        self.assertIn("connections", connections)
        self.assertIn("catalog", connections)
        for item in connections["connections"]:
            self.assertTrue({
                "id", "name", "provider", "status", "scope_kind", "scope_id",
                "connection_ref", "credential_ref", "last_verified_at", "capabilities",
            } <= item.keys())
            self.assertIn(item["status"], {"setup_needed", "connected", "verified", "error"})
        for item in connections["catalog"]:
            self.assertTrue({"provider", "title", "capabilities", "setup_mode"} <= item.keys())

    def test_provider_catalog_constrains_nonverified_vault_states(self):
        expected = {
            "setup_needed": "setup_needed",
            "unavailable": "setup_needed",
            "permission_denied": "error",
            "error": "error",
            "verified": "ready",
        }
        for vault_state, provider_state in expected.items():
            with self.subTest(vault_state=vault_state), patch.object(self.adapter, "status", return_value=vault_state):
                providers = self.client.get("/api/provider-broker/catalog").get_json()["providers"]
                resend = next(item for item in providers if item["provider"] == "resend")
                self.assertEqual(resend["status"], provider_state)


if __name__ == "__main__":
    unittest.main()
