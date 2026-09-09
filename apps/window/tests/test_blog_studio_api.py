import threading
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import server


class BlogStudioApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_upload_dir = server.UPLOAD_DIR
        server.UPLOAD_DIR = Path(self.temp.name) / "uploads"
        server.UPLOAD_DIR.mkdir(parents=True)
        self.client = server.app.test_client()
        self.project = {"id": "blog-project", "name": "Blog project", "root": "blog-project"}

    def tearDown(self):
        server.UPLOAD_DIR = self.previous_upload_dir
        self.temp.cleanup()

    def stage(self, name, content=b"# Source\n\nText body."):
        target = server.UPLOAD_DIR / "batch" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return {"id": target.relative_to(server.UPLOAD_DIR).as_posix(), "name": name, "size": len(content)}

    @staticmethod
    def hermes_success(calls):
        lock = threading.Lock()

        def request(path, payload=None, **kwargs):
            with lock:
                calls.append((path, payload))
                sequence = len(calls)
            if path == "/v1/tool-runs" and kwargs.get("method") == "POST":
                return {
                    "run": {
                        "id": f"trun_{sequence:032x}",
                        "status": "queued",
                        "stage": "source",
                        "scope": {"project_id": "blog-project"},
                        "output": {},
                    }
                }
            return {"run": {"id": "trun_" + "a" * 32, "status": "queued"}}

        return request

    def test_create_topic_only_run_posts_closed_payload(self):
        calls = []
        with (
            mock.patch.object(server._project_store, "get_project", return_value=self.project),
            mock.patch.object(server, "hermes_request", side_effect=self.hermes_success(calls)),
        ):
            response = self.client.post(
                "/api/blog-studio/runs",
                json={"project_id": "blog-project", "topic": "Local-first software"},
            )

        self.assertEqual(response.status_code, 202)
        run = response.get_json()["run"]
        self.assertTrue(run["id"].startswith("trun_"))
        path, payload = calls[0]
        self.assertEqual(path, "/v1/tool-runs")
        self.assertEqual(payload["tool_id"], "content-factory")
        self.assertEqual(payload["action"], "run")
        self.assertEqual(payload["scope"], {"project_id": "blog-project"})
        self.assertEqual(payload["payload"], {"topic": "Local-first software"})
        self.assertNotIn("sources", payload["payload"])

    def test_create_rejects_run_without_any_input(self):
        with mock.patch.object(server._project_store, "get_project", return_value=self.project):
            response = self.client.post("/api/blog-studio/runs", json={"project_id": "blog-project"})
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_unknown_project(self):
        with mock.patch.object(server._project_store, "get_project", return_value=None):
            response = self.client.post("/api/blog-studio/runs", json={"project_id": "nope", "topic": "x"})
        self.assertEqual(response.status_code, 404)

    def test_create_rejects_non_text_sources(self):
        attachment = self.stage("picture.png", content=b"\x89PNG\r\n\x1a\n" + b"\x00" * 40)
        with mock.patch.object(server._project_store, "get_project", return_value=self.project):
            response = self.client.post(
                "/api/blog-studio/runs",
                json={"project_id": "blog-project", "attachments": [attachment]},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("supported text document", response.get_data(as_text=True))

    def test_create_rejects_oversized_or_too_many_sources(self):
        attachment = self.stage("big.md", content=b"# x\n" + b"a" * (server.BLOG_STUDIO_MAX_SOURCE_BYTES + 1))
        with mock.patch.object(server._project_store, "get_project", return_value=self.project):
            oversized = self.client.post(
                "/api/blog-studio/runs",
                json={"project_id": "blog-project", "attachments": [attachment]},
            )
            self.assertEqual(oversized.status_code, 413)

            many = [
                self.stage(f"doc-{index}.md", content=b"# small")
                for index in range(server.BLOG_STUDIO_MAX_SOURCES + 1)
            ]
            too_many = self.client.post(
                "/api/blog-studio/runs",
                json={"project_id": "blog-project", "attachments": many},
            )
            self.assertEqual(too_many.status_code, 413)

    def test_create_source_run_maps_paths_without_leaking_them(self):
        calls = []
        attachment = self.stage("notes.md")
        with (
            mock.patch.object(server._project_store, "get_project", return_value=self.project),
            mock.patch.object(server, "hermes_request", side_effect=self.hermes_success(calls)),
        ):
            response = self.client.post(
                "/api/blog-studio/runs",
                json={"project_id": "blog-project", "attachments": [attachment]},
            )

        self.assertEqual(response.status_code, 202)
        _, payload = calls[0]
        self.assertEqual(len(payload["payload"]["sources"]), 1)
        self.assertEqual(payload["payload"]["sources"][0]["name"], "notes.md")
        self.assertTrue(payload["payload"]["sources"][0]["path"])
        body = response.get_data(as_text=True)
        self.assertNotIn(str(payload["payload"]["sources"][0]["path"]), body)

    def test_action_proxy_rejects_unknown_fields_and_actions(self):
        run_id = "trun_" + "a" * 32
        with mock.patch.object(server, "hermes_request", side_effect=self.hermes_success([])):
            junk = self.client.post(
                f"/api/blog-studio/runs/{run_id}/action",
                json={"action": "approve", "package_sha256": "x", "extra": 1},
            )
            self.assertEqual(junk.status_code, 400)
            unknown = self.client.post(
                f"/api/blog-studio/runs/{run_id}/action",
                json={"action": "teleport"},
            )
            self.assertEqual(unknown.status_code, 400)
            malformed = self.client.post(
                f"/api/blog-studio/runs/{'bad' * 4}/action",
                json={"action": "approve"},
            )
            self.assertEqual(malformed.status_code, 404)

    def test_public_projection_strips_private_fields(self):
        run_id = "trun_" + "b" * 32

        def request(path, payload=None, **kwargs):
            return {
                "run": {
                    "id": run_id,
                    "status": "waiting_review",
                    "stage": "human-approval",
                    "progress": 0.85,
                    "error": "",
                    "attention": True,
                    "scope": {"project_id": "blog-project"},
                    "payload": {"topic": "secret topic", "sources": [{"name": "n.md", "path": "/srv/frank/private/n.md"}]},
                    "output": {
                        "process": "content-factory",
                        "title": "Public title",
                        "evidence": [{"title": "t", "url": "https://example.com", "excerpt": "e"}],
                        "package": {"sha256": "ab" * 32, "files": {}},
                        "qa": {"passed": True, "word_count": 900, "citation_count": 3, "failures": []},
                        "usage": {"input_tokens": 1},
                    },
                    "model_policy": {"primary": {"provider": "p", "model": "m"}},
                }
            }

        with mock.patch.object(server, "hermes_request", side_effect=request):
            response = self.client.get(f"/api/blog-studio/runs/{run_id}")

        self.assertEqual(response.status_code, 200)
        run = response.get_json()["run"]
        body = response.get_data(as_text=True)
        self.assertEqual(run["title"], "Public title")
        self.assertEqual(run["output"]["qa"]["passed"], True)
        self.assertNotIn("payload", run)
        self.assertNotIn("model_policy", run)
        self.assertNotIn("secret topic", body)
        self.assertNotIn("/srv/frank/private", body)
        self.assertNotIn("usage", run["output"])
        self.assertNotIn("input_tokens", body)


if __name__ == "__main__":
    unittest.main()
