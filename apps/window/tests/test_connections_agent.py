import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

import connections_agent
import home_platform
import server


class ConnectionsAgentApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.paths = (
            home_platform.HOME_STORE_FILE,
            home_platform.CONNECTIONS_FILE,
            home_platform.CONNECTION_ACTIONS_FILE,
            home_platform.CONNECTION_PLANS_FILE,
            home_platform._connections_agent_key,
            home_platform._connections_agent_profile,
            home_platform._project_loader,
            home_platform._account_loader,
            home_platform._hermes_health,
            home_platform._roots,
        )
        base = Path(self.temp.name)
        home_platform.HOME_STORE_FILE = base / "homes.json"
        home_platform.CONNECTIONS_FILE = base / "connections.json"
        home_platform.CONNECTION_ACTIONS_FILE = base / "actions.jsonl"
        home_platform.CONNECTION_PLANS_FILE = base / "plans.json"
        home_platform.configure(
            project_loader=lambda: [], account_loader=lambda: [],
            hermes_health=lambda: {"ok": True, "profile": "default"},
            roots={}, hermes_connections_agent_key="test-hermes-agent-key",
        )
        self.client = server.app.test_client()
        self.client.environ_base["HTTP_ORIGIN"] = "http://localhost"
        self.agent_headers = {"Authorization": "Bearer test-hermes-agent-key"}

    def tearDown(self):
        (
            home_file, connections_file, actions_file, plans_file, key, profile,
            project_loader, account_loader, hermes_health, roots,
        ) = self.paths
        home_platform.HOME_STORE_FILE = home_file
        home_platform.CONNECTIONS_FILE = connections_file
        home_platform.CONNECTION_ACTIONS_FILE = actions_file
        home_platform.CONNECTION_PLANS_FILE = plans_file
        home_platform.configure(
            project_loader=project_loader, account_loader=account_loader,
            hermes_health=hermes_health, roots=roots,
            hermes_connections_agent_key=key, hermes_connections_agent_profile=profile,
        )
        self.temp.cleanup()

    def _create(self):
        response = self.client.post("/api/connections", json={
            "provider": "api", "name": "Ledger target", "scope_kind": "global",
            "status": "connected", "connection_ref": "api://ledger/target",
            "credential_ref": "openbao://frank/connections/ledger-target",
            "idempotency_key": "agent-test-create-0001",
        })
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()["connection"]

    def test_agent_ingress_requires_separate_auth_and_ignores_forged_actor(self):
        body = {"action": "discover", "actor": "forged", "idempotency_key": "discover-1"}
        self.assertEqual(self.client.post("/api/connections/agent/plan", json=body).status_code, 401)
        response = self.client.post("/api/connections/agent/plan", json=body, headers=self.agent_headers)
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["plan"]["source"], "connections-agent")
        self.assertEqual(response.get_json()["plan"]["actor"], "hermes.connections-agent")

    def test_safe_verify_uses_shared_service_and_optimistic_revision(self):
        connection = self._create()
        plan = self.client.post("/api/connections/agent/plan", json={
            "action": "verify", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "verify-1",
        }, headers=self.agent_headers)
        self.assertEqual(plan.status_code, 200, plan.get_json())
        applied = self.client.post("/api/connections/agent/apply", json={
            "plan_id": plan.get_json()["plan"]["plan_id"], "idempotency_key": "verify-apply-1",
            "provider_receipt": "hermes://receipts/verify-1", "provider_outcome": "verified",
        }, headers=self.agent_headers)
        self.assertEqual(applied.status_code, 200, applied.get_json())
        self.assertEqual(applied.get_json()["connection"]["status"], "verified")
        self.assertEqual(applied.get_json()["connection"]["revision"], 2)

        stale_plan = self.client.post("/api/connections/agent/plan", json={
            "action": "verify", "connection_id": connection["id"], "expected_revision": 1,
            "idempotency_key": "verify-stale",
        }, headers=self.agent_headers)
        stale_apply = self.client.post("/api/connections/agent/apply", json={
            "plan_id": stale_plan.get_json()["plan"]["plan_id"], "idempotency_key": "verify-apply-stale",
            "provider_receipt": "hermes://receipts/verify-stale", "provider_outcome": "verified",
        }, headers=self.agent_headers)
        self.assertEqual(stale_apply.status_code, 409)
        self.assertEqual(stale_apply.get_json()["error"], "connection changed; refresh and retry")

    def test_destructive_delete_requires_plan_token_and_ledger_read_models_are_safe(self):
        connection = self._create()
        plan = self.client.post("/api/connections/agent/plan", json={
            "action": "delete", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "delete-1",
        }, headers=self.agent_headers)
        self.assertEqual(plan.status_code, 200, plan.get_json())
        planned = plan.get_json()["plan"]
        self.assertTrue(planned["confirmation_required"])
        self.assertEqual(self.client.post("/api/connections/agent/apply", json={
            "plan_id": planned["plan_id"], "idempotency_key": "delete-apply-missing",
        }, headers=self.agent_headers).status_code, 409)

        applied = self.client.post("/api/connections/agent/apply", json={
            "plan_id": planned["plan_id"], "confirmation_token": planned["confirmation_token"],
            "idempotency_key": "delete-apply-1", "provider_receipt": "hermes://receipts/delete-1", "provider_outcome": "deleted",
        }, headers=self.agent_headers)
        self.assertEqual(applied.status_code, 200, applied.get_json())
        self.assertTrue(applied.get_json()["action"]["result"]["removed"])
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"], [])

        activity = self.client.get("/api/connections/activity").get_json()["items"]
        self.assertTrue(activity)
        self.assertTrue(any(item["actor"] == "manual.browser" for item in activity))
        self.assertTrue(any(item["actor"] == "hermes.connections-agent" for item in activity))
        self.assertFalse(any("credential_ref" in str(item) for item in activity))
        receipt_id = activity[-1]["receipt_id"]
        receipt = self.client.get(f"/api/connections/receipts/{receipt_id}")
        self.assertEqual(receipt.status_code, 200)
        self.assertEqual(receipt.get_json()["receipt"]["receipt_id"], receipt_id)

    def test_manual_cross_origin_write_is_rejected(self):
        response = self.client.post("/api/connections", json={
            "provider": "api", "name": "Cross origin", "scope_kind": "global",
        }, headers={"Origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)

    def test_allowlist_does_not_trust_caller_controlled_host_headers(self):
        response = self.client.post("/api/connections", json={
            "provider": "api", "name": "Explicit origin", "scope_kind": "global",
            "status": "connected", "idempotency_key": "origin-host-0001",
        }, headers={"Origin": "http://localhost", "Host": "attacker.example"})
        self.assertEqual(response.status_code, 201, response.get_json())
        missing = self.client.post("/api/connections", json={
            "provider": "api", "name": "Missing origin", "scope_kind": "global",
            "status": "connected", "idempotency_key": "origin-missing-0001",
        }, headers={"Host": "localhost", "Origin": ""})
        self.assertEqual(missing.status_code, 403)

    def test_chunked_or_missing_content_length_is_limited_by_actual_bytes(self):
        original_limit = home_platform.CONNECTION_REQUEST_BYTES
        home_platform.CONNECTION_REQUEST_BYTES = 32
        try:
            response = self.client.post(
                "/api/connections", data=b'{"provider":"api","name":"this body is too large"}',
                content_type="application/json", headers={"Origin": "http://localhost"},
                environ_overrides={"CONTENT_LENGTH": "", "wsgi.input_terminated": True},
            )
            self.assertEqual(response.status_code, 413, response.get_json())
        finally:
            home_platform.CONNECTION_REQUEST_BYTES = original_limit

    def test_additive_connection_reads_and_errors_are_never_cached(self):
        for path in ("/api/connections/attention", "/api/connections/activity", "/api/connections/receipts/missing"):
            response = self.client.get(path)
            self.assertEqual(response.headers.get("Cache-Control"), "no-store")
            self.assertEqual(response.headers.get("Pragma"), "no-cache")
        error = self.client.post("/api/connections/apply", json={"plan_id": "missing", "idempotency_key": "nostore-error-0001"}, headers={"Origin": "http://localhost"})
        self.assertEqual(error.status_code, 404)
        self.assertEqual(error.headers.get("Cache-Control"), "no-store")

    def test_plan_rejects_secret_in_every_target_and_body_slot_without_persisting_it(self):
        secret = "re_compromised_123456789abcdef"
        target_fields = ("provider", "connection_id", "consumer", "project", "environment")
        for index, field in enumerate(target_fields):
            with self.subTest(kind="target", field=field):
                target = {name: "safe-target" for name in target_fields}
                target[field] = secret
                response = self.client.post("/api/connections/agent/plan", json={
                    "action": "create", "target": target,
                    "body": {"provider": "api", "name": "Safe", "scope_kind": "global", "status": "setup_needed", "connection_ref": "api://safe/plan"},
                    "idempotency_key": f"secret-target-{index:02d}",
                }, headers=self.agent_headers)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn(secret, response.get_data(as_text=True))

        body_fields = ("provider", "name", "scope_kind", "scope_id", "status", "connection_ref", "credential_ref", "admin_url", "capabilities", "notes")
        for index, field in enumerate(body_fields):
            with self.subTest(kind="body", field=field):
                body = {"provider": "api", "name": "Safe", "scope_kind": "global", "status": "setup_needed", "connection_ref": "api://safe/body"}
                body[field] = [secret] if field == "capabilities" else secret
                response = self.client.post("/api/connections/agent/plan", json={
                    "action": "create", "body": body, "idempotency_key": f"secret-body-{index:02d}",
                }, headers=self.agent_headers)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn(secret, response.get_data(as_text=True))

        for path in (home_platform.CONNECTION_PLANS_FILE, home_platform.CONNECTION_ACTIONS_FILE):
            if path.exists():
                self.assertNotIn(secret, path.read_text(encoding="utf-8"))

    def test_agent_apply_without_provider_evidence_stays_pending_and_receipt_completes_it(self):
        connection = self._create()
        plan_response = self.client.post("/api/connections/agent/plan", json={
            "action": "verify", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "truth-plan-0001",
        }, headers=self.agent_headers)
        plan_id = plan_response.get_json()["plan"]["plan_id"]
        pending = self.client.post("/api/connections/agent/apply", json={
            "plan_id": plan_id, "idempotency_key": "truth-apply-0001",
        }, headers=self.agent_headers)
        self.assertEqual(pending.status_code, 202, pending.get_json())
        self.assertEqual(pending.get_json()["action"]["state"], "waiting_for_provider")
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"][0]["status"], "connected")

        completed = self.client.post("/api/connections/agent/apply", json={
            "plan_id": plan_id, "idempotency_key": "truth-apply-0002",
            "provider_receipt": "hermes://receipts/truth-verify-1", "provider_outcome": "verified",
        }, headers=self.agent_headers)
        self.assertEqual(completed.status_code, 200, completed.get_json())
        self.assertEqual(completed.get_json()["action"]["state"], "completed")
        self.assertEqual(completed.get_json()["connection"]["status"], "verified")

    def test_corrupt_ledger_or_plan_state_fails_closed(self):
        home_platform.CONNECTION_ACTIONS_FILE.write_text("not-json\n", encoding="utf-8")
        activity = self.client.get("/api/connections/activity")
        self.assertEqual(activity.status_code, 503)
        self.assertEqual(activity.get_json()["code"], "state_corrupt")

        home_platform.CONNECTION_ACTIONS_FILE.unlink()
        home_platform.CONNECTION_PLANS_FILE.write_text(json.dumps({"version": 1, "plans": {"bad": {"state": "mystery"}}}), encoding="utf-8")
        response = self.client.post("/api/connections/agent/plan", json={
            "action": "discover", "idempotency_key": "corrupt-plan-0001",
        }, headers=self.agent_headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["code"], "state_corrupt")

    def test_concurrent_duplicate_plan_and_apply_reserve_once(self):
        service = home_platform._connection_service
        self.assertIsNotNone(service)

        def make_plan(_):
            return service.plan(action="discover", source="connections-agent", actor="hermes.connections-agent", target={}, body={}, expected_revision=None, idempotency_key="concurrent-plan-0001")

        with ThreadPoolExecutor(max_workers=8) as pool:
            plans = list(pool.map(make_plan, range(8)))
        self.assertEqual({item["plan"]["plan_id"] for item in plans}, {plans[0]["plan"]["plan_id"]})
        plan_id = plans[0]["plan"]["plan_id"]

        def apply(_):
            return service.apply_plan(plan_id=plan_id, confirmation_token="", idempotency_key="concurrent-apply-0001", expected_source="connections-agent")

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(apply, range(8)))
        self.assertTrue(all(item["action"]["state"] == "completed" for item in results))
        activity = service.activity(limit=50)
        self.assertEqual(sum(1 for item in activity if item["action"] == "discover" and item["state"] == "completed"), 1)

    def test_confirmation_token_is_consumed_once_under_concurrent_apply(self):
        connection = self._create()
        planned = self.client.post("/api/connections/agent/plan", json={
            "action": "delete", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "race-delete-plan-1",
        }, headers=self.agent_headers).get_json()["plan"]
        service = home_platform._connection_service

        def apply(index):
            return service.apply_plan(
                plan_id=planned["plan_id"], confirmation_token=planned["confirmation_token"],
                idempotency_key=f"race-delete-apply-{index:04d}", expected_source="connections-agent",
                provider_receipt="hermes://receipts/race-delete", provider_outcome="deleted",
                authenticated_provider=True, executor_actor="hermes.connections-agent",
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(apply, range(8)))
        self.assertTrue(all(item["action"]["state"] == "completed" for item in results))
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"], [])
        self.assertEqual(sum(1 for item in service.activity(limit=50) if item["action"] == "delete" and item["state"] == "completed"), 1)
        plan_state = json.loads(home_platform.CONNECTION_PLANS_FILE.read_text(encoding="utf-8"))["plans"][planned["plan_id"]]
        self.assertTrue(plan_state["confirmation_consumed"])
        self.assertEqual(plan_state["confirmation_hash"], "")

    def test_manual_provider_apply_waits_then_authenticated_hermes_completes_it(self):
        connection = self._create()
        origin = {"Origin": "http://localhost"}
        planned = self.client.post("/api/connections/plan", json={
            "action": "verify", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "manual-verify-plan-01",
        }, headers=origin)
        self.assertEqual(planned.status_code, 200, planned.get_json())
        plan_id = planned.get_json()["plan"]["plan_id"]

        pending = self.client.post("/api/connections/apply", json={
            "plan_id": plan_id, "idempotency_key": "manual-verify-apply-01",
        }, headers=origin)
        self.assertEqual(pending.status_code, 202, pending.get_json())
        self.assertEqual(pending.get_json()["action"]["state"], "waiting_for_provider")
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"][0]["status"], "connected")

        completed = self.client.post("/api/connections/agent/apply", json={
            "plan_id": plan_id, "idempotency_key": "manual-verify-apply-02",
            "provider_receipt": "hermes://receipts/manual-verify-01", "provider_outcome": "verified",
        }, headers=self.agent_headers)
        self.assertEqual(completed.status_code, 200, completed.get_json())
        self.assertEqual(completed.get_json()["connection"]["status"], "verified")

    def test_direct_execute_reservation_and_completion_share_correlation(self):
        connection = self._create()
        self.assertEqual(self.client.get("/api/connections/attention").get_json()["items"], [])
        updated = self.client.patch(f"/api/connections/{connection['id']}", json={
            "notes": "Updated local metadata", "idempotency_key": "direct-update-correlation-01",
        })
        self.assertEqual(updated.status_code, 200, updated.get_json())
        attention = self.client.get("/api/connections/attention").get_json()["items"]
        self.assertFalse(any(item["action"] in {"create", "update"} and item["state"] == "running" for item in attention))

    def test_provider_failure_receipts_record_error_without_completion(self):
        origin = {"Origin": "http://localhost"}
        connection = self._create()
        verify_plan = self.client.post("/api/connections/plan", json={
            "action": "verify", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "failure-verify-plan-01",
        }, headers=origin).get_json()["plan"]
        pending = self.client.post("/api/connections/apply", json={
            "plan_id": verify_plan["plan_id"], "idempotency_key": "failure-verify-apply-01",
        }, headers=origin)
        self.assertEqual(pending.status_code, 202)
        failed = self.client.post("/api/connections/agent/apply", json={
            "plan_id": verify_plan["plan_id"], "idempotency_key": "failure-verify-apply-02",
            "provider_receipt": "hermes://receipts/verify-failed-01", "provider_outcome": "failed",
            "provider_error_code": "provider_timeout", "provider_error_category": "timeout",
        }, headers=self.agent_headers)
        self.assertEqual(failed.status_code, 200, failed.get_json())
        action = failed.get_json()["action"]
        self.assertEqual(action["state"], "failed")
        self.assertEqual(action["result"]["outcome"], "failed")
        self.assertEqual(action["result"]["status"], "error")
        self.assertNotIn("completed", action["state"])
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"][0]["status"], "error")
        attention = self.client.get("/api/connections/attention").get_json()["items"]
        self.assertEqual(attention[0]["sequence"], max(item["sequence"] for item in attention))
        self.assertEqual(next(item for item in attention if item["correlation_id"] == verify_plan["plan_id"])["state"], "failed")

        revoke_plan = self.client.post("/api/connections/agent/plan", json={
            "action": "revoke", "connection_id": connection["id"],
            "idempotency_key": "failure-revoke-plan-01",
        }, headers=self.agent_headers).get_json()["plan"]
        revoke_failed = self.client.post("/api/connections/agent/apply", json={
            "plan_id": revoke_plan["plan_id"], "confirmation_token": revoke_plan["confirmation_token"],
            "idempotency_key": "failure-revoke-apply-01", "provider_receipt": "hermes://receipts/revoke-failed-01",
            "provider_outcome": "failed", "provider_error_code": "provider_denied", "provider_error_category": "permission_denied",
        }, headers=self.agent_headers)
        self.assertEqual(revoke_failed.status_code, 200, revoke_failed.get_json())
        self.assertEqual(revoke_failed.get_json()["action"]["state"], "failed")
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"][0]["status"], "error")

    def test_provider_failure_secret_is_rejected_without_leakage(self):
        connection = self._create()
        plan = self.client.post("/api/connections/agent/plan", json={
            "action": "verify", "connection_id": connection["id"],
            "idempotency_key": "failure-secret-plan-01",
        }, headers=self.agent_headers).get_json()["plan"]
        secret = "re_compromised_provider_error_123456"
        response = self.client.post("/api/connections/agent/apply", json={
            "plan_id": plan["plan_id"], "idempotency_key": "failure-secret-apply-01",
            "provider_receipt": "hermes://receipts/verify-secret-01", "provider_outcome": "failed",
            "provider_error_code": secret, "provider_error_category": "timeout",
        }, headers=self.agent_headers)
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(secret, response.get_data(as_text=True))
        for path in (home_platform.CONNECTION_ACTIONS_FILE, home_platform.CONNECTION_PLANS_FILE):
            if path.exists():
                self.assertNotIn(secret, path.read_text(encoding="utf-8"))

    def test_manual_create_update_cannot_claim_provider_status(self):
        for index, status in enumerate(("verified", "error")):
            response = self.client.post("/api/connections", json={
                "provider": "api", "name": f"Unverified {index}", "scope_kind": "global",
                "status": status, "idempotency_key": f"manual-status-{index:02d}-0001",
            })
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.client.get("/api/connections").get_json()["connections"], [])

        connection = self._create()
        response = self.client.patch(f"/api/connections/{connection['id']}", json={
            "status": "verified", "idempotency_key": "manual-update-status-01",
        })
        self.assertEqual(response.status_code, 409, response.get_json())
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"][0]["status"], "connected")

    def test_attention_projects_latest_state_and_completion_clears_it(self):
        connection = self._create()
        planned = self.client.post("/api/connections/plan", json={
            "action": "verify", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "attention-plan-01",
        }, headers={"Origin": "http://localhost"}).get_json()["plan"]
        pending = self.client.post("/api/connections/apply", json={
            "plan_id": planned["plan_id"], "idempotency_key": "attention-apply-01",
        }, headers={"Origin": "http://localhost"})
        self.assertEqual(pending.status_code, 202)
        self.assertTrue(any(item["correlation_id"] == planned["plan_id"] for item in self.client.get("/api/connections/attention").get_json()["items"]))

        completed = self.client.post("/api/connections/agent/apply", json={
            "plan_id": planned["plan_id"], "idempotency_key": "attention-apply-02",
            "provider_receipt": "hermes://receipts/attention-01", "provider_outcome": "verified",
        }, headers=self.agent_headers)
        self.assertEqual(completed.status_code, 200)
        self.assertFalse(any(item["correlation_id"] == planned["plan_id"] for item in self.client.get("/api/connections/attention").get_json()["items"]))

    def test_plan_initial_ledger_failure_compensates_plan(self):
        service = home_platform._connection_service
        with mock.patch.object(service.ledger, "append", side_effect=connections_agent.ContractError("ledger unavailable", 503, "state_unavailable")):
            with self.assertRaises(connections_agent.ContractError):
                service.plan(action="discover", source="connections-agent", actor="hermes.connections-agent", target={}, body={}, expected_revision=None, idempotency_key="plan-fault-0001")
        if home_platform.CONNECTION_PLANS_FILE.exists():
            self.assertEqual(json.loads(home_platform.CONNECTION_PLANS_FILE.read_text(encoding="utf-8"))["plans"], {})

    def test_completion_ledger_failure_leaves_reservation_and_retry_pending(self):
        service = home_platform._connection_service
        calls = {"count": 0}
        original = service.ledger.append

        def fail_completion(**kwargs):
            if kwargs.get("state") == "completed" and calls["count"] == 0:
                calls["count"] += 1
                raise connections_agent.ContractError("ledger unavailable", 503, "state_unavailable")
            return original(**kwargs)

        with mock.patch.object(service.ledger, "append", side_effect=fail_completion):
            with self.assertRaises(connections_agent.ContractError):
                service.execute(action="create", source="manual", actor="manual.browser", target={"provider": "api"}, body={
                    "provider": "api", "name": "Reserved once", "scope_kind": "global", "status": "connected",
                }, expected_revision=None, idempotency_key="reserve-fault-0001")
        self.assertEqual(len(home_platform._connection_store()["connections"]), 1)
        retry = service.execute(action="create", source="manual", actor="manual.browser", target={"provider": "api"}, body={
            "provider": "api", "name": "Reserved once", "scope_kind": "global", "status": "connected",
        }, expected_revision=None, idempotency_key="reserve-fault-0001")
        self.assertTrue(retry["pending"])
        self.assertEqual(retry["action"]["state"], "running")

    def test_mutations_require_idempotency_and_strict_origin(self):
        missing_key = self.client.post("/api/connections", json={
            "provider": "api", "name": "Missing key", "scope_kind": "global",
        }, headers={"Origin": "http://localhost"})
        self.assertEqual(missing_key.status_code, 400)
        missing_origin = self.client.post("/api/connections", json={
            "provider": "api", "name": "Missing origin", "scope_kind": "global", "idempotency_key": "origin-test-0001",
        }, headers={"Origin": "null"})
        self.assertEqual(missing_origin.status_code, 403)

    def test_manual_delete_uses_plan_confirm_apply_sequence(self):
        connection = self._create()
        origin = {"Origin": "http://localhost"}
        planned_response = self.client.post("/api/connections/plan", json={
            "action": "delete", "connection_id": connection["id"],
            "expected_revision": connection["revision"], "idempotency_key": "manual-delete-plan-1",
        }, headers=origin)
        self.assertEqual(planned_response.status_code, 200, planned_response.get_json())
        planned = planned_response.get_json()["plan"]
        applied = self.client.post("/api/connections/apply", json={
            "plan_id": planned["plan_id"], "confirmation_token": planned["confirmation_token"],
            "idempotency_key": "manual-delete-apply-1",
        }, headers=origin)
        self.assertEqual(applied.status_code, 200, applied.get_json())
        self.assertEqual(applied.get_json()["removed"], connection["id"])
        self.assertEqual(self.client.get("/api/connections").get_json()["connections"], [])
        direct_delete = self.client.delete(f"/api/connections/{connection['id']}", headers={**origin, "Idempotency-Key": "manual-direct-delete-1"})
        self.assertEqual(direct_delete.status_code, 409)


if __name__ == "__main__":
    unittest.main()
