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
        self.assertEqual(run["output"], {"summary": "Ready"})
        self.assertEqual(run["progress"], 0.92)
        self.assertNotIn("path", run["source"])
        hermes_request.assert_called_once_with(f"/v1/tool-runs/{RUN_ID}", timeout=8)

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
