import hashlib
import hmac
import json
import os
import tempfile
import unittest
import urllib.error
from io import BytesIO
from email.message import Message
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from customer_ops_actions import ActionIntentJournal, CustomerOpsActionError, CustomerOpsControlClient, _safe_file, _secret, create_blueprint
from ops_projections import ProjectionError, ProjectionSnapshot, _safe_item

WORKSPACE = "123e4567-e89b-12d3-a456-426614174000"
OPERATOR = "123e4567-e89b-12d3-a456-426614174001"
ACTION = "123e4567-e89b-12d3-a456-426614174002"


class FakeStore:
    def __init__(self):
        self.snapshots = {name: ProjectionSnapshot(name, "ready", []) for name in ("customers", "email", "flows", "mautic", "enquiries", "bookings", "billing", "activity", "members")}
        self.snapshots["customers"] = ProjectionSnapshot("customers", "ready", [{"id": WORKSPACE, "workspace_id": WORKSPACE, "ops_version": 7}])
        self.snapshots["billing"] = ProjectionSnapshot("billing", "ready", [{"id": WORKSPACE, "workspace_id": WORKSPACE, "customer_id": WORKSPACE, "ops_version": 2}])

    def all(self):
        return self.snapshots

    def action_capabilities(self):
        available = {"team_invite", "team_resend", "team_cancel", "session_revoke", "enquiry_assign", "billing_reconcile"}
        target_types = {
            "team_invite": "workspace", "team_resend": "invitation", "team_cancel": "invitation", "team_role_change": "profile", "team_suspend": "profile", "team_reactivate": "profile", "session_revoke": "session", "consent_grant": "profile", "consent_withdraw": "profile", "consent_unsubscribe": "profile", "suppression_add": "profile", "suppression_remove": "profile", "enquiry_assign": "enquiry", "enquiry_close": "enquiry", "enquiry_reply": "enquiry", "enquiry_reopen": "enquiry", "flow_enroll": "profile", "flow_pause": "profile", "flow_resume": "profile", "booking_cancel": "booking", "booking_reschedule": "booking", "billing_reconcile": "billing", "billing_cancel_at_period_end": "billing", "billing_portal_link": "billing",
        }
        return {"status": "ready", "actions": {action: {"action": action, "target_type": target, "capability": "available" if action in available else "capability_required", "workspace_ids": [WORKSPACE]} for action, target in target_types.items()}}


class FakeClient:
    def __init__(self):
        self.envelopes = []

    def enqueue(self, envelope):
        self.envelopes.append(envelope)
        return {"schema": "schema://frank.ops-action-receipt/v1", "action_id": envelope["actionId"], "status": "queued", "correlation_id": "corr-12345678"}


class Response:
    status = 200

    def __init__(self, body, url="https://control.example/v1/control/actions", status=200):
        self.body, self.url, self.status = body, url, status
        self.headers = Message()
        self.headers["Content-Type"] = "application/json"

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
        if os.name != "nt":
            (root / "secret").chmod(0o600)
            (root / "operator").chmod(0o600)
        self.env = patch.dict(os.environ, {
            "FRANK_OPS_CONTROL_URL": "https://control.example",
            "FRANK_OPS_CONTROL_SECRET_FILE": str(root / "secret"),
            "FRANK_OPS_OPERATOR_ID_FILE": str(root / "operator"),
            "FRANK_OPS_ACTION_JOURNAL_FILE": str(root / "journal.json"),
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
            "target_type": "billing", "target_id": WORKSPACE,
            "expected_version": 2, "reason": "Review failed invoice state", "payload": {},
        })
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.client_boundary.envelopes[0]["actor"], {"operatorId": OPERATOR, "role": "support", "aal": "aal2"})
        self.assertNotIn("FRANK_OPS_CONTROL_SECRET_FILE", json.dumps(response.get_json()))

    def test_capabilities_are_published_projection_and_missing_source_fails_closed(self):
        response = self.client.get("/api/ops/action-capabilities")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["schema"], "schema://blockwise.ops-action-capabilities/v1")
        self.assertEqual(len(response.get_json()["actions"]), 24)

        class MissingCapabilities:
            def __init__(self):
                self.base = FakeStore()

            def all(self):
                return self.base.all()

        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=MissingCapabilities(), client_factory=lambda: self.client_boundary))
        response = app.test_client().post("/api/ops/customer-actions", json={
            "action": "billing_reconcile", "workspace_id": WORKSPACE, "customer_id": WORKSPACE,
            "target_type": "billing", "target_id": WORKSPACE, "expected_version": 2,
            "reason": "Review failed invoice state", "payload": {},
        })
        self.assertEqual(response.status_code, 409)

    def test_enquiry_messages_use_bounded_internal_chronological_schema(self):
        item = {"id": "enquiry-1", "workspace_id": WORKSPACE, "messages": [{
            "id": "message-1", "direction": "incoming", "sender": "Customer",
            "body": "A" * 1000, "occurred_at": "2026-09-05T00:00:00Z", "attachments": [],
        }]}
        self.assertEqual(len(_safe_item("enquiries", item)["messages"][0]["body"]), 1000)
        self.assertEqual(_safe_item("enquiries", {**item, "messages": [{**item["messages"][0], "body": "password: sk_12345678901234567890"}]})["messages"][0]["body"], "[redacted]")
        with self.assertRaises(ProjectionError):
            _safe_item("enquiries", {**item, "messages": [{**item["messages"][0], "body": "ok", "unknown": "x"}]})
        with self.assertRaises(ProjectionError):
            _safe_item("enquiries", {**item, "messages": [{"id": "message-2", "direction": "incoming", "sender": "Customer", "body": "later", "occurred_at": "2026-09-05T00:01:00Z", "attachments": []}, item["messages"][0]]})

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
        with patch.dict(os.environ, {"FRANK_OPS_OPERATOR_ROLE": "owner"}):
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
                "receiptIds": [ACTION], "correlationId": "corr-12345678",
                "latestReceipt": {"receipt_id": ACTION, "status": "succeeded", "transition_seq": 2,
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
            return Response(json.dumps({
                "schema": "blockwise.ops.action.v1", "actionId": ACTION,
                "status": "pending", "capability": "available", "correlationId": "corr-12345678",
            }).encode(), status=202)

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

    def test_http_error_status_is_preserved_and_detail_is_not_exposed(self):
        headers = Message()
        headers["Content-Type"] = "application/json"

        def opener(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 409, "conflict", headers, BytesIO(b'{"error":"stale"}'))

        with patch.dict(os.environ, {"FRANK_OPS_CONTROL_URL": "https://control.example"}):
            with self.assertRaisesRegex(Exception, "action was not accepted") as caught:
                CustomerOpsControlClient(opener=opener, clock=lambda: 1_800_000_000).enqueue({})
        self.assertEqual(caught.exception.status, 409)
        self.assertNotIn("stale", str(caught.exception))

    def test_success_requires_json_contract_and_exact_http_status(self):
        def opener(req, timeout):
            return Response(b'{"schema":"blockwise.ops.action.v1"}', status=200)

        with patch.dict(os.environ, {"FRANK_OPS_CONTROL_URL": "https://control.example"}):
            with self.assertRaises(CustomerOpsActionError):
                CustomerOpsControlClient(opener=opener, clock=lambda: 1_800_000_000).enqueue({})

        def wrong_content_type(req, timeout):
            response = Response(b'{}', status=202)
            response.headers["Content-Type"] = "text/plain"
            return response

        with patch.dict(os.environ, {"FRANK_OPS_CONTROL_URL": "https://control.example"}):
            with self.assertRaises(CustomerOpsActionError):
                CustomerOpsControlClient(opener=wrong_content_type, clock=lambda: 1_800_000_000).enqueue({})

    def test_oversized_json_is_413_even_without_content_length(self):
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=FakeStore(), client_factory=lambda: self.client_boundary))
        response = app.test_client().post(
            "/api/ops/customer-actions", data=b"{" + b"a" * 32768 + b"}", content_type="text/plain"
        )
        self.assertEqual(response.status_code, 413)

    @unittest.skipIf(os.name == "nt", "POSIX file metadata is not portable to Windows")
    def test_secret_parent_directory_is_owned_and_private(self):
        # The fixture's secret parent is the TemporaryDirectory root.  A
        # world-readable mount must fail closed even when the file itself is
        # mode 0600 and owned by the runtime.
        secret_path = Path(os.environ["FRANK_OPS_CONTROL_SECRET_FILE"])
        secret_path.parent.chmod(0o755)
        self.assertEqual(_secret(), "s" * 48)
        secret_path.parent.chmod(0o777)
        try:
            with self.assertRaises(CustomerOpsActionError):
                _secret()
        finally:
            secret_path.parent.chmod(0o700)

    @unittest.skipIf(os.name == "nt", "POSIX file metadata is not portable to Windows")
    def test_unsafe_ancestor_directory_is_rejected(self):
        secret_path = Path(os.environ["FRANK_OPS_CONTROL_SECRET_FILE"])
        nested = secret_path.parent / "nested"
        nested.mkdir()
        nested_secret = nested / "secret"
        nested_secret.write_text("s" * 48, encoding="utf-8")
        nested_secret.chmod(0o600)
        secret_path.parent.chmod(0o777)
        try:
            with self.assertRaises(CustomerOpsActionError):
                _safe_file(str(nested_secret), name="nested secret")
        finally:
            secret_path.parent.chmod(0o700)
            nested_secret.unlink()
            nested.rmdir()

    def test_lost_post_response_reuses_durable_identity_after_frank_restart(self):
        body = {
            "action": "billing_reconcile", "workspace_id": WORKSPACE, "customer_id": WORKSPACE,
            "target_type": "billing", "target_id": WORKSPACE, "expected_version": 2,
            "reason": "Reconcile after a lost response", "payload": {},
        }
        first_calls = []

        class LostResponseClient:
            def enqueue(self, envelope):
                first_calls.append(envelope)
                raise CustomerOpsActionError("customer operations control edge is unavailable", 503)

        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=FakeStore(), client_factory=LostResponseClient))
        self.assertEqual(app.test_client().post("/api/ops/customer-actions", json=body).status_code, 503)
        self.assertEqual(len(first_calls), 1)

        second_calls = []

        class RecoveryClient:
            def enqueue(self, envelope):
                second_calls.append(envelope)
                return {"schema": "schema://frank.ops-action-receipt/v1", "action_id": envelope["actionId"], "status": "queued", "correlation_id": "corr-12345678"}

        restarted = Flask(__name__)
        restarted.register_blueprint(create_blueprint(store=FakeStore(), client_factory=RecoveryClient))
        self.assertEqual(restarted.test_client().post("/api/ops/customer-actions", json=body).status_code, 202)
        self.assertEqual(len(second_calls), 1)
        self.assertEqual(second_calls[0]["actionId"], first_calls[0]["actionId"])
        self.assertEqual(second_calls[0]["idempotencyKey"], first_calls[0]["idempotencyKey"])

    def test_durable_journal_rejects_key_fingerprint_conflicts(self):
        journal = ActionIntentJournal(Path(os.environ["FRANK_OPS_ACTION_JOURNAL_FILE"]))
        envelope = {"actionId": ACTION, "idempotencyKey": "frank:conflict-key", "actor": {"operatorId": OPERATOR}, "action": "billing_reconcile", "workspaceId": WORKSPACE, "customerId": WORKSPACE, "target": {"type": "billing", "id": WORKSPACE}, "expectedVersion": 2, "reason": "First intent", "payload": {}}
        journal.reserve(OPERATOR, "a" * 64, envelope)
        changed = dict(envelope, actionId="123e4567-e89b-12d3-a456-426614174004", reason="Different intent")
        with self.assertRaisesRegex(CustomerOpsActionError, "idempotency key conflicts"):
            journal.reserve(OPERATOR, "b" * 64, changed)

    def test_terminal_receipt_allows_only_a_new_identity(self):
        journal = ActionIntentJournal(Path(os.environ["FRANK_OPS_ACTION_JOURNAL_FILE"]))
        envelope = {"actionId": ACTION, "idempotencyKey": "frank:terminal-key", "actor": {"operatorId": OPERATOR}, "action": "billing_reconcile", "workspaceId": WORKSPACE, "customerId": WORKSPACE, "target": {"type": "billing", "id": WORKSPACE}, "expectedVersion": 2, "reason": "Terminal intent", "payload": {}}
        journal.reserve(OPERATOR, "c" * 64, envelope)
        journal.mark(ACTION, "succeeded", "corr-12345678")
        _, reused, terminal = journal.reserve(OPERATOR, "c" * 64, envelope)
        self.assertTrue(reused)
        self.assertTrue(terminal)
        new_envelope = dict(envelope, actionId="123e4567-e89b-12d3-a456-426614174004", idempotencyKey="frank:new-terminal-key")
        _, reused, terminal = journal.reserve(OPERATOR, "d" * 64, new_envelope)
        self.assertFalse(reused)
        self.assertFalse(terminal)

    def test_unresolved_reservation_is_not_pruned_after_retention_window(self):
        now = [0.0]
        journal = ActionIntentJournal(Path(os.environ["FRANK_OPS_ACTION_JOURNAL_FILE"]), clock=lambda: now[0])
        envelope = {"actionId": ACTION, "idempotencyKey": "frank:retention-key", "actor": {"operatorId": OPERATOR}, "action": "billing_reconcile", "workspaceId": WORKSPACE, "customerId": WORKSPACE, "target": {"type": "billing", "id": WORKSPACE}, "expectedVersion": 2, "reason": "Unresolved intent", "payload": {}}
        journal.reserve(OPERATOR, "e" * 64, envelope)
        now[0] = 30 * 24 * 60 * 60
        _, reused, terminal = journal.reserve(OPERATOR, "e" * 64, dict(envelope, actionId="123e4567-e89b-12d3-a456-426614174004", idempotencyKey="frank:new-retention-key"))
        self.assertTrue(reused)
        self.assertFalse(terminal)

    def test_ambiguous_http_409_reuses_identity_after_restart(self):
        body = {
            "action": "billing_reconcile", "workspace_id": WORKSPACE, "customer_id": WORKSPACE,
            "target_type": "billing", "target_id": WORKSPACE, "expected_version": 2,
            "reason": "Reconcile quarantined delivery", "payload": {},
        }
        first_calls = []

        class ConflictClient:
            def enqueue(self, envelope):
                first_calls.append(envelope)
                raise CustomerOpsActionError("action was not accepted by the control edge", 409)

        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=FakeStore(), client_factory=ConflictClient))
        self.assertEqual(app.test_client().post("/api/ops/customer-actions", json=body).status_code, 409)

        second_calls = []

        class RecoveryClient:
            def enqueue(self, envelope):
                second_calls.append(envelope)
                return {"schema": "schema://frank.ops-action-receipt/v1", "action_id": envelope["actionId"], "status": "queued", "correlation_id": "corr-12345678"}

        restarted = Flask(__name__)
        restarted.register_blueprint(create_blueprint(store=FakeStore(), client_factory=RecoveryClient))
        self.assertEqual(restarted.test_client().post("/api/ops/customer-actions", json=body).status_code, 202)
        self.assertEqual(second_calls[0]["actionId"], first_calls[0]["actionId"])
        self.assertEqual(second_calls[0]["idempotencyKey"], first_calls[0]["idempotencyKey"])


if __name__ == "__main__":
    unittest.main()
