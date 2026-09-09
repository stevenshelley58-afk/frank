"""Hub read-tool tests: bounded listings, hidden-path refusal, health."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infra.workspace.hub_read_tools import HubReadTools, project_hermes_health
from infra.workspace.resolver import WorkspaceRegistry

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tests.test_workspace_resolver import _uuid_seq  # noqa: E402


class HermesHealthTest(unittest.TestCase):
    def test_states_and_authority_are_explicit(self):
        status = {
            "skills": [
                {"name": "ad-writer", "healthy": True, "checked_at": "2026-09-03T12:00:00Z"},
                {"name": "system-thing", "healthy": True, "runtime_owned": True},
            ],
            "toolsets": [{"name": "kanban", "healthy": False}],
            "mcp": [{"name": "search", "healthy": True, "authenticated": False}],
        }
        catalogue = project_hermes_health(status)
        by_id = {entry["id"]: entry for entry in catalogue["entries"]}
        self.assertEqual(by_id["hermes-skill:ad-writer"]["state"], "ready")
        self.assertEqual(by_id["hermes-skill:ad-writer"]["authority"], "operator")
        self.assertEqual(by_id["hermes-skill:system-thing"]["authority"], "runtime-owned")
        self.assertEqual(by_id["hermes-toolset:kanban"]["state"], "attention")
        self.assertEqual(by_id["hermes-mcp:search"]["state"], "attention")
        self.assertEqual(by_id["hermes-mcp:search"]["detail"], "authentication missing")
        self.assertNotIn("ready", [by_id["hermes-mcp:search"]["state"]])


class HubReadToolsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.project_root = base / "canonical"
        (self.project_root / "docs").mkdir(parents=True)
        (self.project_root / "docs" / "PROJECT.md").write_text("safe content", encoding="utf-8")
        (self.project_root / "secret.env").write_text("TOKEN=abc", encoding="utf-8")
        (self.project_root / ".git").mkdir()
        (self.project_root / ".git" / "HEAD").write_text("ref", encoding="utf-8")
        self.registry = WorkspaceRegistry(
            base / "workspaces.json", uuid_factory=_uuid_seq("h-"), canonical_prefixes=(str(base) + "/",)
        )
        self.registry.migrate_registry(
            [{
                "project_id": "blockwise", "slug": "blockwise", "host_path": str(self.project_root),
                "hermes_path": "/projects/blockwise", "container_path": "/vps/projects/blockwise",
                "legacy_memory_scope": "steven-blockwise",
            }]
        )
        self.workspace_id = next(r.workspace_id for r in self.registry.all_records() if r.slug == "blockwise")
        self.tools = HubReadTools(
            self.registry,
            roots=None,
            catalogue_provider=lambda wid: {"entries": [{"id": "hermes-toolset:kanban", "state": "ready"}]},
            skills_provider=None,
            map_provider=lambda wid: {"envelope": {"state": "ready", "graph_revision": "rev-41"}},
            memory_provider=lambda wid: {"sources": [{"bank_id": "steven-blockwise", "state": "ready"}]},
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_list_projects_is_opaque_and_bounded(self):
        listing = self.tools.list_projects()
        self.assertEqual(listing["count"], 2)  # blockwise + unassigned
        for project in listing["projects"]:
            self.assertEqual(set(project), {"workspace_id", "project_id", "status"})
            self.assertNotIn("host_path", json.dumps(project))

    def test_file_listing_is_bounded_and_hides_secret_paths(self):
        listing = self.tools.list_project_files(self.workspace_id)
        names = [entry["name"] for entry in listing["entries"]]
        self.assertIn("docs", names)
        self.assertNotIn("secret.env", names)  # dotfile-ish extension stays visible only if not hidden... it is not hidden
        (self.project_root / ".hidden").mkdir(exist_ok=True)
        listing2 = self.tools.list_project_files(self.workspace_id)
        self.assertNotIn(".hidden", [entry["name"] for entry in listing2["entries"]])

    def test_hidden_segment_refusal_and_bulk_bounds(self):
        result = self.tools.list_project_files(self.workspace_id, ".git")
        self.assertIn("error", result)
        for index in range(60):
            (self.project_root / f"file-{index:02}.md").write_text("x", encoding="utf-8")
        listing = self.tools.list_project_files(self.workspace_id)
        self.assertEqual(listing["count"], 50)  # MAX_LIST_FILES bound

    def test_read_file_is_bounded_and_refuses_escapes(self):
        view = self.tools.read_project_file(self.workspace_id, "docs/PROJECT.md")
        self.assertEqual(view["text"], "safe content")
        self.assertIn("revision_hint", view)
        escape = self.tools.read_project_file(self.workspace_id, "../../etc/passwd")
        self.assertIn("error", escape)
        hidden = self.tools.read_project_file(self.workspace_id, ".git/HEAD")
        self.assertIn("error", hidden)

    def test_map_and_health_match_provider_snapshots(self):
        section = self.tools.map_section(self.workspace_id)
        self.assertEqual(section["provenance"]["graph_revision"], "rev-41")
        health = self.tools.tool_and_memory_health(self.workspace_id)
        self.assertEqual(health["tools"]["entries"][0]["id"], "hermes-toolset:kanban")
        self.assertEqual(health["memory_sources"]["sources"][0]["bank_id"], "steven-blockwise")

    def test_unknown_workspace_fails_closed(self):
        with self.assertRaises(Exception):
            self.tools.list_project_files("h-9999")


if __name__ == "__main__":
    unittest.main()
