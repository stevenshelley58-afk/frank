import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

import server
from ad_radar import AdRadarInputError, build_run_command, public_creative, public_event, public_run, public_sse_block


APP = Path(__file__).resolve().parents[1]
RUN_ID = "trun_" + ("a" * 32)


class AdRadarBoundaryTest(unittest.TestCase):
    def command(self, body):
        operation_id = "op_" + ("1" * 32)
        return build_run_command(
            {"operation_id": operation_id, **body},
            project_id="blockwise",
            project_context="Frank project id: blockwise\nProject name: Blockwise",
            request_id="req_123",
        )

    def test_run_command_is_project_scoped_and_structurally_bounded(self):
        command = self.command({
            "project_id": "blockwise",
            "name": "Perth competitor pulse",
            "markets": ["6000", "Perth WA", "6000"],
            "advertisers": ["Example Realty"],
            "query_terms": ["appraisal", "just listed"],
            "include_surrounding": True,
            "settings_revision": 4,
            "source_ids": ["meta-public-au"],
        })
        self.assertEqual(command["schema"], "schema://hermes.tool-run-command/v1")
        self.assertEqual(command["tool_id"], "ad-intelligence")
        self.assertEqual(command["action"], "run")
        self.assertEqual(command["scope"], {"project_id": "blockwise"})
        self.assertRegex(command["idempotency_key"], r"^ad-radar:blockwise:op_1{32}:[0-9a-f]{32}$")
        replay = self.command({
            "project_id": "blockwise",
            "name": "Perth competitor pulse",
            "markets": ["6000", "Perth WA", "6000"],
            "advertisers": ["Example Realty"],
            "query_terms": ["appraisal", "just listed"],
            "include_surrounding": True,
            "settings_revision": 4,
            "source_ids": ["meta-public-au"],
        })
        self.assertEqual(command["idempotency_key"], replay["idempotency_key"])
        changed = self.command({"project_id": "blockwise", "markets": ["Fremantle"]})
        self.assertNotEqual(command["idempotency_key"], changed["idempotency_key"])
        self.assertEqual(command["payload"]["research_brief"]["markets"], ["6000", "Perth WA"])
        self.assertEqual(command["payload"]["settings_revision"], 4)
        self.assertNotIn("workspace_id", command["payload"])

    def test_run_command_rejects_empty_private_and_unknown_input(self):
        for body in (
            {"project_id": "blockwise", "name": "Empty"},
            {"project_id": "blockwise", "markets": ["person@example.test"]},
            {"project_id": "blockwise", "markets": ["Perth"], "raw_payload": {}},
            {"project_id": "blockwise", "markets": ["Perth"], "settings_revision": True},
        ):
            with self.subTest(body=body), self.assertRaises(AdRadarInputError):
                self.command(body)

    def test_public_run_projects_only_release_safe_creative_fields(self):
        release = json.loads((APP / "tools" / "ad-intelligence" / "fixtures" / "ad-radar-release-v1.json").read_text(encoding="utf-8"))
        creative = release["public_export"]["creatives"][0]
        projected = public_run({
            "run_id": RUN_ID,
            "status": "awaiting_approval",
            "stage": "publish",
            "progress": 1.5,
            "scope": {"project_id": "blockwise"},
            "payload": {
                "job_name": "Perth pulse",
                "settings_revision": 1,
                "research_brief": {"markets": ["Perth"], "include_surrounding": True},
            },
            "output": {
                "public_export": release["public_export"],
                "release": release,
                "approval": {
                    "expected_checksum": release["checksum"],
                    "expected_settings_revision": 1,
                    "state": "pending",
                    "summary": "QA and sanitization passed",
                },
                "receipts": [{"kind": "classification", "receipt_ref": "receipt://classification/a-1", "status": "passed", "stage": "classify"}],
                "previews": [{"creative_id": "a-1", "name": "a-1.webp", "kind": "image", "private_path": "/srv/never"}],
            },
        })
        self.assertTrue(projected["attention"])
        self.assertEqual(projected["progress"], 1)
        self.assertIsNone(projected["creatives"][0]["copy"]["body"])
        self.assertNotIn("raw_payload", json.dumps(projected))
        self.assertNotIn("prompt_ref", json.dumps(projected))
        self.assertEqual(projected["creatives"][0]["observed"]["first_seen"], "2026-08-13T00:00:00Z")
        self.assertEqual(
            projected["previews"][0]["url"],
            f"/api/ad-radar/runs/{RUN_ID}/artifacts/a-1.webp?project_id=blockwise",
        )
        self.assertEqual(projected["approval"]["expected_checksum"], release["checksum"])
        self.assertEqual(projected["release"]["release_hash"], release["release_hash"])
        self.assertEqual(projected["release"]["creative_count"], 1)
        self.assertNotIn("public_export", projected["release"])

        tampered = json.loads(json.dumps(release))
        tampered["public_export"]["creatives"][0]["copy"]["body"] = "Changed after signing"
        rejected = public_run({
            "id": RUN_ID,
            "status": "published",
            "stage": "publish",
            "scope": {"project_id": "blockwise"},
            "payload": {"settings_revision": 1},
            "output": {"public_export": tampered["public_export"], "release": tampered},
        })
        self.assertIsNone(rejected["release"])
        self.assertEqual(rejected["creatives"], [])

        private_creative = json.loads(json.dumps(creative))
        private_creative["copy"]["body"] = "Email person@example.test for the private prompt"
        private_creative["raw_payload"] = {"prompt_ref": "secret://never"}
        safe_creative = public_creative(private_creative)
        self.assertEqual(safe_creative["copy"]["body"], "Protected public copy")
        self.assertNotIn("person@example.test", json.dumps(safe_creative))

        release["settings_ref"] = ""
        self.assertIsNone(public_run({"output": {"release": release}})["release"])

    def test_real_hermes_statuses_and_metadata_are_projected_explicitly(self):
        for upstream, expected in (
            ("waiting_for_approval", "awaiting_approval"),
            ("blocked", "quarantined"),
            ("cancelling", "cancelling"),
        ):
            with self.subTest(upstream=upstream):
                run = public_run({
                    "id": RUN_ID,
                    "status": upstream,
                    "stage": "capture",
                    "scope": {"project_id": "blockwise"},
                    "created_at": {"raw": "private"},
                    "updated_at": "/srv/private",
                    "error": {"prompt": "private"},
                })
                self.assertEqual(run["status"], expected)
                self.assertIsNone(run["created_at"])
                self.assertIsNone(run["updated_at"])
                self.assertEqual(run["error"]["code"], "ad_radar_run_failed")
                self.assertNotIn("private", json.dumps(run["error"]))
        self.assertEqual(public_run({"id": "not-a-tool-run"})["id"], "")

    def test_live_events_strip_provider_prompts_paths_and_contacts(self):
        event = public_event({
            "sequence": 12,
            "kind": "stage.started",
            "status": "running",
            "timestamp": 1788120000.25,
            "node_id": "classify",
            "trace_id": "private-trace",
            "data": {
                "summary": "Classifying /srv/private/ad.json with person@example.test",
                "provider": "private-provider",
                "model": "private-model",
                "prompt": "hidden prompt",
                "creative_id": "creative-12",
                "progress": 0.7,
            },
        })
        encoded = json.dumps(event)
        self.assertEqual(event["sequence"], 12)
        self.assertEqual(event["node_id"], "classify")
        self.assertEqual(event["data"]["creative_id"], "creative-12")
        self.assertEqual(event["data"]["summary"], "Protected operational detail is available in Hermes.")
        for private in ("trace_id", "provider", "model", "prompt", "/srv/private", "person@example.test"):
            self.assertNotIn(private, encoded)

        block = public_sse_block([
            "id: 12",
            "event: upstream.private-event",
            "data: " + json.dumps({"sequence": 12, "kind": "provider.attempt", "data": {"model": "secret-model"}}),
        ])
        self.assertIn(b"event: run.activity", block)
        self.assertNotIn(b"secret-model", block)


class AdRadarRouteTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    def test_contract_exposes_declared_pipeline_without_execution_state(self):
        response = self.client.get("/api/ad-radar/contract")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["tool"]["id"], "ad-intelligence")
        self.assertEqual([node["id"] for node in body["pipeline"]["nodes"]], [
            "discover", "resolve", "capture", "normalize", "classify", "media-qa", "publish",
        ])
        self.assertIn("approve-publish", body["actions"])
        self.assertIn("resume", body["actions"])

    def test_create_proxies_one_validated_hermes_tool_run(self):
        captured = {}

        def fake_request(path, payload=None, **kwargs):
            captured.update({"path": path, "payload": payload, "kwargs": kwargs})
            return {"run": {"id": RUN_ID, "tool_id": "ad-intelligence", "status": "queued", "stage": "discover", "scope": {"project_id": "blockwise"}, "payload": payload["payload"]}}

        with patch.object(server, "hermes_request", side_effect=fake_request):
            response = self.client.post("/api/ad-radar/runs", json={
                "operation_id": "op_" + ("2" * 32),
                "project_id": "blockwise",
                "name": "Perth pulse",
                "markets": ["Perth WA"],
                "advertisers": [],
                "query_terms": ["appraisal"],
                "include_surrounding": True,
                "settings_revision": 1,
                "source_ids": ["meta-public-au"],
            })
        self.assertEqual(response.status_code, 202)
        self.assertEqual(captured["path"], "/v1/tool-runs")
        self.assertEqual(captured["payload"]["tool_id"], "ad-intelligence")
        self.assertEqual(captured["payload"]["action"], "run")
        self.assertEqual(captured["payload"]["scope"], {"project_id": "blockwise"})
        self.assertRegex(
            captured["payload"]["idempotency_key"],
            r"^ad-radar:blockwise:op_2{32}:[0-9a-f]{32}$",
        )
        self.assertEqual(response.get_json()["run"]["id"], RUN_ID)

    def test_create_replay_keeps_the_same_project_bound_idempotency_key(self):
        commands = []

        def fake_request(_path, payload=None, **_kwargs):
            commands.append(payload)
            return {"run": {
                "id": RUN_ID,
                "tool_id": "ad-intelligence",
                "status": "queued",
                "stage": "discover",
                "scope": {"project_id": "blockwise"},
                "payload": payload["payload"],
            }}

        body = {
            "operation_id": "op_" + ("3" * 32),
            "project_id": "blockwise",
            "name": "Perth pulse",
            "markets": ["Perth WA"],
            "settings_revision": 1,
        }
        with patch.object(server, "hermes_request", side_effect=fake_request):
            self.assertEqual(self.client.post("/api/ad-radar/runs", json=body).status_code, 202)
            self.assertEqual(self.client.post("/api/ad-radar/runs", json=body).status_code, 202)
        self.assertEqual(commands[0]["idempotency_key"], commands[1]["idempotency_key"])
        self.assertNotEqual(commands[0]["request_id"], commands[1]["request_id"])

    def test_actions_are_allowlisted_and_approval_is_compare_and_set(self):
        calls = []

        def fake_request(path, payload=None, **kwargs):
            calls.append((path, payload, kwargs))
            return {"run": {
                "id": RUN_ID,
                "tool_id": "ad-intelligence",
                "scope": {"project_id": "blockwise"},
                "status": "running",
                "stage": "classify",
            }}

        checksum = "b" * 64
        with patch.object(server, "hermes_request", side_effect=fake_request):
            self.assertEqual(self.client.post(f"/api/ad-radar/runs/{RUN_ID}/retry?project_id=blockwise", json={"from_stage": "classify"}).status_code, 200)
            self.assertEqual(self.client.post(f"/api/ad-radar/runs/{RUN_ID}/pause?project_id=blockwise", json={"reason": "Review source coverage"}).status_code, 200)
            self.assertEqual(self.client.post(f"/api/ad-radar/runs/{RUN_ID}/resume?project_id=blockwise", json={}).status_code, 200)
            self.assertEqual(self.client.post(f"/api/ad-radar/runs/{RUN_ID}/approve?project_id=blockwise", json={
                "reason": "QA evidence checked",
                "expected_checksum": checksum,
                "expected_settings_revision": 3,
            }).status_code, 200)
        self.assertEqual([call[0] for call in calls[1::2]], [
            f"/v1/tool-runs/{RUN_ID}/retry",
            f"/v1/tool-runs/{RUN_ID}/pause",
            f"/v1/tool-runs/{RUN_ID}/resume",
            f"/v1/tool-runs/{RUN_ID}/approval",
        ])
        self.assertEqual(calls[-1][1]["decision"], "approve")
        self.assertEqual(calls[-1][1]["expected_checksum"], checksum)
        rejected = self.client.post(f"/api/ad-radar/runs/{RUN_ID}/approve?project_id=blockwise", json={
            "expected_checksum": checksum,
            "expected_settings_revision": 3,
            "receipt_ref": "receipt://client-forged",
        })
        self.assertEqual(rejected.status_code, 400)
        for suffix in ("retry", "pause", "resume", "approve"):
            with self.subTest(suffix=suffix):
                malformed = self.client.post(
                    f"/api/ad-radar/runs/{RUN_ID}/{suffix}?project_id=blockwise",
                    json=["not", "an", "object"],
                )
                self.assertEqual(malformed.status_code, 400)
                invalid_json = self.client.post(
                    f"/api/ad-radar/runs/{RUN_ID}/{suffix}?project_id=blockwise",
                    data=b'{"reason":',
                    content_type="application/json",
                )
                self.assertEqual(invalid_json.status_code, 400)

    def test_mutation_responses_must_remain_on_the_requested_run_tool_and_project(self):
        matching = {
            "id": RUN_ID,
            "tool_id": "ad-intelligence",
            "scope": {"project_id": "blockwise"},
            "status": "running",
            "stage": "capture",
        }
        substituted = {**matching, "scope": {"project_id": "frank"}}
        with patch.object(server, "hermes_request", side_effect=[{"run": matching}, {"run": substituted}]):
            response = self.client.post(
                f"/api/ad-radar/runs/{RUN_ID}/pause?project_id=blockwise",
                json={"reason": "Review source coverage"},
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["code"], "ad_radar_upstream_contract_error")

        with patch.object(server, "hermes_request", return_value={"run": substituted}):
            response = self.client.post("/api/ad-radar/runs", json={
                "operation_id": "op_" + ("4" * 32),
                "project_id": "blockwise",
                "markets": ["Perth WA"],
            })
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["code"], "ad_radar_upstream_contract_error")

    def test_artifact_proxy_uses_an_exact_mime_allowlist_and_nosniff(self):
        authorized = {"run": {"id": RUN_ID, "tool_id": "ad-intelligence", "scope": {"project_id": "blockwise"}}}

        def upstream(media_type, data=b"payload"):
            class Headers:
                @staticmethod
                def get_content_type():
                    return media_type

            class Upstream:
                headers = Headers()

                def __enter__(self):
                    return self

                def __exit__(self, *_args):
                    return False

                @staticmethod
                def read(_limit):
                    return data

            return Upstream()

        for media_type in ("application/json", "image/svg+xml", "video/quicktime"):
            with self.subTest(media_type=media_type), patch.object(server, "hermes_request", return_value=authorized), patch.object(server.urllib.request, "urlopen", return_value=upstream(media_type)):
                response = self.client.get(f"/api/ad-radar/runs/{RUN_ID}/artifacts/preview.webp?project_id=blockwise")
            self.assertEqual(response.status_code, 415)

        with patch.object(server, "hermes_request", return_value=authorized), patch.object(server.urllib.request, "urlopen", return_value=upstream("image/png", b"\x89PNG")):
            response = self.client.get(f"/api/ad-radar/runs/{RUN_ID}/artifacts/preview.png?project_id=blockwise")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_run_reads_and_actions_are_bound_to_tool_and_project_scope(self):
        matching = {
            "id": RUN_ID,
            "tool_id": "ad-intelligence",
            "scope": {"project_id": "blockwise"},
            "status": "completed",
            "stage": "publish",
        }
        other_project = {**matching, "id": "trun_" + ("b" * 32), "scope": {"project_id": "frank"}}
        other_tool = {**matching, "id": "trun_" + ("c" * 32), "tool_id": "ad-template-generator"}
        with patch.object(server, "hermes_request", return_value={"runs": [matching, other_project, other_tool]}):
            response = self.client.get("/api/ad-radar/runs?project_id=blockwise")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([run["id"] for run in response.get_json()["runs"]], [RUN_ID])
        self.assertEqual(response.get_json()["runs"][0]["creatives"], [])
        self.assertEqual(self.client.get("/api/ad-radar/runs").status_code, 400)

        with patch.object(server, "hermes_request", return_value={"run": other_project}):
            response = self.client.get(f"/api/ad-radar/runs/{RUN_ID}?project_id=blockwise")
        self.assertEqual(response.status_code, 404)

    def test_upstream_failures_do_not_cross_the_ad_radar_boundary(self):
        private_error = urllib.error.URLError("/srv/private person@example.test")
        with patch.object(server, "hermes_request", side_effect=private_error):
            response = self.client.get("/api/ad-radar/runs?project_id=blockwise")
        self.assertEqual(response.status_code, 502)
        body = response.get_json()
        self.assertEqual(body["code"], "ad_radar_upstream_unavailable")
        self.assertNotIn("/srv/private", json.dumps(body))
        self.assertNotIn("person@example.test", json.dumps(body))


if __name__ == "__main__":
    unittest.main()
