import base64
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

import home_platform
import home_providers
import server


class ContractTestClient:
    """Keep mutation tests explicit about same-origin and idempotency contracts."""

    def __init__(self, client):
        self._client = client
        self._sequence = 0

    def _mutation(self, method, *args, **kwargs):
        self._sequence += 1
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Origin", "http://localhost")
        headers.setdefault("Idempotency-Key", f"home-platform-test-{self._sequence:06d}")
        kwargs["headers"] = headers
        return getattr(self._client, method)(*args, **kwargs)

    def get(self, *args, **kwargs):
        return self._client.get(*args, **kwargs)

    def put(self, *args, **kwargs):
        return self._mutation("put", *args, **kwargs)

    def post(self, *args, **kwargs):
        return self._mutation("post", *args, **kwargs)

    def patch(self, *args, **kwargs):
        return self._mutation("patch", *args, **kwargs)

    def delete(self, *args, **kwargs):
        return self._mutation("delete", *args, **kwargs)


class HomePlatformApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_home_file = home_platform.HOME_STORE_FILE
        self.original_connections_file = home_platform.CONNECTIONS_FILE
        self.original_actions_file = home_platform.CONNECTION_ACTIONS_FILE
        self.original_plans_file = home_platform.CONNECTION_PLANS_FILE
        self.original_loaders = (
            home_platform._project_loader,
            home_platform._account_loader,
            home_platform._hermes_health,
            home_platform._roots,
        )
        home_platform.HOME_STORE_FILE = Path(self.temp.name) / "home-layouts.json"
        home_platform.CONNECTIONS_FILE = Path(self.temp.name) / "connections.json"
        home_platform.CONNECTION_ACTIONS_FILE = Path(self.temp.name) / "connection-actions.jsonl"
        home_platform.CONNECTION_PLANS_FILE = Path(self.temp.name) / "connection-plans.json"
        self.project_root = Path(self.temp.name) / "vps" / "projects" / "blockwise"
        (self.project_root / ".git").mkdir(parents=True)
        (self.project_root / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        home_platform.configure(
            project_loader=lambda: [{
                "id": "blockwise", "name": "Blockwise", "root": "blockwise",
                "live": "https://blockwise.example", "blurb": "Sales intelligence.",
                "default_widgets": [
                    "entity-overview", "application-status", "connections-summary",
                    "accounts-summary", "repository-status", "analytics-summary",
                ],
            }],
            account_loader=lambda: [
                {"id": "customer-1", "project_id": "blockwise", "kind": "customer", "status": "ready"},
                {"id": "email-1", "project_id": "blockwise", "kind": "email", "status": "attention"},
            ],
            hermes_health=lambda: {"ok": True, "profile": "hub"},
            roots={"vps": Path(self.temp.name) / "vps"},
        )
        self.client = ContractTestClient(server.app.test_client())

    def test_canonical_project_profiles_are_enriched_and_returned_as_copies(self):
        profiles = {item["id"]: item for item in server._project_items()}
        self.assertEqual(profiles["blockwise"]["live"], "https://blockwise.sale")
        self.assertEqual(profiles["blockwise"]["health"], "https://blockwise.sale/api/health")
        self.assertEqual(profiles["elfwonder"]["root"], "elfandwonder")
        self.assertNotIn("live", profiles["merrypaws"])
        self.assertEqual(profiles["pavone"]["root"], "pavone-demo")
        self.assertEqual(profiles["pavone"]["live"], "https://pavoneauto.com")
        profiles["blockwise"]["capabilities"].clear()
        self.assertTrue(server._project_items()[0]["capabilities"])

    def test_health_probe_is_allowlisted_cached_and_fail_closed(self):
        class Response:
            status = 204

            def getcode(self):
                return self.status

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        home_providers._probe_cache.clear()
        allowed_urls = {item["health"] for item in server.DEFAULT_PROJECTS if item.get("health")}
        with patch.object(home_providers._NO_REDIRECT_OPENER, "open", return_value=Response()) as opener:
            first = home_providers.probe_profile_health(server.DEFAULT_PROJECTS[0], allowed_urls)
            second = home_providers.probe_profile_health(server.DEFAULT_PROJECTS[0], allowed_urls)
        self.assertTrue(first["ok"])
        self.assertFalse(first.get("cached", False))
        self.assertTrue(second["cached"])
        opener.assert_called_once()

        with patch.object(home_providers._NO_REDIRECT_OPENER, "open") as opener:
            rejected = home_providers.probe_profile_health({"health": "https://untrusted.example/health"}, allowed_urls)
        self.assertFalse(rejected["ok"])
        self.assertIn("allowlisted", rejected["reason"])
        opener.assert_not_called()

        home_providers._probe_cache.clear()
        with patch.object(home_providers._NO_REDIRECT_OPENER, "open", side_effect=OSError("offline")):
            failed = home_providers.probe_profile_health(server.DEFAULT_PROJECTS[0], allowed_urls)
        self.assertFalse(failed["ok"])
        self.assertIn("offline", failed["reason"])

        home_providers._probe_cache.clear()
        with patch.object(
            home_providers._NO_REDIRECT_OPENER,
            "open",
            side_effect=lambda request, timeout: (_ for _ in ()).throw(
                HTTPError(request.full_url, 302, "redirect", {"Location": "http://169.254.169.254/"}, None)
            ),
        ) as opener:
            redirected = home_providers.probe_profile_health(server.DEFAULT_PROJECTS[0], allowed_urls)
        self.assertFalse(redirected["ok"])
        self.assertEqual(redirected["status"], 302)
        opener.assert_called_once()

        class RedirectHandler(BaseHTTPRequestHandler):
            hits = 0

            def do_GET(self):
                type(self).hits += 1
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1:1/internal")
                self.end_headers()

            def log_message(self, *_args):
                return

        redirect_server = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
        redirect_server.daemon_threads = True
        redirect_thread = threading.Thread(target=redirect_server.serve_forever, daemon=True)
        redirect_thread.start()
        try:
            with self.assertRaises(HTTPError) as raised:
                home_providers._NO_REDIRECT_OPENER.open(
                    home_providers.Request(f"http://127.0.0.1:{redirect_server.server_port}/"),
                    timeout=1,
                )
            self.assertEqual(raised.exception.code, 302)
            self.assertEqual(RedirectHandler.hits, 1)
            raised.exception.close()
        finally:
            redirect_server.shutdown()
            redirect_server.server_close()
            redirect_thread.join(timeout=1)

    def test_hermes_home_summary_uses_production_data_shape_and_rejects_wrong_shape(self):
        payload = {
            "data": [{
                "id": "session-1", "title": "Frank main", "source": "api_server",
                "model": "deepseek-v4-pro", "started_at": 10, "last_active": 20,
                "message_count": 3, "preview": "A redacted preview",
            }],
        }
        with patch("server.HERMES_KEY", "configured-for-test"), patch("server.hermes_request", return_value=payload):
            result = server.hermes_session_summaries()
        self.assertTrue(result["ok"])
        self.assertEqual(result["sessions"][0]["id"], "session-1")
        self.assertEqual(result["sessions"][0]["message_count"], 3)

        with patch("server.HERMES_KEY", "configured-for-test"), patch("server.hermes_request", return_value={"sessions": payload["data"]}):
            wrong_shape = server.hermes_session_summaries()
        self.assertFalse(wrong_shape["ok"])
        self.assertEqual(wrong_shape["sessions"], [])

    def test_hermes_session_widget_is_scoped_to_hermes_and_omits_preview(self):
        forbidden_targets = (("project", "blockwise"), ("tool", "connections"), ("service", "frank-window"), ("agent", "other"))
        forged = {"instance_id": "hermes-session-forged", "widget_id": "hermes-session", "size": "wide", "config": {}}
        for kind, entity_id in forbidden_targets:
            with self.subTest(kind=kind, entity_id=entity_id):
                home_platform._write_json(home_platform.HOME_STORE_FILE, {"version": 1, "homes": {}, "custom_widgets": []})
                home = self.client.get(f"/api/homes/{kind}/{entity_id}").get_json()
                self.assertNotIn("hermes-session", {item["widget_id"] for item in home["instances"]})
                rejected = self.client.put(f"/api/homes/{kind}/{entity_id}", json={
                    "expected_revision": home["revision"], "instances": [forged],
                })
                self.assertEqual(rejected.status_code, 400)

                home_platform._write_json(home_platform.HOME_STORE_FILE, {
                    "version": 1,
                    "homes": {f"{kind}:{entity_id}": {"revision": 1, "instances": [forged], "updated_at": 0}},
                    "custom_widgets": [],
                })
                unavailable = self.client.get(f"/api/homes/{kind}/{entity_id}/widgets/hermes-session-forged")
                self.assertEqual(unavailable.status_code, 200)
                self.assertEqual(unavailable.get_json()["status"], "unavailable")

        home_platform._write_json(home_platform.HOME_STORE_FILE, {"version": 1, "homes": {}, "custom_widgets": []})
        home_platform.configure(
            project_loader=lambda: [{
                "id": "blockwise", "name": "Blockwise", "root": "blockwise",
                "default_widgets": ["entity-overview"],
            }],
            account_loader=lambda: [],
            hermes_health=lambda: {"ok": True, "profile": "default"},
            hermes_sessions=lambda: {"ok": True, "sessions": [{
                "id": "session-1", "title": "Hermes session", "updated_at": 20,
                "message_count": 3, "model": "test-model", "preview": "must not reach homes",
            }]},
            roots={"vps": self.project_root.parent.parent},
        )
        hermes = self.client.get("/api/homes/agent/hermes/widgets/hermes-session-1").get_json()
        self.assertEqual(hermes["status"], "ready")
        self.assertNotIn("preview", json.dumps(hermes))
        self.assertEqual(hermes["data"]["rows"][0]["id"], "session-1")

    def tearDown(self):
        home_platform.HOME_STORE_FILE = self.original_home_file
        home_platform.CONNECTIONS_FILE = self.original_connections_file
        home_platform.CONNECTION_ACTIONS_FILE = self.original_actions_file
        home_platform.CONNECTION_PLANS_FILE = self.original_plans_file
        home_platform.configure(
            project_loader=self.original_loaders[0],
            account_loader=self.original_loaders[1],
            hermes_health=self.original_loaders[2],
            roots=self.original_loaders[3],
        )
        self.temp.cleanup()

    def test_project_home_defaults_save_conflict_reset_and_snapshots(self):
        response = self.client.get("/api/homes/project/blockwise")
        self.assertEqual(response.status_code, 200)
        home = response.get_json()
        self.assertEqual(home["schema"], "schema://frank.home/v1")
        self.assertEqual(home["revision"], 0)
        self.assertEqual(len(home["instances"]), 6)
        self.assertEqual(home["entity"]["name"], "Blockwise")

        reversed_instances = list(reversed(home["instances"]))
        saved = self.client.put("/api/homes/project/blockwise", json={
            "expected_revision": 0,
            "instances": reversed_instances,
        })
        self.assertEqual(saved.status_code, 200, saved.get_json())
        self.assertEqual(saved.get_json()["revision"], 1)
        self.assertEqual(saved.get_json()["instances"][0]["instance_id"], reversed_instances[0]["instance_id"])

        stale = self.client.put("/api/homes/project/blockwise", json={
            "expected_revision": 0,
            "instances": reversed_instances,
        })
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.get_json()["current"]["revision"], 1)

        repository = self.client.get("/api/homes/project/blockwise/widgets/repository-status-1")
        self.assertEqual(repository.status_code, 200)
        self.assertEqual(repository.get_json()["data"]["branch"], "main")

        accounts = self.client.get("/api/homes/project/blockwise/widgets/accounts-summary-1")
        self.assertEqual(accounts.get_json()["data"]["customers"], 1)
        self.assertEqual(accounts.get_json()["data"]["attention"], 1)

        reset = self.client.post("/api/homes/project/blockwise/reset", json={"expected_revision": 1})
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.get_json()["revision"], 2)
        self.assertEqual(reset.get_json()["instances"][0]["widget_id"], "entity-overview")

    def test_home_rejects_unknown_duplicate_oversized_and_cross_scope_widgets(self):
        home = self.client.get("/api/homes/project/blockwise").get_json()
        unknown = [{"instance_id": "missing-1", "widget_id": "missing", "size": "medium", "config": {}}]
        self.assertEqual(self.client.put("/api/homes/project/blockwise", json={"expected_revision": 0, "instances": unknown}).status_code, 400)

        duplicate = [home["instances"][0], {**home["instances"][0], "instance_id": "entity-overview-2"}]
        self.assertEqual(self.client.put("/api/homes/project/blockwise", json={"expected_revision": 0, "instances": duplicate}).status_code, 400)

        oversized = [
            {"instance_id": f"quick-links-{index}", "widget_id": "quick-links", "size": "small", "config": {}}
            for index in range(26)
        ]
        self.assertEqual(self.client.put("/api/homes/project/blockwise", json={"expected_revision": 0, "instances": oversized}).status_code, 400)

        connection = self.client.post("/api/connections", json={
            "provider": "api", "name": "Other service", "scope_kind": "service",
            "scope_id": "elsewhere", "status": "connected", "connection_ref": "api://elsewhere/main",
        }).get_json()["connection"]
        cross_scope = [{
            "instance_id": "connections-summary-1", "widget_id": "connections-summary", "size": "medium",
            "config": {"connection_id": connection["id"]},
        }]
        rejected = self.client.put("/api/homes/project/blockwise", json={"expected_revision": 0, "instances": cross_scope})
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("outside this home scope", rejected.get_json()["error"])

    def test_custom_widget_lifecycle_is_plain_text_only_and_reference_safe(self):
        rejected = self.client.post("/api/widgets", json={
            "kind": "note", "title": "Unsafe", "body": "<script>alert(1)</script>",
        })
        self.assertEqual(rejected.status_code, 400)

        created = self.client.post("/api/widgets", json={
            "kind": "link", "title": "Runbook", "description": "Current operator guide",
            "body": "Use the reviewed release path.", "label": "Open runbook",
            "url": "https://docs.example/runbook", "surfaces": ["project", "tool"],
        })
        self.assertEqual(created.status_code, 201)
        widget = created.get_json()["widget"]
        self.assertTrue(widget["id"].startswith("custom-"))

        home = self.client.get("/api/homes/project/blockwise").get_json()
        instances = [*home["instances"], {
            "instance_id": "runbook-1", "widget_id": widget["id"], "size": "small", "config": {},
        }]
        saved = self.client.put("/api/homes/project/blockwise", json={"expected_revision": 0, "instances": instances})
        self.assertEqual(saved.status_code, 200, saved.get_json())
        custom_snapshot = self.client.get("/api/homes/project/blockwise/widgets/runbook-1").get_json()
        self.assertEqual(custom_snapshot["status"], "ready")
        self.assertEqual(custom_snapshot["links"][0]["url"], "https://docs.example/runbook")
        self.assertEqual(self.client.delete(f"/api/widgets/{widget['id']}").status_code, 409)

        updated = self.client.patch(f"/api/widgets/{widget['id']}", json={"body": "Updated guidance."})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["widget"]["version"], "1.0.1")

    def test_connections_store_metadata_only_and_activepieces_contract(self):
        with patch.dict("os.environ", {"ACTIVEPIECES_CONNECTIONS_URL": "https://flows.example/connections"}):
            catalog = self.client.get("/api/connections").get_json()["catalog"]
        activepieces = next(item for item in catalog if item["provider"] == "activepieces")
        self.assertEqual(activepieces["setup_url"], "https://flows.example/connections")
        self.assertTrue(activepieces["open_source"])
        self.assertEqual(activepieces["license"], "MIT")
        self.assertEqual(activepieces["adapter_status_map"], {
            "ACTIVE": "verified", "MISSING": "setup_needed", "ERROR": "error",
        })

        created = self.client.post("/api/connections", json={
            "provider": "activepieces", "name": "Frank workflows", "scope_kind": "project",
            "scope_id": "blockwise", "status": "connected",
            "connection_ref": "ap://connections/blockwise-main",
            "credential_ref": "openbao://frank/connections/blockwise-main",
            "admin_url": "https://flows.example/connections",
            "capabilities": ["workflow.status", "analytics.read"],
            "notes": "Configured reference; verification is pending.",
        })
        self.assertEqual(created.status_code, 201)
        connection = created.get_json()["connection"]
        self.assertEqual(connection["status"], "connected")

        updated = self.client.patch(f"/api/connections/{connection['id']}", json={"notes": "Metadata reviewed while verification remains provider-owned."})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["connection"]["status"], "connected")
        persisted = self.client.get("/api/connections").get_json()["connections"]
        self.assertEqual(persisted[0]["status"], "connected")
        connection = persisted[0]

        home = self.client.get("/api/homes/project/blockwise").get_json()
        instances = [
            {**item, "config": {"connection_id": connection["id"]}}
            if item["widget_id"] == "connections-summary" else item
            for item in home["instances"]
        ]
        saved = self.client.put("/api/homes/project/blockwise", json={"expected_revision": 0, "instances": instances})
        self.assertEqual(saved.status_code, 200, saved.get_json())
        snapshot = self.client.get("/api/homes/project/blockwise/widgets/connections-summary-1").get_json()
        self.assertTrue(snapshot["data"]["status_is_recorded"])
        self.assertEqual(snapshot["data"]["counts"]["connected"], 1)

    def test_connections_home_is_central_but_project_home_is_scope_limited(self):
        global_connection = self.client.post("/api/connections", json={
            "provider": "api", "name": "Global API", "scope_kind": "global",
            "status": "connected", "connection_ref": "api://global/main",
        }).get_json()["connection"]
        project_connection = self.client.post("/api/connections", json={
            "provider": "resend", "name": "Blockwise mail", "scope_kind": "project",
            "scope_id": "blockwise", "status": "connected", "connection_ref": "resend://blockwise/main",
        }).get_json()["connection"]
        service_connection = self.client.post("/api/connections", json={
            "provider": "stripe", "name": "Other service", "scope_kind": "service",
            "scope_id": "elsewhere", "status": "setup_needed", "connection_ref": "stripe://elsewhere/main",
        }).get_json()["connection"]

        central = self.client.get("/api/homes/tool/connections/widgets/connections-summary-1").get_json()
        names = {item["name"] for item in central["data"]["connections"]}
        self.assertEqual(names, {global_connection["name"], project_connection["name"], service_connection["name"]})

        project = self.client.get("/api/homes/project/blockwise/widgets/connections-summary-1").get_json()
        scoped_names = {item["name"] for item in project["data"]["connections"]}
        self.assertEqual(scoped_names, {global_connection["name"], project_connection["name"]})
        self.assertEqual(project["status"], "attention")

        central_home = self.client.get("/api/homes/tool/connections").get_json()
        self.assertEqual(
            [(item["widget_id"], item["size"]) for item in central_home["instances"]],
            [
                ("connections-summary", "wide"),
                ("provider-catalog", "wide"),
                ("connection-attention", "medium"),
                ("provider-coverage", "medium"),
            ],
        )
        central_attention = self.client.get("/api/homes/tool/connections/widgets/connection-attention-1").get_json()
        self.assertIn("await verification", central_attention["summary"])
        bound = [dict(item, config={"connection_id": service_connection["id"]}) if item["widget_id"] == "connections-summary" else item for item in central_home["instances"]]
        saved = self.client.put("/api/homes/tool/connections", json={"expected_revision": 0, "instances": bound})
        self.assertEqual(saved.status_code, 200, saved.get_json())

    def test_empty_connections_widget_opens_the_add_flow(self):
        summary = self.client.get("/api/homes/tool/connections/widgets/connections-summary-1").get_json()
        self.assertEqual(summary["links"][0]["target"], {"view": "connections", "action": "add"})

    def test_legacy_connection_revision_migrates_once_and_corruption_fails_closed(self):
        legacy = {
            "version": 1,
            "connections": [{
                "id": "legacy-connection", "provider": "api", "name": "Legacy API",
                "scope_kind": "global", "scope_id": "", "status": "connected",
                "connection_ref": "api://legacy/main", "credential_ref": "", "capabilities": [],
            }],
        }
        home_platform.CONNECTIONS_FILE.write_text(json.dumps(legacy), encoding="utf-8")
        first = self.client.get("/api/connections")
        self.assertEqual(first.status_code, 200, first.get_json())
        self.assertEqual(first.get_json()["connections"][0]["revision"], 1)
        persisted = home_platform.CONNECTIONS_FILE.read_text(encoding="utf-8")
        self.assertEqual(json.loads(persisted)["connections"][0]["revision"], 1)
        self.client.get("/api/connections")
        self.assertEqual(home_platform.CONNECTIONS_FILE.read_text(encoding="utf-8"), persisted)

        home_platform.CONNECTIONS_FILE.write_text(json.dumps({"version": 1, "connections": [{"id": "bad", "revision": "one"}]}), encoding="utf-8")
        before = home_platform.CONNECTIONS_FILE.read_text(encoding="utf-8")
        corrupt = self.client.get("/api/connections")
        self.assertEqual(corrupt.status_code, 503)
        self.assertEqual(home_platform.CONNECTIONS_FILE.read_text(encoding="utf-8"), before)

    def test_binding_delete_race_never_leaves_a_dangling_or_out_of_scope_binding(self):
        connection = self.client.post("/api/connections", json={
            "provider": "api", "name": "Race target", "scope_kind": "global",
            "status": "connected", "connection_ref": "api://race/target",
        }).get_json()["connection"]
        home = self.client.get("/api/homes/tool/connections").get_json()
        instances = [dict(item, config={"connection_id": connection["id"]}) if item["widget_id"] == "connections-summary" else item for item in home["instances"]]
        barrier = threading.Barrier(2)

        def bind_home():
            client = server.app.test_client()
            barrier.wait(timeout=3)
            return client.put("/api/homes/tool/connections", json={"expected_revision": 0, "instances": instances}).status_code

        def delete_connection():
            client = server.app.test_client()
            barrier.wait(timeout=3)
            origin = {"Origin": "http://localhost"}
            plan_response = client.post("/api/connections/plan", json={
                "action": "delete", "connection_id": connection["id"], "expected_revision": connection["revision"],
                "idempotency_key": "binding-race-plan-01",
            }, headers=origin)
            if plan_response.status_code != 200:
                return plan_response.status_code
            plan = plan_response.get_json()["plan"]
            return client.post("/api/connections/apply", json={
                "plan_id": plan["plan_id"], "confirmation_token": plan["confirmation_token"],
                "idempotency_key": "binding-race-apply-01",
            }, headers=origin).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            bound_status, deleted_status = list(pool.map(lambda fn: fn(), (bind_home, delete_connection)))
        self.assertFalse(bound_status == 200 and deleted_status == 200)
        saved = self.client.get("/api/homes/tool/connections").get_json()
        bound_ids = {
            item.get("config", {}).get("connection_id") for item in saved["instances"]
            if item.get("config", {}).get("connection_id")
        }
        remaining = {item["id"] for item in self.client.get("/api/connections").get_json()["connections"]}
        self.assertTrue(bound_ids <= remaining)

    def test_provider_coverage_distinguishes_recorded_verified_setup_and_error(self):
        for provider, name, status, ref in (
            ("api", "Recorded", "connected", "api://recorded/main"),
            ("resend", "Configured", "connected", "resend://configured/main"),
            ("stripe", "Needs setup", "setup_needed", "stripe://setup/main"),
        ):
            response = self.client.post("/api/connections", json={
                "provider": provider, "name": name, "scope_kind": "global",
                "status": status, "connection_ref": ref,
            })
            self.assertEqual(response.status_code, 201, response.get_json())
        snapshot = self.client.get("/api/homes/tool/connections/widgets/provider-coverage-1").get_json()
        statuses = {row["provider"]: row["status"] for row in snapshot["data"]["rows"]}
        self.assertEqual(statuses["api"], "recorded")
        self.assertEqual(statuses["resend"], "recorded")
        self.assertEqual(statuses["stripe"], "setup_needed")
        self.assertEqual(statuses["activepieces"], "setup_needed")
        self.assertEqual(snapshot["status"], "attention")

    def test_provider_coverage_aggregates_same_provider_records_order_independently(self):
        records = [
            {"name": "Resend setup", "scope_kind": "global", "scope_id": "", "status": "setup_needed", "connection_ref": "resend://setup/main"},
            {"name": "Resend connected", "scope_kind": "project", "scope_id": "blockwise", "status": "connected", "connection_ref": "resend://connected/blockwise"},
        ]

        def coverage(order):
            home_platform.CONNECTIONS_FILE.unlink(missing_ok=True)
            for item in order:
                response = self.client.post("/api/connections", json={
                    "provider": "resend", **item,
                })
                self.assertEqual(response.status_code, 201, response.get_json())
            snapshot = self.client.get("/api/homes/tool/connections/widgets/provider-coverage-1").get_json()
            row = next(item for item in snapshot["data"]["rows"] if item["provider"] == "resend")
            return snapshot["status"], row["status"], row["record_count"], [item["status"] for item in row["records"]]

        first = coverage(records)
        second = coverage(list(reversed(records)))
        self.assertEqual(first, second)
        self.assertEqual(first, ("attention", "setup_needed", 2, ["connected", "setup_needed"]))

    def test_repository_reflog_rows_expose_display_names_without_emails(self):
        logs = self.project_root / ".git" / "logs"
        logs.mkdir(parents=True)
        (logs / "HEAD").write_text(
            "0" * 40 + " " + "1" * 40 + " Jane Operator <jane@example.com> 1700000000 +0000\tupdate dashboard\n",
            encoding="utf-8",
        )
        rows = home_providers._repo_rows(self.project_root)
        self.assertEqual(rows[0]["author"], "Jane Operator")
        self.assertNotIn("@", rows[0]["author"])

    def test_gitdir_stays_inside_projects_mount_for_linked_worktrees(self):
        linked = self.project_root.parent / "linked-worktree"
        linked.mkdir()
        (linked / ".git").write_text(f"gitdir: {self.project_root / '.git'}\n", encoding="utf-8")
        self.assertEqual(home_providers._git_directory(linked), (self.project_root / ".git").resolve())
        self.assertEqual(home_providers._git_branch(linked), "main")

        outside = Path(self.temp.name) / "outside-git"
        (outside / "logs").mkdir(parents=True)
        absolute_escape = self.project_root.parent / "absolute-escape"
        absolute_escape.mkdir()
        (absolute_escape / ".git").write_text(f"gitdir: {outside}\n", encoding="utf-8")
        self.assertIsNone(home_providers._git_directory(absolute_escape))
        self.assertEqual(home_providers._repo_rows(absolute_escape), [])

        relative_escape = self.project_root.parent / "relative-escape"
        relative_escape.mkdir()
        relative_path = os.path.relpath(outside, relative_escape)
        (relative_escape / ".git").write_text(f"gitdir: {relative_path}\n", encoding="utf-8")
        self.assertIsNone(home_providers._git_directory(relative_escape))
        self.assertEqual(home_providers._repo_rows(relative_escape), [])

    def test_current_tool_home_emitters_resolve_to_named_profiles_and_defaults(self):
        emitters = {
            "accounts", "connections", "campaigns", "ad-templates", "widget-builder",
        }
        for entity_id in emitters:
            profile = home_platform.home_defaults.api_entity_profile("tool", entity_id)
            self.assertIsNotNone(profile, entity_id)
            self.assertEqual(profile["name"].strip(), profile["name"])
            self.assertTrue(profile.get("default_widgets"), entity_id)
            self.assertTrue(home_platform._default_instances("tool", entity_id), entity_id)
        for profile in home_platform.home_defaults.API_ENTITY_PROFILES.values():
            self.assertNotIn("quick-links", profile.get("default_widgets", []))
            self.assertNotIn("work-status", profile.get("default_widgets", []))
            self.assertNotIn("recent-receipts", profile.get("default_widgets", []))

    def test_every_builtin_profile_get_and_reset_use_its_declared_blueprint(self):
        home_platform.configure(
            project_loader=server._project_items,
            account_loader=lambda: [],
            hermes_health=lambda: {"ok": False, "reason": "test"},
            roots={"vps": self.project_root.parent.parent},
        )
        profiles = [("project", item["id"], item) for item in server.DEFAULT_PROJECTS]
        profiles.extend(
            (kind, profile["id"], profile)
            for key, profile in home_platform.home_defaults.API_ENTITY_PROFILES.items()
            for kind, _entity_id in [key.split(":", 1)]
        )
        for kind, entity_id, profile in profiles:
            with self.subTest(kind=kind, entity_id=entity_id):
                declared = list(profile["default_widgets"])
                if kind != "project":
                    self.assertEqual(declared, list(home_platform.home_defaults.ENTITY_DEFAULT_WIDGET_IDS[f"{kind}:{entity_id}"]))
                home = self.client.get(f"/api/homes/{kind}/{entity_id}").get_json()
                self.assertEqual([item["widget_id"] for item in home["instances"]], declared)
                saved = self.client.put(f"/api/homes/{kind}/{entity_id}", json={
                    "expected_revision": home["revision"], "instances": list(reversed(home["instances"])),
                })
                self.assertEqual(saved.status_code, 200, saved.get_json())
                reset = self.client.post(f"/api/homes/{kind}/{entity_id}/reset", json={
                    "expected_revision": saved.get_json()["revision"],
                })
                self.assertEqual(reset.status_code, 200, reset.get_json())
                self.assertEqual([item["widget_id"] for item in reset.get_json()["instances"]], declared)

    def test_entity_profile_registry_validates_copies_and_unknown_widgets_fail_closed(self):
        manifest = {
            "id": "registry-fixture",
            "name": "Registry fixture",
            "kind": "tool",
            "blurb": "A test-only declarative profile.",
            "capabilities": ["fixture.read"],
            "default_widget_ids": ["entity-overview", "widget-does-not-exist"],
            "connection_capabilities": ["fixture.read"],
        }
        try:
            registered = home_platform.home_defaults.register_entity_profile(manifest)
            self.assertEqual(registered["default_widgets"], manifest["default_widget_ids"])
            registered["capabilities"].append("mutated")
            manifest["connection_capabilities"].append("mutated")
            stored = home_platform.home_defaults.api_entity_profile("tool", "registry-fixture")
            self.assertEqual(stored["capabilities"], ["fixture.read"])
            self.assertEqual(stored["connection_capabilities"], ["fixture.read"])
            self.assertEqual(stored["default_widget_ids"], ["entity-overview", "widget-does-not-exist"])
            instances = home_platform._default_instances("tool", "registry-fixture")
            self.assertEqual([item["widget_id"] for item in instances], ["entity-overview"])
        finally:
            home_platform.home_defaults._REGISTERED_ENTITY_PROFILES.pop("tool:registry-fixture", None)

    def test_entity_profile_registry_rejects_replacing_builtin_connections_or_hermes(self):
        for kind, entity_id in (("tool", "connections"), ("agent", "hermes")):
            with self.subTest(kind=kind, entity_id=entity_id):
                original = home_platform.home_defaults.api_entity_profile(kind, entity_id)
                replacement = dict(original)
                replacement.pop("default_widgets", None)
                replacement["name"] = "Unexpected replacement"
                with self.assertRaises(ValueError):
                    home_platform.home_defaults.register_entity_profile(replacement)
                current = home_platform.home_defaults.api_entity_profile(kind, entity_id)
                self.assertEqual(current["name"], original["name"])

    def test_entity_profile_registry_rejects_invalid_kind_id_and_fields(self):
        base = {
            "id": "registry-invalid",
            "name": "Invalid fixture",
            "kind": "tool",
            "blurb": "Invalid test profile.",
            "capabilities": [],
            "default_widget_ids": [],
            "connection_capabilities": [],
        }
        with self.assertRaises(ValueError):
            home_platform.home_defaults.register_entity_profile({**base, "kind": "project"})
        with self.assertRaises(ValueError):
            home_platform.home_defaults.register_entity_profile({**base, "id": "Not Valid"})
        with self.assertRaises(ValueError):
            home_platform.home_defaults.register_entity_profile({**base, "unexpected": True})
        with self.assertRaises(TypeError):
            home_platform.home_defaults.register_entity_profile({**base, "capabilities": "fixture.read"})
        with self.assertRaises(ValueError):
            home_platform.home_defaults.register_entity_profile({**base, "default_widget_ids": ["entity-overview", "entity-overview"]})

    def test_connections_reject_provider_keys_tokens_and_payment_data_everywhere(self):
        encode_segment = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
        jwt = ".".join((encode_segment({"alg": "HS256"}), encode_segment({"sub": "frank-test-user"}), "invalid-signature"))
        attempts = [
            ("connection_ref", "re_" + "1234567890abcdefghijklmnop"),
            ("connection_ref", "resend_" + "1234567890abcdefghijklmnop"),
            ("connection_ref", "sk_" + "live_" + "1234567890abcdefghijklmnop"),
            ("notes", "pk_" + "live_" + "1234567890abcdefghijklmnop"),
            ("credential_ref", "sk_" + "test_" + "1234567890abcdefghijklmnop"),
            ("notes", jwt),
            ("name", "Bearer abcdefghijklmnopqrstuvwxyz123456"),
            ("notes", "Test card 4242 4242 4242 4242"),
            ("notes", "Bank GB82 WEST 1234 5698 7654 32"),
        ]
        for index, (field, value) in enumerate(attempts):
            with self.subTest(field=field, value=value[:12]):
                payload = {
                    "provider": "api", "name": f"Safe name {index}", "scope_kind": "global",
                    "status": "setup_needed", "connection_ref": f"api://safe/{index}", field: value,
                }
                response = self.client.post("/api/connections", json=payload)
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))

        self.assertEqual(self.client.get("/api/connections").get_json()["connections"], [])

    def test_connection_patch_replaces_persisted_metadata_without_losing_identity(self):
        created = self.client.post("/api/connections", json={
            "provider": "api", "name": "Patch target", "scope_kind": "global",
            "status": "setup_needed", "connection_ref": "api://patch/initial",
            "credential_ref": "openbao://frank/connections/patch-target",
            "admin_url": "https://docs.example/setup", "capabilities": ["api.read"],
            "notes": "Initial metadata",
        }).get_json()["connection"]
        updated = self.client.patch(f"/api/connections/{created['id']}", json={"notes": "Metadata reviewed"})
        self.assertEqual(updated.status_code, 200)
        item = updated.get_json()["connection"]
        self.assertEqual(item["id"], created["id"])
        self.assertEqual(item["connection_ref"], "api://patch/initial")
        self.assertEqual(item["credential_ref"], "openbao://frank/connections/patch-target")
        self.assertEqual(item["status"], "setup_needed")
        self.assertEqual(item["notes"], "Metadata reviewed")
        persisted = self.client.get("/api/connections").get_json()["connections"][0]
        self.assertEqual(persisted, item)

    def test_connection_scope_change_rejects_bound_widgets_but_allows_metadata_updates(self):
        with patch("home_platform.uuid.uuid4") as uuid4:
            uuid4.return_value.hex = "gb82123456987654"
            created = self.client.post("/api/connections", json={
                "provider": "api", "name": "Bound scope target", "scope_kind": "global",
                "status": "connected", "connection_ref": "api://scope/bound",
            }).get_json()["connection"]
        home = self.client.get("/api/homes/project/blockwise").get_json()
        instances = [
            {**item, "config": {"connection_id": created["id"]}}
            if item["widget_id"] == "connections-summary" else item
            for item in home["instances"]
        ]
        saved = self.client.put("/api/homes/project/blockwise", json={
            "expected_revision": home["revision"], "instances": instances,
        })
        self.assertEqual(saved.status_code, 200, saved.get_json())

        metadata = self.client.patch(f"/api/connections/{created['id']}", json={"notes": "Metadata updated while provider truth remains connected"})
        self.assertEqual(metadata.status_code, 200)
        self.assertEqual(metadata.get_json()["connection"]["status"], "connected")

        rejected = self.client.patch(f"/api/connections/{created['id']}", json={
            "scope_kind": "project", "scope_id": "blockwise",
        })
        self.assertEqual(rejected.status_code, 409)
        self.assertIn("scope", rejected.get_json()["error"])
        self.assertIn("bound", rejected.get_json()["error"])

        current = self.client.get("/api/connections").get_json()["connections"][0]
        self.assertEqual(current["scope_kind"], "global")
        self.assertEqual(current["status"], "connected")

        reset = self.client.post("/api/homes/project/blockwise/reset", json={"expected_revision": saved.get_json()["revision"]})
        self.assertEqual(reset.status_code, 200)
        allowed = self.client.patch(f"/api/connections/{created['id']}", json={
            "scope_kind": "project", "scope_id": "blockwise",
        })
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.get_json()["connection"]["scope_kind"], "project")


if __name__ == "__main__":
    unittest.main()
