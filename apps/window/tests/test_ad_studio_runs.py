import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


RUN_ID = "trun_0123456789abcdef0123456789abcdef"


class AdStudioToolRunApiTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.temp = tempfile.TemporaryDirectory()
        self.upload_dir = Path(self.temp.name) / "uploads"
        self.source = self.upload_dir / "batch-1" / "source.png"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"\x89PNG\r\n\x1a\nsource")
        self.project = {"id": "blockwise", "name": "Blockwise", "root": "blockwise", "blurb": "Property ads"}

    def tearDown(self):
        self.temp.cleanup()

    @patch("server.hermes_request")
    def test_creates_durable_tool_run_without_chat_or_hub_model(self, hermes_request):
        hermes_request.return_value = {"run_id": RUN_ID, "status": "queued", "model_policy_revision": 4, "payload": {"job_name": "Spring listing", "sources": [{"name": "source.png", "path": "/private/source.png"}]}}
        with patch("server.UPLOAD_DIR", self.upload_dir), patch("server.HERMES_UPLOAD_ROOT", Path("/frank/window/data/uploads")), patch.object(server._project_store, "get_project", return_value=self.project):
            response = self.client.post("/api/ad-studio/runs", json={"project_id":"blockwise","name":"Spring listing","brief":"Keep layout","placements":["square","story"],"attachments":[{"id":"batch-1/source.png"}],"policy_revision":"4","model":"hub-model-must-be-ignored"})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json()["run"]["id"], RUN_ID)
        path, command = hermes_request.call_args.args
        self.assertEqual(path, "/v1/tool-runs")
        self.assertEqual(command["action"], "build-template")
        self.assertEqual(command["model_policy_revision"], 4)
        self.assertNotIn("model", command)
        self.assertEqual(command["payload"]["sources"][0]["path"], "/frank/window/data/uploads/batch-1/source.png")
        self.assertNotIn("path", response.get_json()["run"]["source"])
        self.assertFalse(self.source.exists(), "Frank staging copy should be removed after Hermes ingestion")

    @patch("server.hermes_request")
    def test_reads_sanitized_authoritative_status(self, hermes_request):
        hermes_request.return_value = {"run_id":RUN_ID,"status":"completed","stage":"release","progress":0.92,"output":{"summary":"Ready","private_path":"/srv/private"},"payload":{"sources":[{"name":"source.png","path":"/srv/private/source.png"}]},"trace_id":"a"*32}
        response = self.client.get(f"/api/ad-studio/runs/{RUN_ID}")
        self.assertEqual(response.status_code, 200)
        run = response.get_json()["run"]
        self.assertEqual(run["output"], {})
        self.assertEqual(run["progress"], 0.92)
        self.assertNotIn("path", run["source"])
        hermes_request.assert_called_once_with(f"/v1/tool-runs/{RUN_ID}", timeout=8)

    @patch("server.hermes_request")
    def test_approval_fails_closed_without_two_visual_scores(self, hermes_request):
        hermes_request.return_value = {"run_id": RUN_ID, "status": "waiting_for_approval", "output": {"qa": {"deterministic_check": "passed"}}}
        response = self.client.post(
            f"/api/ad-studio/runs/{RUN_ID}/approval",
            json={"decision": "approve", "confirm_100_percent": True, "reason": "Checked"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.get_json()["quality_gate"]["passed"])
        hermes_request.assert_called_once_with(f"/v1/tool-runs/{RUN_ID}", timeout=8)

    @patch("server.hermes_request")
    def test_approval_requires_native_zoom_confirmation_before_reading_run(self, hermes_request):
        response = self.client.post(
            f"/api/ad-studio/runs/{RUN_ID}/approval",
            json={"decision": "approve", "confirm_100_percent": False},
        )
        self.assertEqual(response.status_code, 400)
        hermes_request.assert_not_called()

    @patch("server.hermes_request")
    def test_approval_forwards_only_after_both_scores_reach_95(self, hermes_request):
        hermes_request.side_effect = [
            {"run_id": RUN_ID, "status": "waiting_for_approval", "output": {"qa": {"visual_review": {"likeness_threshold": 9.5, "scores": {"primary_ad_system_likeness": 9.7, "strict_ad_system_likeness": 9.5}}}}},
            {"run_id": RUN_ID, "status": "running", "stage": "ready"},
        ]
        response = self.client.post(
            f"/api/ad-studio/runs/{RUN_ID}/approval",
            json={"decision": "approve", "confirm_100_percent": True, "reason": "Checked"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(hermes_request.call_args_list[1].args[0], f"/v1/tool-runs/{RUN_ID}/approval")

    def test_visual_gate_accepts_current_and_legacy_score_shapes(self):
        current = {"output": {"qa": {"visual_review": {"likeness_threshold": 9.5, "scores": {"primary_ad_system_likeness": 9.8, "strict_ad_system_likeness": 9.6}}}}}
        legacy = {"output": {"quality_gate": {"likenessThreshold": 9.5, "scores": {"primaryAdSystemLikeness": 9.8, "strictAdSystemLikeness": 9.6}}}}
        self.assertTrue(server._ad_studio_visual_gate(current)["passed"])
        self.assertTrue(server._ad_studio_visual_gate(legacy)["passed"])

    def test_generation_projection_keeps_scores_and_hashes_but_redacts_private_text(self):
        projected = server._public_ad_studio_run({
            "run_id": RUN_ID,
            "output": {"generations": [{
                "iteration": 2,
                "decision": "revise",
                "scores": {"primaryAdSystemLikeness": 9.7, "strictAdSystemLikeness": 9.2},
                "revisionReason": "Inspect /srv/private/source.png with api_key=do-not-return-this",
                "reviewers": {"primary": "vision-primary-v1", "strict": "vision-strict-v1"},
                "artifacts": {"feedSha256": "a" * 64, "storySha256": "b" * 64, "privatePath": "/srv/private"},
                "private_path": "/srv/private/source.png",
            }]},
        })
        generation = projected["output"]["generations"][0]
        self.assertEqual(generation["scores"]["primary_ad_system_likeness"], 9.7)
        self.assertEqual(generation["artifacts"], {"feedSha256": "a" * 64, "storySha256": "b" * 64})
        self.assertEqual(generation["revision_reason"], "Protected revision detail recorded in Hermes.")
        self.assertNotIn("private_path", generation)

    @patch("server.hermes_request")
    def test_lists_hermes_history(self, hermes_request):
        hermes_request.return_value = {"object":"list","data":[{"run_id":RUN_ID,"status":"running","scope":{"project_id":"blockwise"}}]}
        response = self.client.get("/api/ad-studio/runs?project_id=blockwise")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["runs"][0]["id"], RUN_ID)

    def test_rejects_missing_source_images(self):
        with patch.object(server._project_store, "get_project", return_value=self.project):
            response = self.client.post("/api/ad-studio/runs", json={"project_id":"blockwise","placements":["square"],"attachments":[]})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
