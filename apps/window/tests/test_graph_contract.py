import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.contract import GraphContractError, canonical_manifest_sha256, normalize_manifest


MANIFEST = {
    "schema": "schema://frank.tool-app-manifest/v1",
    "id": "fixture-tool",
    "version": "1.2.0",
    "name": "Fixture Tool",
    "description": "A pure adapter fixture.",
    "scopes": ["global", "project"],
    "settings": {"type": "object", "properties": {"mode": {"type": "string"}}},
    "pipelines": [{
        "schema": "schema://frank.tool-app-pipeline/v1",
        "nodes": [{"id": "prepare", "kind": "step"}, {"id": "publish", "kind": "step"}],
        "edges": [{"from": "prepare", "to": "publish"}],
    }],
    "capabilities": ["display-only"],
    "ignored_secret": "must never appear",
}


class GraphContractTest(unittest.TestCase):
    def test_normalizes_flat_manifest_without_copying_domain_fields(self):
        graph = normalize_manifest(MANIFEST, generated_at="2026-08-14T00:00:00Z")
        self.assertEqual(graph["schema"], "schema://frank.graph/v1")
        self.assertEqual(graph["graph_id"], "tool:fixture-tool")
        self.assertEqual([node["label"] for node in graph["nodes"]], ["prepare", "publish"])
        self.assertTrue(graph["nodes"][0]["extensions"]["frank.graph.entry"])
        self.assertFalse(graph["nodes"][1]["extensions"]["frank.graph.entry"])
        self.assertEqual(graph["edges"][0]["kind"], "control")
        self.assertNotIn("ignored_secret", repr(graph))
        self.assertNotIn("capabilities", graph["extensions"])

    def test_pipeline_defaults_are_runtime_only_and_source_order_is_preserved(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["pipelines"][0].pop("id", None)
        manifest["pipelines"][0].pop("version", None)
        graph = normalize_manifest(manifest, render_scope={"kind": "project", "id": "blockwise"}, generated_at="2026-08-14T00:00:00Z")
        self.assertEqual(graph["graph_id"], "project:blockwise/tool:fixture-tool")
        self.assertEqual(graph["groups"], [])
        self.assertIn("pipeline-0", graph["nodes"][0]["id"])
        self.assertEqual(graph["edges"][0]["source_id"], 0)

    def test_revision_and_digest_are_order_independent(self):
        reordered = {key: MANIFEST[key] for key in reversed(list(MANIFEST))}
        first = normalize_manifest(MANIFEST, generated_at="2026-08-14T00:00:00Z")
        second = normalize_manifest(reordered, generated_at="2026-08-14T00:00:00Z")
        self.assertEqual(first["graph_revision"], second["graph_revision"])
        self.assertEqual(canonical_manifest_sha256(MANIFEST), canonical_manifest_sha256(reordered))

    def test_settings_trace_and_runtime_status_are_redacted_to_references(self):
        graph = normalize_manifest(
            MANIFEST,
            render_scope={"kind": "project", "id": "blockwise"},
            settings_revision={"schema": "schema://frank.tool-app-settings/v1", "scope": {"kind": "project", "id": "blockwise"}, "revision": 4, "settings": {"mode": "safe"}},
            events=[{"node_id": "prepare", "status": "succeeded", "prompt": "never copy"}],
            trace={"schema": "schema://frank.tool-app-trace/v1", "trace_id": "0123456789abcdef0123456789abcdef", "spans": [{"input": "never copy"}]},
            lens="run.trace",
            generated_at="2026-08-14T00:00:00Z",
        )
        self.assertEqual(graph["nodes"][0]["status"], "succeeded")
        self.assertEqual(graph["trace_ref"], {"trace_id": "0123456789abcdef0123456789abcdef"})
        self.assertEqual(graph["nodes"][0]["settings_revision_ref"]["revision"], 4)
        self.assertNotIn("never copy", repr(graph))

    def test_rejects_unknown_lenses_versions_shapes_and_scope(self):
        cases = [
            {"lens": "tool.execute"},
            {"manifest": {**MANIFEST, "schema": "schema://frank.tool-manifest/v2"}},
            {"manifest": {**MANIFEST, "pipelines": [{"schema": "schema://frank.tool-app-pipeline/v1", "nodes": [{"id": "a", "kind": "x", "label": "bad"}], "edges": []}]}},
            {"render_scope": {"kind": "workspace", "id": "missing"}},
        ]
        for case in cases:
            with self.subTest(case=case):
                with self.assertRaises(GraphContractError):
                    normalize_manifest(case.get("manifest", MANIFEST), lens=case.get("lens", "tool.pipeline"), render_scope=case.get("render_scope"), generated_at="2026-08-14T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
