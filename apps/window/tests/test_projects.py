import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import project_store
import server


class ProjectStoreTest(unittest.TestCase):
    def test_merges_defaults_custom_projects_and_session_counts(self):
        with tempfile.TemporaryDirectory() as folder:
            store = project_store.ProjectStore(Path(folder) / "projects.json", [{"id": "built-in", "name": "Built in"}])
            store.create_project({"id": "new-one", "name": "New one"}, "session-1")
            store.bind_session("new-one", "session-2")

            projects = {item["id"]: item for item in store.list_projects()}

            self.assertEqual(projects["built-in"]["chat_count"], 0)
            self.assertEqual(projects["new-one"]["chat_count"], 2)
            self.assertEqual(projects["new-one"]["default_chat_id"], "session-2")
            self.assertEqual(store.project_id_for_session("session-1"), "new-one")

    def test_corrupt_registry_fails_closed_without_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "projects.json"
            path.write_text("not-json", encoding="utf-8")
            store = project_store.ProjectStore(path, [])

            with self.assertRaises(project_store.ProjectStoreError):
                store.list_projects()

            self.assertEqual(path.read_text(encoding="utf-8"), "not-json")

    def test_session_cannot_move_between_projects(self):
        with tempfile.TemporaryDirectory() as folder:
            store = project_store.ProjectStore(Path(folder) / "projects.json", [])
            store.create_project({"id": "one", "name": "One"}, "session-1")
            store.create_project({"id": "two", "name": "Two"}, "session-2")

            with self.assertRaises(ValueError):
                store.bind_session("two", "session-1")


class ProjectApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_store = server._project_store
        self.old_roots = server.ROOTS
        self.root = Path(self.temp.name) / "vps"
        (self.root / "projects").mkdir(parents=True)
        server._project_store = project_store.ProjectStore(Path(self.temp.name) / "projects.json", server.DEFAULT_PROJECTS)
        server.ROOTS = {"vps": self.root}
        self.client = server.app.test_client()

    def tearDown(self):
        server._project_store = self.old_store
        server.ROOTS = self.old_roots
        self.temp.cleanup()

    @patch("server.hermes_request")
    def test_tool_free_customer_session_uses_only_its_dedicated_prompt(self, request):
        request.return_value = {"session": {"id": "mini-intake-guide1234"}}
        project = {
            "id": "mini-intake-guide1234",
            "name": "Frank private customer work",
            "root": "mini-intake-guide1234",
        }
        workspace = str(
            server.HERMES_UPLOAD_ROOT.parent / "mini-shared" / "workspaces" / "guide1234"
        )
        customer_prompt = "Speak only in plain business outcomes. Never expose internal systems."

        server._create_project_session(
            project,
            session_id_override="mini-intake-guide1234",
            system_prompt_override=customer_prompt,
            tool_policy="none",
            workspace_override=workspace,
            display_workspace_override="/workspace",
            memory_scope_override="mini-intake/guide1234",
        )

        payload = request.call_args.args[1]
        self.assertEqual(payload["system_prompt"], customer_prompt)
        self.assertNotIn("Canonical workspace", payload["system_prompt"])
        self.assertNotIn("AGENTS.md", payload["system_prompt"])
        self.assertEqual(payload["tool_policy"], "none")

        with self.assertRaises(ValueError):
            server._create_project_session(
                project,
                system_prompt_override=customer_prompt,
                tool_policy="isolated_terminal",
                workspace_override=workspace,
                memory_scope_override="mini-intake/guide1234",
            )

    @patch("server.hermes_request")
    def test_create_project_connects_native_hermes_workspace_chat_and_memory_scope(self, request):
        request.return_value = {"session": {"id": "session-mini", "source": "api_server", "started_at": 10}}

        response = self.client.post("/api/projects", json={
            "name": "Mini Frank",
            "id": "mini-frank-2",
            "blurb": "A smaller Frank experience.",
            "repository_url": "https://github.com/example/mini-frank.git",
            "model": "qwen3.8-max",
            "provider": "custom",
        })

        self.assertEqual(response.status_code, 201, response.get_json())
        data = response.get_json()
        self.assertEqual(data["project"]["workspace"], "/projects/mini-frank-2")
        self.assertEqual(data["project"]["memory_scope"], "workspace/mini-frank-2")
        self.assertEqual(data["session"]["project_id"], "mini-frank-2")
        self.assertIn("clone https://github.com/example/mini-frank.git", data["bootstrap_prompt"])
        payload = request.call_args.args[1]
        self.assertEqual(payload["cwd"], "/projects/mini-frank-2")
        self.assertEqual(payload["workspace"], "/projects/mini-frank-2")
        self.assertIn("Memory workspace: mini-frank-2", payload["system_prompt"])
        self.assertEqual(payload["model"], "qwen3.8-max")
        self.assertEqual(server._project_store.project_id_for_session("session-mini"), "mini-frank-2")

    @patch("server.hermes_request")
    def test_failed_hermes_session_does_not_create_disconnected_project(self, request):
        request.side_effect = RuntimeError("offline")

        response = self.client.post("/api/projects", json={"name": "Disconnected"})

        self.assertEqual(response.status_code, 502)
        self.assertIsNone(server._project_store.get_project("disconnected"))

    @patch("server.hermes_request")
    def test_new_project_chat_is_bound_and_list_projection_includes_project(self, request):
        server._project_store.create_project({
            "id": "custom", "name": "Custom", "root": "custom", "blurb": "Custom",
            "capabilities": [], "default_widgets": [],
        }, "session-first")
        request.side_effect = [
            {"session": {"id": "session-next", "source": "api_server", "started_at": 20}},
            {"data": [{"id": "session-next", "source": "api_server", "started_at": 20}]},
        ]

        created = self.client.post("/api/chat/sessions", json={"title": "New chat", "project_id": "custom"})
        listed = self.client.get("/api/chat/sessions")

        self.assertEqual(created.status_code, 201, created.get_json())
        self.assertEqual(created.get_json()["session"]["project_id"], "custom")
        self.assertEqual(listed.get_json()["sessions"][0]["project_id"], "custom")
        self.assertEqual(request.call_args_list[0].args[1]["cwd"], "/projects/custom")

    def test_project_urls_reject_embedded_credentials(self):
        response = self.client.post("/api/projects", json={
            "name": "Unsafe",
            "repository_url": "https://person:secret@example.com/repo.git",
        })
        self.assertEqual(response.status_code, 400)

        response = self.client.post("/api/projects", json={
            "name": "Unsafe query",
            "repository_url": "https://example.com/repo.git?token=secret",
        })
        self.assertEqual(response.status_code, 400)

    def test_project_lifecycle_edits_archives_and_preserves_bindings(self):
        server._project_store.create_project({
            "id": "custom", "name": "Custom", "root": "custom", "blurb": "Before",
            "live": "", "capabilities": [], "default_widgets": [],
        }, "session-bound")

        saved = self.client.patch("/api/projects/custom", json={
            "name": "Changed", "blurb": "After", "live": "https://example.com", "revision": 0,
        })
        self.assertEqual(saved.status_code, 200, saved.get_json())
        self.assertEqual(saved.get_json()["project"]["root"], "custom")

        archived = self.client.post("/api/projects/custom/archive", json={"revision": 1})
        self.assertEqual(archived.status_code, 200, archived.get_json())
        listed = self.client.get("/api/projects").get_json()
        self.assertNotIn("custom", {item["id"] for item in listed["projects"]})
        self.assertIn("custom", {item["id"] for item in listed["archived_projects"]})
        self.assertEqual(server._project_store.project_id_for_session("session-bound"), "custom")
        self.assertEqual(server._project_store.get_project("custom")["root"], "custom")

        restored = self.client.post("/api/projects/custom/restore", json={"revision": 2})
        self.assertEqual(restored.status_code, 200, restored.get_json())
        self.assertIn("custom", {item["id"] for item in self.client.get("/api/projects").get_json()["projects"]})

    def test_project_lifecycle_rejects_unknown_and_malformed_revisions(self):
        self.assertEqual(self.client.patch("/api/projects/missing", json={"name": "Nope", "revision": 0}).status_code, 404)
        self.assertEqual(self.client.post("/api/projects/blockwise/archive", json={"revision": True}).status_code, 400)
        self.assertEqual(self.client.patch("/api/projects/blockwise", json={"root": "moved"}).status_code, 400)

    def test_project_list_exposes_mini_frank_and_readiness(self):
        (self.root / "projects" / "mini-frank").mkdir()

        response = self.client.get("/api/projects")

        projects = {item["id"]: item for item in response.get_json()["projects"]}
        self.assertEqual(projects["mini-frank"]["setup_state"], "ready")
        self.assertEqual(projects["mini-frank"]["hermes_profile"], "default")
        self.assertEqual(projects["elfwonder"]["memory_scope"], "workspace/elfandwonder")


if __name__ == "__main__":
    unittest.main()
