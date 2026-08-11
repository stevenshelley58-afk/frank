from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from frank_codegraph.service import (
    DebouncedProjectEvents,
    Project,
    Supervisor,
    TRUSTED_PYTHONPATH,
    authorized,
    build_overlay,
    graph_summary,
    graphify_command,
    ensure_project_layout,
    load_registry,
    normalize_graph_for_publication,
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
        self.assertEqual(command[:5], [sys.executable, "-P", "-m", "graphify", "extract"])
        self.assertEqual(command.count("--exclude"), 3)
        self.assertIn(["--exclude", "generated/**"], [command[index:index + 2] for index in range(len(command) - 1)])

    def test_safe_path_ignores_repo_local_graphify_module_and_package(self) -> None:
        for shadow_kind in ("module", "package"):
            with self.subTest(shadow_kind=shadow_kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                repository = root / "repository"
                target = root / "opt/frank-codegraph/site-packages"
                trusted = target / "graphify"
                repository.mkdir()
                trusted.mkdir(parents=True)
                trusted_init = trusted / "__init__.py"
                trusted_init.write_text("TRUSTED = True\n", encoding="utf-8")
                (trusted / "__main__.py").write_text(
                    "import graphify, json, sys\n"
                    "from pathlib import Path\n"
                    "print(json.dumps({'origin': str(Path(graphify.__file__).resolve()), 'path': sys.path}))\n",
                    encoding="utf-8",
                )
                shadow_code = (
                    "from pathlib import Path\n"
                    "Path('shadow-executed').write_text('unsafe', encoding='utf-8')\n"
                    "raise RuntimeError('repository shadow executed')\n"
                )
                if shadow_kind == "module":
                    (repository / "graphify.py").write_text(shadow_code, encoding="utf-8")
                else:
                    shadow = repository / "graphify"
                    shadow.mkdir()
                    (shadow / "__init__.py").write_text(shadow_code, encoding="utf-8")
                    (shadow / "__main__.py").write_text(shadow_code, encoding="utf-8")

                environment = {
                    "PYTHONPATH": str(target),
                    "PYTHONSAFEPATH": "1",
                    "PYTHONNOUSERSITE": "1",
                    "PYTHONDONTWRITEBYTECODE": "1",
                }
                completed = subprocess.run(
                    [sys.executable, "-P", "-m", "graphify"],
                    cwd=repository,
                    env=environment,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )

                self.assertEqual(completed.returncode, 0, completed.stderr)
                result = json.loads(completed.stdout)
                self.assertEqual(Path(result["origin"]), trusted_init.resolve())
                self.assertNotIn("", result["path"])
                self.assertNotIn(str(repository.resolve()), result["path"])
                self.assertFalse((repository / "shadow-executed").exists())

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

    def test_identical_duplicate_skill_declarations_coalesce_with_canonical_source(self) -> None:
        duplicate_names = ("code-review", "frank-debug", "frank-tdd", "preview-deploy", "to-tickets", "verify-preview")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in duplicate_names:
                content = f"---\nname: {name}\ndescription: {name} skill\n---\n"
                for prefix in (Path("plugin/skills"), Path("skills/engineering")):
                    skill_dir = root / prefix / name
                    skill_dir.mkdir(parents=True)
                    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")

            overlay = build_overlay(Project("frank", "Frank", root, ()), "2026-08-12T00:00:00Z")
            skills = [node for node in overlay["nodes"] if node["type"] == "Skill"]
            self.assertEqual(len(skills), 6)
            self.assertEqual(len({node["id"] for node in skills}), 6)
            for node in skills:
                name = node["name"]
                self.assertEqual(node["source_file"], f"skills/engineering/{name}/SKILL.md")
                self.assertEqual(node["source_files"], [
                    f"plugin/skills/{name}/SKILL.md",
                    f"skills/engineering/{name}/SKILL.md",
                ])

    def test_conflicting_duplicate_skill_declarations_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for prefix, description in ((Path("plugin/skills"), "one"), (Path("skills/engineering"), "two")):
                skill_dir = root / prefix / "code-review"
                skill_dir.mkdir(parents=True)
                (skill_dir / "SKILL.md").write_text(
                    f"---\nname: code-review\ndescription: {description}\n---\n",
                    encoding="utf-8",
                )
            with self.assertRaisesRegex(RuntimeError, "conflicting skill declarations"):
                build_overlay(Project("frank", "Frank", root, ()), "2026-08-12T00:00:00Z")


class PublicationTests(unittest.TestCase):
    def test_publication_normalizes_api_rejected_dangling_duplicate_and_self_edges(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            graph_path = Path(directory) / "graph.json"
            duplicate = {"id": "same", "source": "a", "target": "b", "relation": "imports"}
            graph_path.write_text(json.dumps({
                "nodes": [{"id": "a"}, {"id": "b"}],
                "links": [
                    duplicate,
                    dict(duplicate),
                    {"source": "a", "target": "ref_vitest", "relation": "imports_from"},
                    {"source": "a", "target": "a", "relation": "calls"},
                ],
            }), encoding="utf-8")
            overlay = {"nodes": [{"id": "project:example"}], "edges": []}

            summary, audit = normalize_graph_for_publication(graph_path, overlay)

            self.assertEqual(summary, {"nodes": 2, "edges": 1})
            self.assertEqual(audit["dropped_dangling_edges"], 1)
            self.assertEqual(audit["dropped_duplicate_edges"], 1)
            self.assertEqual(audit["dropped_self_edges"], 1)
            self.assertEqual(audit["dangling_samples"], [{
                "source": "a",
                "target": "ref_vitest",
                "relation": "imports_from",
            }])
            published = json.loads(graph_path.read_text(encoding="utf-8"))
            self.assertEqual(len(published["links"]), 1)
            self.assertEqual(graph_summary(graph_path), summary)

    def test_publication_coalesces_skills_and_records_dangling_edge_audit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            for prefix in (Path("plugin/skills"), Path("skills/engineering")):
                skill_dir = root / prefix / "code-review"
                skill_dir.mkdir(parents=True)
                (skill_dir / "SKILL.md").write_text(
                    "---\nname: code-review\ndescription: Review code\n---\n",
                    encoding="utf-8",
                )
            supervisor = Supervisor(Path(directory) / "output", [Project("example", "Example", root, ())])

            def fake_extract(command: list[str], *_: object) -> tuple[int, str]:
                output = Path(command[command.index("--out") + 1]) / "graphify-out"
                output.mkdir(parents=True)
                (output / "graph.json").write_text(json.dumps({
                    "nodes": [{"id": "source"}, {"id": "target"}],
                    "links": [
                        {"source": "source", "target": "target", "relation": "imports"},
                        {"source": "source", "target": "ref_vitest", "relation": "imports_from"},
                    ],
                }), encoding="utf-8")
                return 0, ""

            with patch("frank_codegraph.service.run_graphify", side_effect=fake_extract):
                supervisor._build_and_publish(supervisor.states["example"].project)

            current = supervisor.output_root / "example" / "current"
            graph = json.loads((current / "graphify-out" / "graph.json").read_text(encoding="utf-8"))
            overlay = json.loads((current / "frank-overlay.json").read_text(encoding="utf-8"))
            status = json.loads((current / "status.json").read_text(encoding="utf-8"))
            all_nodes = [*graph["nodes"], *overlay["nodes"]]
            all_edges = [*graph["links"], *overlay["edges"]]
            node_ids = {node["id"] for node in all_nodes}
            self.assertEqual(len(node_ids), len(all_nodes))
            self.assertTrue(all(edge["source"] in node_ids and edge["target"] in node_ids for edge in all_edges))
            self.assertEqual(status["graphify"]["normalization"]["dropped_dangling_edges"], 1)
            self.assertEqual([node["source_file"] for node in overlay["nodes"] if node["type"] == "Skill"], [
                "skills/engineering/code-review/SKILL.md",
            ])

    def test_scan_activity_quiesces_and_content_changes_debounce_once(self) -> None:
        class ManualTimer:
            instances: list["ManualTimer"] = []

            def __init__(self, _seconds: float, callback) -> None:
                self.callback = callback
                self.cancelled = False
                self.fired = False
                self.daemon = False
                self.instances.append(self)

            def start(self) -> None:
                return

            def cancel(self) -> None:
                self.cancelled = True

            def fire(self) -> None:
                if self.cancelled or self.fired:
                    return
                self.fired = True
                self.callback()

        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory) / "repo"
            repository.mkdir()
            source = repository / "source.py"
            source.write_text("VALUE = 1\n", encoding="utf-8")
            output = repository / ".codegraph-output"
            project = Project("example", "Example", repository, ())
            supervisor = Supervisor(output, [project])
            state = supervisor.states[project.id]
            state.building = True
            supervisor.request_rebuild(project.id, "initial")
            with patch.object(supervisor, "_build_and_publish", return_value=("release-a", {"nodes": 1, "edges": 0})):
                supervisor._run_project(state)

            ready, _health = supervisor.health()
            self.assertTrue(ready)
            self.assertEqual([job["state"] for job in state.jobs.values()], ["succeeded"])

            handler = DebouncedProjectEvents(supervisor, project)
            publication_paths = (
                output / project.id / ".staging" / "candidate" / "graphify-out" / "graph.json",
                output / project.id / "releases" / "release-a" / "status.json",
                output / project.id / "current" / "frank-overlay.json",
            )
            with patch("frank_codegraph.service.threading.Timer", ManualTimer):
                for event_type in ("opened", "read", "closed", "closed_no_write"):
                    handler.on_any_event(SimpleNamespace(event_type=event_type, src_path=str(source)))
                for event_type, path in zip(("created", "modified", "deleted"), publication_paths, strict=True):
                    handler.on_any_event(SimpleNamespace(event_type=event_type, src_path=str(path)))
                handler.on_any_event(SimpleNamespace(
                    event_type="moved",
                    src_path=str(publication_paths[0]),
                    dest_path=str(publication_paths[1]),
                ))

                self.assertEqual(ManualTimer.instances, [])
                self.assertEqual(len(state.jobs), 1)

                handler.on_any_event(SimpleNamespace(event_type="created", src_path=str(repository / "new.py")))
                handler.on_any_event(SimpleNamespace(event_type="modified", src_path=str(source)))
                handler.on_any_event(SimpleNamespace(event_type="deleted", src_path=str(repository / "old.py")))
                handler.on_any_event(SimpleNamespace(
                    event_type="moved",
                    src_path=str(repository / "before.py"),
                    dest_path=str(repository / "after.py"),
                ))

                self.assertEqual(len(ManualTimer.instances), 4)
                self.assertTrue(all(timer.cancelled for timer in ManualTimer.instances[:-1]))
                state.building = True
                for timer in ManualTimer.instances:
                    timer.fire()
                self.assertEqual(len(state.jobs), 2)
                self.assertEqual(sum(job["state"] == "queued" for job in state.jobs.values()), 1)
                for timer in ManualTimer.instances:
                    timer.fire()
                self.assertEqual(len(state.jobs), 2)

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
                self.assertEqual(TRUSTED_PYTHONPATH, "/app:/opt/frank-codegraph/site-packages")
                self.assertEqual(environment["PYTHONPATH"], TRUSTED_PYTHONPATH)
                self.assertEqual(environment["PYTHONNOUSERSITE"], "1")
                self.assertEqual(environment["PYTHONSAFEPATH"], "1")
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
