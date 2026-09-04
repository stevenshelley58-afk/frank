import hashlib
import hmac
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from customer_ops_actions import CustomerOpsControlClient, create_blueprint
from ops_projections import ProjectionSnapshot

WORKSPACE = "123e4567-e89b-12d3-a456-426614174000"
OPERATOR = "123e4567-e89b-12d3-a456-426614174001"
ACTION = "123e4567-e89b-12d3-a456-426614174002"


class FakeStore:
    def __init__(self):
        self.snapshots = {name: ProjectionSnapshot(name, "ready", []) for name in ("customers", "email", "flows", "mautic", "enquiries", "bookings", "billing", "activity", "members")}
        self.snapshots["customers"] = ProjectionSnapshot("customers", "ready", [{"id": WORKSPACE, "workspace_id": WORKSPACE, "ops_version": 7}])
        self.snapshots["billing"] = ProjectionSnapshot("billing", "ready", [{"id": "123e4567-e89b-12d3-a456-426614174003", "workspace_id": WORKSPACE, "customer_id": WORKSPACE, "ops_version": 2}])

    def all(self):
        return self.snapshots


class FakeClient:
    def __init__(self):
        self.envelopes = []

    def enqueue(self, envelope):
        self.envelopes.append(envelope)
        return {"schema": "schema://frank.ops-action-receipt/v1", "action_id": ACTION, "status": "queued", "correlation_id": None}


class Response:
    status = 200

    def __init__(self, body, url="https://control.example/v1/control/actions"):
        self.body, self.url = body, url

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self, limit=-1):
        return self.body

    def geturl(self):
        return self.url


class CustomerOpsActionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / "secret").write_text("s" * 48, encoding="utf-8")
        (root / "operator").write_text(OPERATOR, encoding="utf-8")
        self.env = patch.dict(os.environ, {
            "FRANK_OPS_CONTROL_URL": "https://control.example",
            "FRANK_OPS_CONTROL_SECRET_FILE": str(root / "secret"),
            "FRANK_OPS_OPERATOR_ID_FILE": str(root / "operator"),
            "FRANK_OPS_OPERATOR_ROLE": "support",
            "FRANK_OPS_OPERATOR_AAL": "aal2",
        })
        self.env.start()
        self.client_boundary = FakeClient()
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=FakeStore(), client_factory=lambda: self.client_boundary))
        self.client = app.test_client()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_action_is_typed_scoped_and_operator_fields_are_server_derived(self):
        response = self.client.post("/api/ops/customer-actions", json={
            "action": "billing_reconcile", "workspace_id": WORKSPACE, "customer_id": WORKSPACE,
            "target_type": "billing", "target_id": "123e4567-e89b-12d3-a456-426614174003",
            "expected_version": 2, "reason": "Review failed invoice state", "payload": {},
        })
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.client_boundary.envelopes[0]["actor"], {"operatorId": OPERATOR, "role": "support", "aal": "aal2"})
        self.assertNotIn("FRANK_OPS_CONTROL_SECRET_FILE", json.dumps(response.get_json()))

    def test_unsupported_and_stale_actions_fail_closed(self):
        response = self.client.post("/api/ops/customer-actions", json={"action": "enquiry_reply", "workspace_id": WORKSPACE, "customer_id": WORKSPACE, "target_type": "enquiry", "target_id": ACTION, "expected_version": 1, "reason": "reply", "payload": {"body": "hello"}})
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/ops/customer-actions", json={"action": "billing_reconcile", "workspace_id": WORKSPACE, "customer_id": WORKSPACE, "target_type": "billing", "target_id": "123e4567-e89b-12d3-a456-426614174003", "expected_version": 0, "reason": "retry", "payload": {}})
        self.assertEqual(response.status_code, 409)

    def test_cross_site_action_is_rejected_before_operator_lookup(self):
        response = self.client.post(
            "/api/ops/customer-actions",
            json={"action": "billing_reconcile"},
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "same_origin_required")

    def test_team_invite_and_session_targets_are_exactly_scoped(self):
        invite = self.client.post("/api/ops/customer-actions", json={
            "action": "team_invite", "workspace_id": WORKSPACE, "customer_id": WORKSPACE,
            "target_type": "workspace", "target_id": ACTION, "expected_version": 7,
            "reason": "Invite the support operator", "payload": {"email": "new@example.test", "role": "member"},
        })
        self.assertEqual(invite.status_code, 422)
        session = self.client.post("/api/ops/customer-actions", json={
            "action": "session_revoke", "workspace_id": WORKSPACE, "customer_id": WORKSPACE,
            "target_type": "session", "target_id": ACTION, "expected_version": 7,
            "reason": "Revoke the stale session", "payload": {},
        })
        self.assertEqual(session.status_code, 409)

    def test_status_receipt_drops_provider_result_and_error_payloads(self):
        def opener(req, timeout):
            return Response(json.dumps({
                "actionId": ACTION, "workspaceId": WORKSPACE, "status": "succeeded",
                "receiptIds": ["receipt-1"], "correlationId": "corr-12345678",
                "latestReceipt": {"receipt_id": "receipt-1", "status": "succeeded", "transition_seq": 2,
                                   "created_at": "2026-09-05T00:00:00Z", "safe_result": {"email": "pii@example.test"},
                                   "safe_error": {"provider": "secret"}},
            }).encode(), url=f"https://control.example/v1/control/actions/{ACTION}")

        with patch.dict(os.environ, {"FRANK_OPS_CONTROL_URL": "https://control.example"}):
            client = CustomerOpsControlClient(opener=opener, clock=lambda: 1_800_000_000)
            result = client.status(ACTION, WORKSPACE)
        self.assertEqual(set(result["latest_receipt"]), {"receipt_id", "status", "transition_seq", "created_at"})

    def test_hmac_request_uses_canonical_path_and_never_bearer(self):
        seen = []

        def opener(req, timeout):
            seen.append(req)
            return Response(b'{"actionId":"' + ACTION.encode() + b'","status":"queued"}')

        now = 1_800_000_000
        with patch.dict(os.environ, {"FRANK_OPS_CONTROL_URL": "https://control.example"}):
            result = CustomerOpsControlClient(opener=opener, clock=lambda: now).enqueue({"schema": "blockwise.ops.action.v1"})
        self.assertEqual(result["action_id"], ACTION)
        req = seen[0]
        self.assertIsNone(req.get_header("Authorization"))
        body = req.data.decode()
        canonical = "\n".join(("v1", req.get_header("X-blockwise-timestamp"), req.get_header("X-blockwise-nonce"), "ops.write", "POST", "/v1/control/actions", hashlib.sha256(body.encode()).hexdigest()))
        secret = "s" * 48
        self.assertEqual(req.get_header("X-blockwise-signature"), hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest())


if __name__ == "__main__":
    unittest.main()
