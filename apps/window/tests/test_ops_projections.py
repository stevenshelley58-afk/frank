import json
import hashlib
import hmac
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ops_projections import BLOCKWISE_PROJECT_ID, OPS_SCHEMA, OPS_SCHEMA_VERSION, BlockwiseOpsClient, OpsProjectionStore, PROJECTION_SPECS, ProjectionError, _customer_id, _masked_suffix, _safe_value, create_blueprint, publish_bundle
import control_plane_view
from flask import Flask

WORKSPACE = "123e4567-e89b-12d3-a456-426614174000"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def envelope(name, items, *, fresh_until=None):
    now = datetime.now(timezone.utc)
    if fresh_until is None:
        fresh_until = (now + timedelta(minutes=15)).isoformat().replace("+00:00", "Z")
    return {
        "schema": PROJECTION_SPECS[name]["schema"],
        "version": OPS_SCHEMA_VERSION,
        "projection": name,
        "project_id": BLOCKWISE_PROJECT_ID,
        "workspace_ids": [WORKSPACE],
        "source_scope": {"project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": [WORKSPACE], "system": name},
        "published_at": now.isoformat().replace("+00:00", "Z"),
        "fresh_until": fresh_until,
        "source_revision": "hermes-test-1",
        "source_receipt_ids": ["receipt:ops/source-test"],
        "publication_receipt_id": "receipt:ops/test",
        "items": items,
    }


class OpsProjectionApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = OpsProjectionStore(self.root)
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=self.store))
        self.client = app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, items, **kwargs):
        self.write_raw(name, envelope(name, items, **kwargs))

    def write_raw(self, name, value):
        generation = self.root / "generations" / "gen-test"
        generation.mkdir(parents=True, exist_ok=True)
        (generation / "publication-receipt.json").write_text(json.dumps({"schema": "schema://frank.ops-publication-receipt/v1", "project_id": "blockwise", "workspace_ids": [WORKSPACE], "publication_receipt_id": "receipt:ops/test", "source_revision": "hermes-test-1", "source_receipt_ids": ["receipt:ops/source-test"], "published_at": "2026-09-04T00:00:00Z", "projection_count": len(PROJECTION_SPECS)}), encoding="utf-8")
        (generation / PROJECTION_SPECS[name]["filename"]).write_text(json.dumps(value), encoding="utf-8")
        (self.root / "current.json").write_text(json.dumps({"schema": "schema://frank.ops-pointer/v1", "version": 1, "generation": "gen-test", "publication_receipt_id": "receipt:ops/test"}), encoding="utf-8")

    def test_missing_projection_is_setup_needed_and_never_fabricated(self):
        response = self.client.get("/api/ops/overview")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["schema"], OPS_SCHEMA)
        self.assertEqual(body["status"], "setup_needed")
        self.assertEqual(body["customers"], [])
        self.assertEqual(body["projections"]["billing"]["status"], "setup_needed")

    def test_schema_is_fail_closed_and_stale_is_visible(self):
        self.write_raw("customers", {"schema": "schema://unknown/v99", "items": []})
        response = self.client.get("/api/ops/projections/customers")
        self.assertEqual(response.get_json()["status"], "error")
        stale = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
        self.write("customers", [{"id": "cust_1", "workspace_id": WORKSPACE, "display_name": "A Customer", "email": "a@example.test", "notes": "must reject"}], fresh_until=stale)
        self.assertEqual(self.client.get("/api/ops/projections/customers").get_json()["status"], "error")
        self.write("customers", [{"id": "cust_1", "workspace_id": WORKSPACE, "display_name": "A Customer", "email": "a@example.test"}], fresh_until=stale)
        self.assertEqual(self.client.get("/api/ops/projections/customers").get_json()["status"], "stale")

    def test_customer_detail_correlates_safe_sections(self):
        self.write("customers", [{"id": "cust_1", "workspace_id": WORKSPACE, "display_name": "A Customer", "email": "a@example.test"}])
        self.write("email", [{"id": "mail_1", "customer_id": "cust_1", "workspace_id": WORKSPACE, "status": "delivered", "subject": "Welcome"}])
        self.write("billing", [{"id": "sub_1", "customer_id": "cust_1", "workspace_id": WORKSPACE, "status": "active", "billing_access_state": "active"}])
        self.store.record_action_receipt({"receipt_id": "receipt:ops/customer", "status": "completed", "target_id": "workspace:" + "cust_1"})
        self.store.record_action_receipt({"receipt_id": "receipt:ops/other", "status": "completed", "target_id": "workspace:other"})
        response = self.client.get("/api/ops/customers/cust_1")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["customer"]["email"], "a@example.test")
        self.assertEqual(body["sections"]["email"][0]["status"], "delivered")
        self.assertEqual(body["sections"]["billing"][0]["billing_access_state"], "active")
        self.assertEqual([item["receipt_id"] for item in body["action_receipts"]], ["receipt:ops/customer"])

    def test_action_is_forwarded_to_injected_hermes_boundary(self):
        calls = []

        class Dispatcher:
            def dispatch(self, **kwargs):
                calls.append(kwargs)
                return {"status": "accepted", "receipt_id": "receipt:ops/receipt-1"}

        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=self.store, dispatcher_factory=lambda: Dispatcher()))
        response = app.test_client().post("/api/ops/actions", json={
            "action_id": "tool:refresh-evidence",
            "target_id": "project:blockwise",
            "arguments": {"mode": "fast", "idempotency_key": "ops-key-1234"},
        }, headers={"X-Frank-Operator-Attestation": "operator requested refresh"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["receipt_id"], "receipt:ops/receipt-1")
        self.assertEqual(calls[0]["target_id"], "project:blockwise")
        retained = app.test_client().get("/api/ops/activity").get_json()["action_receipts"]
        self.assertEqual(retained[0]["receipt_id"], "receipt:ops/receipt-1")

    def test_publisher_writes_all_scoped_projections_atomically(self):
        receipt = publish_bundle({
            "project_id": "blockwise", "workspace_ids": [WORKSPACE],
            "source_revision": "hermes-revision-1", "source_receipt_ids": ["receipt:ops/source-test"],
            "projections": {**{name: [] for name in PROJECTION_SPECS}, "customers": [{"id": "cust-1", "workspace_id": WORKSPACE, "display_name": "Safe customer"}], "mautic": [{"id": "m-1", "customer_id": "cust-1", "workspace_id": WORKSPACE, "stage": "open"}]},
        }, self.root, now=1_800_000_000, freshness_seconds=900)
        self.assertTrue(receipt.startswith("receipt:ops/"))
        self.assertTrue((self.root / "current.json").is_file())
        generations = list((self.root / "generations").iterdir())
        self.assertEqual(len(generations), 1)
        self.assertTrue((generations[0] / "publication-receipt.json").is_file())
        self.assertEqual({path.name for path in generations[0].glob("*.json")} - {"publication-receipt.json"}, {spec["filename"] for spec in PROJECTION_SPECS.values()})
        self.assertEqual(self.store.load("customers").status, "ready")
        self.assertEqual(self.store.load("mautic").items[0]["stage"], "open")

    def test_wrong_project_workspace_and_secret_like_values_fail_closed(self):
        bad = envelope("customers", [{"id": "cust-1", "workspace_id": WORKSPACE, "display_name": "Safe"}])
        bad["project_id"] = "mini-frank"
        self.write_raw("customers", bad)
        self.assertEqual(self.store.load("customers").status, "error")
        bad["project_id"] = "blockwise"
        bad["workspace_ids"] = ["987e6543-e21b-12d3-a456-426614174000"]
        self.write_raw("customers", bad)
        self.assertEqual(self.store.load("customers").status, "error")
        bad = envelope("customers", [{"id": "cust-1", "workspace_id": WORKSPACE, "display_name": float("nan")}])
        self.write_raw("customers", bad)
        self.assertEqual(self.store.load("customers").status, "error")
        bad = envelope("customers", [{"id": "cust-1", "workspace_id": WORKSPACE, "display_name": "Safe"}])
        bad.pop("fresh_until")
        self.write_raw("customers", bad)
        self.assertEqual(self.store.load("customers").status, "error")

    def test_publisher_rejects_a_mismatched_source_scope(self):
        bundle = {
            "project_id": BLOCKWISE_PROJECT_ID,
            "workspace_ids": [WORKSPACE],
            "source_scope": {"project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": ["123e4567-e89b-12d3-a456-426614174001"]},
            "source_revision": "hermes-test-1",
            "source_receipt_ids": ["receipt:ops/source-test"],
            "projections": {name: [] for name in PROJECTION_SPECS},
        }
        with self.assertRaisesRegex(ProjectionError, "source scope"):
            publish_bundle(bundle, self.root)

    def test_safe_value_preserves_bounded_tags_and_segments_lists(self):
        self.assertEqual(_safe_value({"tags": ["trial", "priority"], "segments": ["au"]}), {"tags": ["trial", "priority"], "segments": ["au"]})

    def test_docker_layout_uses_canonical_app_governance_actions_path(self):
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(store=self.store))
        with patch("ops_projections.HermesDispatcher") as dispatcher:
            dispatcher.return_value.dispatch.return_value = {"status": "accepted", "receipt_id": "receipt:ops/test"}
            response = app.test_client().post("/api/ops/actions", json={"action_id": "tool:refresh-evidence", "target_id": "project:blockwise", "arguments": {"mode": "fast", "idempotency_key": "docker-path-test"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(dispatcher.call_args.args[0], control_plane_view.CONTROL_ROOT / "actions.yaml")

    def test_signed_client_paginates_blockwise_workspaces_and_fetches_details(self):
        calls = []
        customer_a = {"id": WORKSPACE, "name": "A", "owner": {"email": "owner@example.test", "full_name": "Owner A"}}
        workspace_b = "123e4567-e89b-12d3-a456-426614174001"
        customer_b = {"id": workspace_b, "name": "B"}
        class Response:
            status = 200
            def __init__(self, body, url): self.body, self.url = body, url
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, _): return json.dumps(self.body).encode()
            def geturl(self): return self.url
        def opener(request, timeout):
            calls.append(request)
            path = request.full_url.split("?", 1)[0]
            def envelope(data, receipt):
                return {"schema": "blockwise.ops.read.v1", "project_id": "blockwise", "generated_at": "2026-09-04T00:00:00.000Z", "fresh_until": "2026-09-04T00:05:00.000Z", "source_revision": "rev-a", "source_receipt_ids": [receipt], "data": data}
            if path.endswith("/customers") and "cursor=" not in request.full_url:
                return Response(envelope({"limit": 1, "total": 2, "nextCursor": "page-2", "rows": [customer_a]}, "receipt:ops/list-1"), request.full_url)
            if path.endswith("/customers"):
                return Response(envelope({"limit": 1, "total": 2, "nextCursor": None, "rows": [customer_b]}, "receipt:ops/list-2"), request.full_url)
            if path.endswith("/enquiries"):
                return Response(envelope({"limit": 1, "total": 1, "nextCursor": None, "rows": [{"id": "enquiry-1", "workspace_id": None, "status": "new", "subject": "Unassigned"}]}, "receipt:ops/enquiries"), request.full_url)
            row = customer_a if path.endswith(WORKSPACE) else customer_b
            snapshots = [{"id": "snapshot-1", "snapshot_kind": "delivery", "aggregate_type": "message", "aggregate_id": "provider-message-1", "status": "delivered", "subject": "Welcome"}] if row["id"] == WORKSPACE else []
            members = [{"workspace_id": row["id"], "profile_id": "profile-1", "role": "owner"}] if row["id"] == WORKSPACE else []
            profiles = [{"id": "profile-1", "email": "owner@example.test", "full_name": "Owner A"}] if row["id"] == WORKSPACE else []
            return Response(envelope({"workspace": {"id": row["id"], "name": row["name"]}, "members": members, "profiles": profiles, "activation": None, "bookings": [], "enquiries": [], "billing": None, "email": {"deliveries": []}, "projections": [], "activity": [], "providerSnapshots": snapshots}, "receipt:ops/detail"), request.full_url)
        client = BlockwiseOpsClient("https://blockwise.example", "x" * 40, opener=opener, clock=lambda: datetime(2026, 9, 4, tzinfo=timezone.utc).timestamp(), page_size=1)
        bundle = client.fetch_bundle()
        self.assertEqual(bundle["workspace_ids"], [WORKSPACE, workspace_b])
        self.assertEqual(len(bundle["projections"]["customers"]), 2)
        self.assertEqual(bundle["projections"]["customers"][0]["email"], "owner@example.test")
        self.assertEqual(next(row for row in bundle["projections"]["email"] if row.get("status") == "delivered")["status"], "delivered")
        self.assertTrue(bundle["projections"]["members"][0]["id"].startswith("member:"))
        self.assertIsNone(bundle["projections"]["flows"])
        self.assertNotIn("customer_id", bundle["projections"]["enquiries"][-1])
        signature = calls[0].get_header("X-blockwise-signature")
        self.assertRegex(signature, r"^[0-9a-f]{64}$")
        self.assertEqual(calls[0].get_header("X-blockwise-scope"), "ops.read")
        nonce = calls[0].get_header("X-blockwise-nonce")
        self.assertTrue(nonce)
        timestamp = calls[0].get_header("X-blockwise-timestamp")
        query = "limit=1"
        canonical = "v1\n" + timestamp + "\n" + nonce + "\nops.read\nGET\n/api/internal/ops/customers?" + query + "\n" + hashlib.sha256(b"").hexdigest()
        self.assertEqual(signature, hmac.new(("x" * 40).encode(), canonical.encode(), hashlib.sha256).hexdigest())

    def test_documented_public_envelopes_preserve_setup_for_omitted_snapshots(self):
        public_detail = json.loads((FIXTURES / "blockwise_ops_customer_detail.json").read_text(encoding="utf-8"))
        public_list = json.loads((FIXTURES / "blockwise_ops_customer_list.json").read_text(encoding="utf-8"))
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, _): return json.dumps(self.body).encode()
        def opener(request, timeout):
            path = request.full_url.split("?", 1)[0]
            if path.endswith("/customers"): return Response(public_list)
            if path.endswith("/enquiries"): return Response({**public_list, "data": {"limit": 1, "total": 0, "nextCursor": None, "rows": []}})
            return Response(public_detail)
        client = BlockwiseOpsClient("https://blockwise.example", "x" * 40, opener=opener, page_size=1)
        bundle = client.fetch_bundle()
        self.assertEqual(bundle["source_revision"], "blockwise-ops-read-v1")
        self.assertEqual(bundle["projections"]["email"][0]["status"], "delivered")
        self.assertEqual(bundle["projections"]["email"][1]["preferences"], ["transactional"])
        self.assertIsNone(bundle["projections"]["mautic"])

    def test_client_rejects_expired_source_and_non_string_cursor(self):
        public_list = json.loads((FIXTURES / "blockwise_ops_customer_list.json").read_text(encoding="utf-8"))
        expired = {**public_list, "fresh_until": "2020-01-01T00:00:00.000Z"}
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, _): return json.dumps(self.body).encode()
        with self.assertRaisesRegex(ProjectionError, "expired"):
            BlockwiseOpsClient("https://blockwise.example", "x" * 40, opener=lambda request, timeout: Response(expired), page_size=1).fetch_bundle()

        bad_cursor = {**public_list, "data": {**public_list["data"], "nextCursor": 0}}
        with self.assertRaisesRegex(ProjectionError, "cursor"):
            BlockwiseOpsClient("https://blockwise.example", "x" * 40, opener=lambda request, timeout: Response(bad_cursor), page_size=1).fetch_bundle()

    def test_publisher_rejects_unmasked_provider_record_suffix(self):
        projections = {name: [] for name in PROJECTION_SPECS}
        projections["email"] = [{
            "id": "mail-1", "customer_id": WORKSPACE, "workspace_id": WORKSPACE,
            "status": "delivered", "provider_record_suffix": "chatwoot-provider-123",
        }]
        with self.assertRaisesRegex(ProjectionError, "failed projection validation"):
            publish_bundle({
                "project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": [WORKSPACE],
                "source_revision": "hermes-test-1", "source_receipt_ids": ["receipt:ops/source-test"],
                "projections": projections,
            }, self.root, now=1_800_000_000)
        self.assertEqual(_masked_suffix("provider-message-1234"), "****1234")

    def test_client_rejects_customer_association_on_global_enquiry(self):
        now = datetime.now(timezone.utc)
        fresh_until = (now + timedelta(minutes=15)).isoformat().replace("+00:00", "Z")
        def envelope(data):
            return {
                "schema": "blockwise.ops.read.v1", "project_id": BLOCKWISE_PROJECT_ID,
                "generated_at": now.isoformat().replace("+00:00", "Z"), "fresh_until": fresh_until,
                "source_revision": "blockwise-test-revision", "source_receipt_ids": ["receipt:ops/source-test"],
                "data": data,
            }
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, _): return json.dumps(self.body).encode()
        def opener(request, timeout):
            if request.full_url.split("?", 1)[0].endswith("/customers"):
                return Response(envelope({"limit": 1, "total": 0, "nextCursor": None, "rows": []}))
            return Response(envelope({
                "limit": 1, "total": 1, "nextCursor": None,
                "rows": [{"id": "enquiry-global-1", "workspace_id": None, "customer_id": WORKSPACE, "status": "new"}],
            }))
        client = BlockwiseOpsClient(
            "https://blockwise.example", "x" * 40, opener=opener,
            clock=lambda: now.timestamp(), page_size=1,
        )
        with self.assertRaisesRegex(ProjectionError, "customer association"):
            client.fetch_bundle()

    def test_local_global_enquiry_cannot_publish_load_or_correlate(self):
        projections = {name: [] for name in PROJECTION_SPECS}
        projections["customers"] = [{"id": "cust-1", "workspace_id": WORKSPACE, "display_name": "Safe customer"}]
        projections["enquiries"] = [{
            "id": "enquiry-global-1", "workspace_id": None, "customer_id": "cust-1", "status": "new",
        }]
        with self.assertRaisesRegex(ProjectionError, "failed projection validation"):
            publish_bundle({
                "project_id": BLOCKWISE_PROJECT_ID, "workspace_ids": [WORKSPACE],
                "source_revision": "hermes-test-1", "source_receipt_ids": ["receipt:ops/source-test"],
                "projections": projections,
            }, self.root, now=1_800_000_000)

        # A forged local envelope must fail closed on load and cannot leak into
        # a customer's detail response through the generic correlation helper.
        self.write("customers", projections["customers"])
        self.write("enquiries", projections["enquiries"])
        self.assertEqual(self.store.load("enquiries").status, "error")
        self.assertIsNone(_customer_id(projections["enquiries"][0]))
        response = self.client.get("/api/ops/customers/cust-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["sections"]["enquiries"], [])

    def test_client_preserves_detail_email_activation_and_projection_state(self):
        now = datetime(2026, 9, 4, tzinfo=timezone.utc)
        def env(data, receipt):
            return {"schema": "blockwise.ops.read.v1", "project_id": BLOCKWISE_PROJECT_ID,
                    "generated_at": now.isoformat().replace("+00:00", "Z"),
                    "fresh_until": "2026-09-04T00:05:00Z", "source_revision": "rev-source",
                    "source_receipt_ids": [receipt], "data": data}
        detail = {"workspace": {"id": WORKSPACE, "name": "Fixture"}, "members": [], "profiles": [],
                  "activation": {"stage": "active", "activation_completed_at": "2026-09-03T00:00:00Z"},
                  "bookings": [], "enquiries": [], "billing": None,
                  "email": {"preferences": ["transactional"], "suppressions": ["marketing"],
                            "deliveries": [{"id": "delivery-1", "status": "delivered"}]},
                  "projections": [{"name": "email", "status": "ready", "source_revision": "rev-source",
                                   "source_receipt_ids": ["receipt:ops/detail"], "fresh_until": "2026-09-04T00:05:00Z"}],
                  "activity": []}
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, _): return json.dumps(self.body).encode()
        def opener(request, timeout):
            path = request.full_url.split("?", 1)[0]
            if path.endswith("/customers"):
                return Response(env({"limit": 1, "total": 1, "nextCursor": None,
                                     "rows": [{"id": WORKSPACE, "name": "Fixture"}]}, "receipt:ops/list"))
            if path.endswith("/enquiries"):
                return Response(env({"limit": 1, "total": 0, "nextCursor": None, "rows": []}, "receipt:ops/global"))
            return Response(env(detail, "receipt:ops/detail"))
        bundle = BlockwiseOpsClient("https://blockwise.example", "x" * 40, opener=opener,
                                    clock=lambda: now.timestamp(), page_size=1).fetch_bundle()
        customer = bundle["projections"]["customers"][0]
        self.assertEqual(customer["activation_stage"], "active")
        self.assertEqual(customer["email_preferences"], ["transactional"])
        self.assertEqual(customer["email_suppressions"], ["marketing"])
        self.assertTrue(any(row.get("id") == "delivery-1" for row in bundle["projections"]["email"]))
        self.assertEqual(bundle["projections"]["activity"][0]["projection_name"], "email")

    def test_client_rejects_detail_workspace_customer_mismatch_before_normalization(self):
        now = datetime.now(timezone.utc)
        def env(data):
            return {"schema": "blockwise.ops.read.v1", "project_id": BLOCKWISE_PROJECT_ID,
                    "generated_at": now.isoformat().replace("+00:00", "Z"),
                    "fresh_until": (now + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
                    "source_revision": "rev-source", "source_receipt_ids": ["receipt:ops/source"], "data": data}
        class Response:
            status = 200
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, _): return json.dumps(self.body).encode()
        def opener(request, timeout):
            path = request.full_url.split("?", 1)[0]
            if path.endswith("/customers"):
                return Response(env({"limit": 1, "total": 1, "nextCursor": None, "rows": [{"id": WORKSPACE}]}))
            if path.endswith("/enquiries"):
                return Response(env({"limit": 1, "total": 0, "nextCursor": None, "rows": []}))
            return Response(env({"workspace": {"id": WORKSPACE}, "members": [{"workspace_id": "123e4567-e89b-12d3-a456-426614174001"}],
                                 "profiles": [], "activation": None, "bookings": [], "enquiries": [], "billing": None,
                                 "email": {"deliveries": []}, "projections": [], "activity": []}))
        with self.assertRaisesRegex(ProjectionError, "workspace"):
            BlockwiseOpsClient("https://blockwise.example", "x" * 40, opener=opener,
                               clock=lambda: now.timestamp(), page_size=1).fetch_bundle()

    def test_fresh_until_equal_clock_is_stale(self):
        clock = 1_800_000_000
        store = OpsProjectionStore(self.root, clock=lambda: clock)
        fresh = datetime.fromtimestamp(clock, timezone.utc).isoformat().replace("+00:00", "Z")
        self.write_raw("customers", envelope("customers", [{"id": "cust-1", "workspace_id": WORKSPACE}], fresh_until=fresh))
        self.assertEqual(store.load("customers").status, "stale")

    def test_global_enquiry_queue_is_separate_and_never_correlates(self):
        self.write("customers", [{"id": "cust-1", "workspace_id": WORKSPACE, "display_name": "Customer"}])
        self.write("enquiries", [{"id": "global-1", "workspace_id": None, "status": "new"},
                                  {"id": "assigned-1", "workspace_id": WORKSPACE, "customer_id": "cust-1", "status": "open"}])
        body = self.client.get("/api/ops/enquiries/unassigned").get_json()
        self.assertEqual(body["status"], "ready")
        self.assertEqual([row["id"] for row in body["enquiries"]], ["global-1"])
        self.assertEqual(self.client.get("/api/ops/customers/cust-1").get_json()["sections"]["enquiries"][0]["id"], "assigned-1")
if __name__ == "__main__":
    unittest.main()
