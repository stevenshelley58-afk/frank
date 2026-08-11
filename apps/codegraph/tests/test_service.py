from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from frank_codegraph.service import (
    Project,
    Supervisor,
    authorized,
    build_overlay,
    graph_summary,
    graphify_command,
    ensure_project_layout,
    load_registry,
    prune_releases,
)


class RegistryTests(unittest.TestCase):
    def test_registry_rejects_mount_outside_operator_repositories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "projects.json"
            path.write_text(json.dumps({"projects": [{"id": "bad", "name": "Bad", "mount": "/tmp/bad", "source": "manual"}]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "below /repositories"):
                load_registry(path)

    def test_registry_rejects_traversing_ignore(self) -> None:
        with self.assertRaisesRegex(ValueError, "safe relative patterns"):
            Project.from_json({"id": "frank", "name": "Frank", "mount": "/repositories/frank", "source": "manual", "ignore": ["../outside"]})


class GraphifyContractTests(unittest.TestCase):
    def test_graph_summary_accepts_networkx_links(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            graph = Path(directory) / "graph.json"
            graph.write_text(json.dumps({"nodes": [{"id": "a"}, {"id": "b"}], "links": [{"source": "a", "target": "b"}]}), encoding="utf-8")
            self.assertEqual(graph_summary(graph), {"nodes": 2, "edges": 1})

    def test_graph_summary_enforces_api_node_cap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            graph = Path(directory) / "graph.json"
            graph.write_text(json.dumps({"nodes": [{"id": "a"}, {"id": "b"}], "links": []}), encoding="utf-8")
            with patch("frank_codegraph.service.MAX_GRAPH_NODES", 1):
                with self.assertRaisesRegex(RuntimeError, "safety limits"):
                    graph_summary(graph)

    def test_graphify_command_forwards_validated_excludes(self) -> None:
        project = Project("frank", "Frank", Path("/repositories/frank"), (".git", "node_modules", "generated/**"))
        command = graphify_command(project, Path("/data/stage"))
        self.assertEqual(command[:4], [sys.executable, "-m", "graphify", "extract"])
        self.assertEqual(command.count("--exclude"), 3)
        self.assertIn(["--exclude", "generated/**"], [command[index:index + 2] for index in range(len(command) - 1)])

    def test_control_authorization_is_exact_bearer_token(self) -> None:
        token = "a" * 32
        self.assertTrue(authorized(token, f"Bearer {token}"))
        self.assertFalse(authorized(token, f"bearer {token}"))
        self.assertFalse(authorized(token, None))


class OverlayTests(unittest.TestCase):
    def test_overlay_uses_only_explicit_tool_declarations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text(json.dumps({"name": "@frank/example", "frank": {"tools": ["safe-tool"]}}), encoding="utf-8")
            skill_dir = root / "skills" / "example"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text("---\nname: Example\ntools: [safe-tool, guessed-tool]\n---\nDo work.", encoding="utf-8")
            overlay = build_overlay(Project("example", "Example", root, ()), "2026-08-11T00:00:00Z")
            node_ids = {node["id"] for node in overlay["nodes"]}
            self.assertIn("tool:example:safe-tool", node_ids)
            self.assertNotIn("tool:example:guessed-tool", node_ids)
            self.assertEqual([edge for edge in overlay["edges"] if edge["type"] == "skill_uses_tool"], [{"type": "skill_uses_tool", "source": "skill:example:example", "target": "tool:example:safe-tool"}])


class PublicationTests(unittest.TestCase):
    def test_publication_switches_current_only_after_complete_release(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            (root / "package.json").write_text(json.dumps({"name": "example"}), encoding="utf-8")
            supervisor = Supervisor(Path(directory) / "output", [Project("example", "Example", root, ())])
            def fake_extract(command: list[str], *_: object) -> tuple[int, str]:
                output = Path(command[command.index("--out") + 1]) / "graphify-out"
                output.mkdir(parents=True)
                (output / "graph.json").write_text(json.dumps({"nodes": [{"id": "n"}], "links": []}), encoding="utf-8")
                return 0, ""
            with patch("frank_codegraph.service.run_graphify", side_effect=fake_extract):
                release, _ = supervisor._build_and_publish(supervisor.states["example"].project)
            current = supervisor.output_root / "example" / "current"
            self.assertTrue((current / "graphify-out" / "graph.json").is_file())
            self.assertTrue((current / "frank-overlay.json").is_file())
            self.assertEqual(release, json.loads((current / "status.json").read_text(encoding="utf-8"))["release"])

    def test_supervisor_uses_fixed_graphify_subprocess_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            (root / "package.json").write_text(json.dumps({"name": "example"}), encoding="utf-8")
            supervisor = Supervisor(Path(directory) / "output", [Project("example", "Example", root, ())])

            def fake_extract(command: list[str], _cwd: Path, environment: dict[str, str]) -> tuple[int, str]:
                self.assertEqual(environment["PATH"], "/usr/local/bin")
                self.assertEqual(environment["PYTHONPATH"], "/opt/frank-codegraph/site-packages")
                self.assertEqual(environment["PYTHONDONTWRITEBYTECODE"], "1")
                output = Path(command[command.index("--out") + 1]) / "graphify-out"
                output.mkdir(parents=True)
                (output / "graph.json").write_text(json.dumps({"nodes": [{"id": "n"}], "links": []}), encoding="utf-8")
                return 0, ""

            with patch("frank_codegraph.service.run_graphify", side_effect=fake_extract):
                supervisor._build_and_publish(supervisor.states["example"].project)

    def test_combined_graph_and_overlay_must_fit_api_cap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            (root / "package.json").write_text(json.dumps({"name": "example"}), encoding="utf-8")
            supervisor = Supervisor(Path(directory) / "output", [Project("example", "Example", root, ())])
            def fake_extract(command: list[str], *_: object) -> tuple[int, str]:
                output = Path(command[command.index("--out") + 1]) / "graphify-out"
                output.mkdir(parents=True)
                (output / "graph.json").write_text(json.dumps({"nodes": [{"id": "n"}], "links": []}), encoding="utf-8")
                return 0, ""
            with patch("frank_codegraph.service.run_graphify", side_effect=fake_extract), \
                 patch("frank_codegraph.service.MAX_GRAPH_NODES", 2):
                with self.assertRaisesRegex(RuntimeError, "combined Graphify"):
                    supervisor._build_and_publish(supervisor.states["example"].project)

    def test_valid_current_release_hydrates_readiness_and_refresh_can_degrade(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            root.mkdir()
            (root / "package.json").write_text(json.dumps({"name": "example"}), encoding="utf-8")
            project = Project("example", "Example", root, ())
            supervisor = Supervisor(Path(directory) / "output", [project])
            def fake_extract(command: list[str], *_: object) -> tuple[int, str]:
                output = Path(command[command.index("--out") + 1]) / "graphify-out"
                output.mkdir(parents=True)
                (output / "graph.json").write_text(json.dumps({"nodes": [{"id": "n"}], "links": []}), encoding="utf-8")
                return 0, ""
            with patch("frank_codegraph.service.run_graphify", side_effect=fake_extract):
                supervisor._build_and_publish(project)
            restarted = Supervisor(supervisor.output_root, [project])
            project_root, _, _ = ensure_project_layout(restarted.output_root, project.id)
            restarted._load_runtime_state(restarted.states[project.id], project_root)
            restarted.states[project.id].last_error = "refresh failed"
            ready, health = restarted.health()
            self.assertTrue(ready)
            self.assertTrue(health["refresh_degraded"])

    def test_retention_preserves_current_and_three_prior_releases(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "frank"
            releases = project / "releases"
            releases.mkdir(parents=True)
            (project / ".staging").mkdir()
            names = [f"20260811T00000{index}Z-{index:012x}" for index in range(6)]
            for name in names:
                (releases / name).mkdir()
            (project / "current").symlink_to(Path("releases") / names[-1], target_is_directory=True)
            removed = prune_releases(project)
            self.assertEqual(removed, names[:2])
            self.assertEqual(sorted(path.name for path in releases.iterdir()), names[2:])
            self.assertTrue((project / "current").resolve().is_dir())

    def test_retention_refuses_absolute_current_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "frank"
            releases = project / "releases"
            releases.mkdir(parents=True)
            (project / ".staging").mkdir()
            release = releases / "20260811T000000Z-000000000000"
            release.mkdir()
            (project / "current").symlink_to(release, target_is_directory=True)
            self.assertEqual(prune_releases(project), [])
            self.assertTrue(release.is_dir())

    def test_command_id_replay_returns_same_job(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Project("example", "Example", Path(directory), ())
            supervisor = Supervisor(Path(directory) / "output", [project])
            supervisor.states["example"].building = True
            first = supervisor.request_rebuild("example", "operator-refresh", "command-123")
            replay = supervisor.request_rebuild("example", "operator-refresh", "command-123")
            self.assertEqual(first, replay)
            self.assertEqual(len(supervisor.states["example"].jobs), 1)

    def test_two_commands_coalesce_and_poll_exposes_membership(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Project("example", "Example", Path(directory), ())
            supervisor = Supervisor(Path(directory) / "output", [project])
            supervisor.states["example"].building = True
            first = supervisor.request_rebuild("example", "operator-refresh", "command-123")
            second = supervisor.request_rebuild("example", "operator-refresh", "command-456")
            self.assertEqual(first["jobId"], second["jobId"])
            polled = supervisor.get_job("example", first["jobId"])
            self.assertEqual(polled["commandIds"], ["command-123", "command-456"])
            self.assertNotIn("commandId", polled)

    def test_command_mapping_capacity_evicts_without_saturation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Project("example", "Example", Path(directory), ())
            supervisor = Supervisor(Path(directory) / "output", [project])
            supervisor.states["example"].building = True
            with patch("frank_codegraph.service.MAX_COMMAND_HISTORY", 2):
                supervisor.request_rebuild("example", "operator-refresh", "command-001")
                supervisor.request_rebuild("example", "operator-refresh", "command-002")
                supervisor.request_rebuild("example", "operator-refresh", "command-003")
            self.assertEqual(list(supervisor.states["example"].command_jobs), ["command-002", "command-003"])

    def test_output_layout_rejects_linked_project_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output"
            outside = Path(directory) / "outside"
            output.mkdir()
            outside.mkdir()
            (output / "example").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "real directory"):
                ensure_project_layout(output, "example")


if __name__ == "__main__":
    unittest.main()
