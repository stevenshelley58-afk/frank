import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class AdStudioBackgroundRunApiTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()
        self.temp = tempfile.TemporaryDirectory()
        self.upload_dir = Path(self.temp.name) / "uploads"
        self.source = self.upload_dir / "batch-1" / "source.png"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"\x89PNG\r\n\x1a\nsource")
        self.project = {
            "id": "blockwise",
            "name": "Blockwise",
            "root": "blockwise",
            "blurb": "Property ads",
        }

    def tearDown(self):
        self.temp.cleanup()

    @patch("server.hermes_request")
    def test_starts_native_detached_run_without_creating_chat(self, hermes_request):
        hermes_request.return_value = {
            "run_id": "run_0123456789abcdef0123456789abcdef",
            "status": "started",
        }
        with patch("server.UPLOAD_DIR", self.upload_dir), \
             patch("server.HERMES_UPLOAD_ROOT", Path("/frank/window/data/uploads")), \
             patch.object(server._project_store, "get_project", return_value=self.project):
            response = self.client.post("/api/ad-studio/runs", json={
                "project_id": "blockwise",
                "name": "Spring listing",
                "brief": "Keep the layout",
                "placements": ["square", "story"],
                "attachments": [{"id": "batch-1/source.png"}],
                "model": "qwen3.8-max",
                "provider": "custom",
            })

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json()["run"]["id"], "run_0123456789abcdef0123456789abcdef")
        path, payload = hermes_request.call_args.args
        self.assertEqual(path, "/v1/runs")
        self.assertIn("ad-template-generator", payload["input"])
        self.assertIn("/frank/window/data/uploads/batch-1/source.png", payload["input"])
        self.assertIn("Canonical workspace: /projects/blockwise", payload["instructions"])
        self.assertEqual(payload["model"], "qwen3.8-max")
        self.assertEqual(payload["provider"], "custom")
        self.assertEqual(hermes_request.call_args.kwargs, {"method": "POST", "timeout": 10})

    @patch("server.hermes_request")
    def test_reads_authoritative_background_status(self, hermes_request):
        hermes_request.return_value = {
            "run_id": "run_0123456789abcdef0123456789abcdef",
            "status": "completed",
            "output": "Release ready",
            "session_id": "must-not-leak",
        }

        response = self.client.get("/api/ad-studio/runs/run_0123456789abcdef0123456789abcdef")

        self.assertEqual(response.status_code, 200)
        run = response.get_json()["run"]
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["output"], "Release ready")
        self.assertNotIn("session_id", run)
        hermes_request.assert_called_once_with(
            "/v1/runs/run_0123456789abcdef0123456789abcdef", timeout=5
        )

    def test_rejects_missing_source_images(self):
        with patch.object(server._project_store, "get_project", return_value=self.project):
            response = self.client.post("/api/ad-studio/runs", json={
                "project_id": "blockwise",
                "placements": ["square"],
                "attachments": [],
            })

        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
