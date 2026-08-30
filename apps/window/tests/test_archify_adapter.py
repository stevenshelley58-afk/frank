import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.archify_adapter import (
    SHOWCASE_CHECKS,
    _resolve_window_root,
    build_projection,
    graph_to_archify,
    showcase_check_results,
)


GRAPH = {
    "graph_revision": "g_" + "a" * 64,
    "nodes": [
        {"id": "service:frank-window", "kind": "service", "title": "Frank Window", "layer": "declared", "evidence_receipt_ids": ["receipt:reconciliation/full/test"]},
        {"id": "runtime:hermes-default", "kind": "service", "title": "Hermes", "layer": "declared"},
        {"id": "route:frank-public", "kind": "route", "title": "Public route", "layer": "observed"},
        {"id": "store:frank-window-data", "kind": "data_store", "title": "Window data", "layer": "declared"},
    ],
    "edges": [
        {"id": "edge:frank/window-reads-data", "from": "service:frank-window", "to": "store:frank-window-data", "relationship": "reads"},
        {"id": "edge:frank/window-exposes-route", "from": "service:frank-window", "to": "route:frank-public", "relationship": "exposes"},
    ],
}


class ArchifyAdapterTest(unittest.TestCase):
    def test_window_root_supports_the_shallow_app_image_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "app"
            executable = app / "vendor" / "archify" / "archify" / "bin" / "archify.mjs"
            executable.parent.mkdir(parents=True)
            executable.write_text("", encoding="utf-8")
            self.assertEqual(_resolve_window_root(app / "graph" / "archify_adapter.py", str(app)), app)

    def test_conversion_is_deterministic_and_keeps_stable_cross_links(self):
        first, metadata = graph_to_archify(GRAPH, "projection:frank/architecture", required_coverage=["window", "hermes_boundary", "data", "routes"])
        shuffled = dict(GRAPH, nodes=list(reversed(GRAPH["nodes"])), edges=list(reversed(GRAPH["edges"])))
        second, metadata_two = graph_to_archify(shuffled, "projection:frank/architecture", required_coverage=["window", "hermes_boundary", "data", "routes"])
        self.assertEqual(first, second)
        self.assertEqual(metadata["stable_id_map"], metadata_two["stable_id_map"])
        self.assertEqual(metadata["coverage"]["missing"], [])
        self.assertFalse(metadata["runtime_health_claims"])
        self.assertTrue(all(component["id"].startswith("n_") for component in first["components"]))
        self.assertNotIn("status", json.dumps(first))

    def test_world_projection_preserves_unknown_observed_nodes(self):
        base_nodes = [dict(node, evidence_receipt_ids=[]) for node in GRAPH["nodes"]]
        graph = dict(GRAPH, nodes=base_nodes + [{"id": "finding:observed-only/mystery", "kind": "observed-only/unclassified", "name": "mystery"}])
        diagram, metadata = graph_to_archify(graph, "projection:vps/world", required_coverage=["workloads", "evidence_producers"])
        self.assertIn("finding:observed-only/mystery", metadata["stable_id_map"])
        self.assertEqual(metadata["coverage"]["missing"], ["evidence_producers"])
        self.assertEqual(len(diagram["components"]), len(graph["nodes"]))

    def test_many_long_ids_use_bounded_labels_and_retain_full_identity_metadata(self):
        nodes = [
            {"id": f"service:production-worker-{index:03d}-with-a-very-long-canonical-name", "kind": "service",
             "title": f"Production worker {index:03d} with a very long descriptive title"}
            for index in range(245)
        ]
        edges = [
            {"id": f"edge:worker-{index:03d}", "from": nodes[index]["id"], "to": nodes[index + 1]["id"], "relationship": "feeds"}
            for index in range(244)
        ]
        graph = {"graph_revision": GRAPH["graph_revision"], "nodes": nodes, "edges": edges}
        diagram, metadata = graph_to_archify(graph, "projection:vps/world")
        self.assertEqual(len(diagram["components"]), 245)
        self.assertTrue(all(len(component["label"]) <= 28 for component in diagram["components"]))
        self.assertTrue(all(len(component.get("sublabel", "")) <= 24 for component in diagram["components"]))
        self.assertEqual(diagram["layout"]["cols"], 12)
        self.assertTrue(all(component["size"] == [98, 26] for component in diagram["components"]))
        self.assertEqual(len({tuple(component["pos"]) for component in diagram["components"]}), 245)
        self.assertEqual(diagram["connections"], [])
        self.assertEqual(metadata["relationship_count"], 244)
        self.assertEqual(metadata["rendered_relationship_count"], 0)
        self.assertEqual(metadata["exclusions"], ["relationships_render_in_control_graph"])
        self.assertEqual(set(metadata["stable_id_map"]), {node["id"] for node in nodes})
        self.assertEqual(set(metadata["display_labels"]), set(metadata["stable_id_map"]))

    def test_build_metadata_contains_revisions_and_input_hash(self):
        result = build_projection(GRAPH, "projection:frank/architecture", source_revisions={"repo:frank": "a" * 40}, deployed_revisions={"release:frank": "b" * 40})
        self.assertEqual(result["metadata"]["graph_revision"], GRAPH["graph_revision"])
        self.assertEqual(result["metadata"]["source_revisions"]["repo:frank"], "a" * 40)
        self.assertTrue(result["metadata"]["input_hash"].startswith("sha256:"))

    def test_showcase_receipt_requires_all_nine_named_checks(self):
        receipt = {"checks": [{"name": name, "ok": True} for name in SHOWCASE_CHECKS]}
        self.assertEqual(showcase_check_results(receipt), {name: True for name in SHOWCASE_CHECKS})
        self.assertFalse(all(showcase_check_results({"checks": []}).values()))


if __name__ == "__main__":
    unittest.main()
