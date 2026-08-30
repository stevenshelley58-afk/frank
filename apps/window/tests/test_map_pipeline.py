from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from graph.map_pipeline import PROJECTION_IDS, generate_maps, load_archify_pin


class FakeAdapter:
    def project(self, graph, *, projection_id):
        return {
            "projection_id": projection_id,
            "schema_version": 1,
            "nodes": graph["nodes"],
            "relationships": graph["relationships"],
            "coverage": {"status": "complete"},
            "exclusions": [],
        }


class FakeRunner:
    def __init__(self, root, *, fail_phase=None):
        self.root = Path(root)
        self.fail_phase = fail_phase
        self.calls = []

    def run(self, argv, *, timeout, max_output_bytes=None, shell=False):
        self.calls.append((tuple(argv), timeout, max_output_bytes, shell))
        phase = argv[2]
        if phase == "deliver":
            output = Path(argv[-1])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text("<svg></svg>", encoding="utf-8")
        if phase == self.fail_phase:
            return {"returncode": 1, "stderr": "failure details must not enter receipts"}
        return {"returncode": 0, "checks": {name: "passed" for name in (
            "single_svg", "finite_svg", "orthogonal_arrows", "label_route_clearance",
            "relationship_crossings", "relationship_corridors", "container_border_runs",
            "route_rhythm", "legend_clearance",
        )}}


class FakeStore:
    def __init__(self):
        self.generations = []
        self.published = []
        self.failures = []

    def write_generation(self, projection_id, generation_id, manifest, artifact, *, root):
        self.generations.append((projection_id, generation_id, manifest, Path(root)))

    def publish_preview(self, run_key, manifests):
        self.published.append((run_key, manifests))

    def record_failure(self, receipt):
        self.failures.append(receipt)


class MapPipelineTests(unittest.TestCase):
    def _context(self, root: Path) -> tuple[Path, Path]:
        executable = root / "apps" / "window" / "vendor" / "archify" / "archify" / "bin" / "archify.mjs"
        executable.parent.mkdir(parents=True)
        executable.write_text("#!/usr/bin/env node\n", encoding="utf-8")
        digest = hashlib.sha256(executable.read_bytes()).hexdigest()
        context = root / "governance" / "control-plane" / "build-context.yaml"
        context.parent.mkdir(parents=True)
        context.write_text(
            "pinned_upstreams:\n  archify:\n"
            f"    executable_path: {executable.relative_to(root).as_posix()}\n"
            f"    executable_sha256_vps: {digest}\n"
            "    version: test-pin\n",
            encoding="utf-8",
        )
        return context, executable

    def _graph(self):
        return {"graph_revision": "graph:accepted-1", "status": "accepted", "deployed_revision": "release-1", "nodes": [], "relationships": []}

    def test_pin_requires_exact_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context, executable = self._context(root)
            self.assertEqual(load_archify_pin(context, repo_root=root).sha256, hashlib.sha256(executable.read_bytes()).hexdigest())
            executable.write_text("tampered", encoding="utf-8")
            with self.assertRaisesRegex(Exception, "hash mismatch"):
                load_archify_pin(context, repo_root=root)

    def test_passing_generation_advances_preview_for_both_maps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context, _ = self._context(root)
            store = FakeStore()
            runner = FakeRunner(root)
            result = generate_maps(self._graph(), run_key="run-1", build_context_path=context, repo_root=root, preview_root=root / "preview", adapter=FakeAdapter(), artifact_store=store, runner=runner, now="2026-08-30T00:00:00Z")
            self.assertEqual(result["status"], "passed")
            self.assertEqual(set(result["generation_ids"]), set(PROJECTION_IDS))
            self.assertEqual(len(store.generations), 6)
            self.assertEqual([p[0] for p in store.published], ["run-1"])
            self.assertTrue(all(m[2]["preview_only"] for m in store.generations))
            self.assertTrue(all(call[3] is False for call in runner.calls))

    def test_failure_does_not_publish_or_leak_stderr(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context, _ = self._context(root)
            store = FakeStore()
            result = generate_maps(self._graph(), run_key="run-2", build_context_path=context, repo_root=root, preview_root=root / "preview", adapter=FakeAdapter(), artifact_store=store, runner=FakeRunner(root, fail_phase="validate"))
            self.assertEqual(result["status"], "failed")
            self.assertFalse(store.published)
            self.assertEqual(len(store.failures), 1)
            self.assertNotIn("failure details", json.dumps(result))

    def test_rejects_unaccepted_graph_before_running_archify(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context, _ = self._context(root)
            runner = FakeRunner(root)
            result = generate_maps({**self._graph(), "status": "stale"}, run_key="run-3", build_context_path=context, repo_root=root, preview_root=root / "preview", adapter=FakeAdapter(), artifact_store=FakeStore(), runner=runner)
            self.assertEqual(result["status"], "failed")
            self.assertFalse(runner.calls)


if __name__ == "__main__":
    unittest.main()
