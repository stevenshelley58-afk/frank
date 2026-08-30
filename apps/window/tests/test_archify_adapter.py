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

    def test_world_projection_keeps_topology_and_leaves_unclassified_findings_in_control(self):
        base_nodes = [dict(node, evidence_receipt_ids=[]) for node in GRAPH["nodes"]]
        graph = dict(GRAPH, nodes=base_nodes + [{"id": "finding:observed-only/mystery", "kind": "observed-only/unclassified", "name": "mystery", "layer": "observed"}])
        diagram, metadata = graph_to_archify(graph, "projection:vps/world", required_coverage=["workloads", "evidence_producers"])
        self.assertNotIn("finding:observed-only/mystery", metadata["stable_id_map"])
        self.assertEqual(metadata["coverage"]["missing"], ["evidence_producers"])
        self.assertEqual(len(diagram["components"]), len(base_nodes))

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
        self.assertEqual(metadata["exclusions"], ["additional_relationships_in_control"])
        self.assertEqual(set(metadata["stable_id_map"]), {node["id"] for node in nodes})
        self.assertEqual(set(metadata["display_labels"]), set(metadata["stable_id_map"]))

    def test_large_frank_projection_uses_bounded_overview(self):
        nodes = [
            {"id": f"service:frank-worker-{index:03d}", "kind": "service"}
            for index in range(100)
        ]
        graph = {"graph_revision": GRAPH["graph_revision"], "nodes": nodes, "edges": []}
        diagram, metadata = graph_to_archify(graph, "projection:frank/architecture")
        self.assertEqual(len(diagram["components"]), 100)
        self.assertEqual(diagram["layout"]["cols"], 12)
        self.assertTrue(all(component["size"] == [98, 26] for component in diagram["components"]))
        self.assertEqual(metadata["rendered_relationship_count"], 0)

    def test_compact_overview_uses_canonical_names_not_ordinals(self):
        nodes = [
            {"id": "capability:frank-search", "kind": "capability", "title": "Search the knowledge base"},
            {"id": "hook:window-submit", "kind": "hook", "name": "Submit to Frank Window"},
        ] + [
            {"id": f"service:frank-worker-{index:02d}", "kind": "service"}
            for index in range(12)
        ]
        diagram, metadata = graph_to_archify(
            {"graph_revision": GRAPH["graph_revision"], "nodes": nodes, "edges": []},
            "projection:vps/world",
        )
        labels = metadata["display_labels"]
        self.assertEqual(labels["capability:frank-search"]["label"], "Search the knowledge base")
        self.assertEqual(labels["hook:window-submit"]["label"], "Submit to Frank Window")
        self.assertNotIn("cap 001", {item["label"] for item in labels.values()})
        self.assertEqual(metadata["display_labels"]["capability:frank-search"]["archify_id"], diagram["components"][0]["id"])

    def test_file_backed_fallbacks_use_distinctive_names(self):
        nodes = [
            {"id": "app:frank/tools/ad-intelligence/home-json-7de40ad489db", "kind": "app"},
            {"id": "hook:frank/apps/window/infra/knowledge/generate-mini-frank-sh-b3a4883e9723", "kind": "hook"},
            {"id": "template:frank/knowledge/sources/manifests/frank-memory-contract-json-5b89ca722691", "kind": "template"},
        ]
        diagram, _ = graph_to_archify({"graph_revision": GRAPH["graph_revision"], "nodes": nodes}, "projection:vps/world")
        self.assertEqual(
            [component["label"] for component in diagram["components"]],
            ["Ad Intelligence Home", "Generate Mini Frank", "Frank Memory Contract"],
        )

    def test_large_overview_keeps_authored_labels_instead_of_type_indexes(self):
        nodes = [
            {"id": "capability:hermes-operator", "kind": "capability", "title": "Hermes operator controls"},
            {"id": "host:production-vps", "kind": "host", "title": "Production VPS"},
            *({"id": f"service:worker-{index:02d}", "kind": "service", "title": f"Worker {index:02d}"} for index in range(12)),
        ]
        graph = {"graph_revision": GRAPH["graph_revision"], "nodes": nodes}
        diagram, metadata = graph_to_archify(graph, "projection:vps/world")
        labels = [component["label"] for component in diagram["components"]]
        self.assertIn("Hermes operator", labels[0])
        self.assertIn("Production VPS", labels[1])
        self.assertNotIn("cap 001", labels)
        self.assertNotIn("hoo 002", labels)
        self.assertTrue(all(component["sublabel"] for component in diagram["components"]))
        self.assertEqual(set(metadata["display_labels"]), {node["id"] for node in nodes})

    def test_multirow_projection_uses_first_screen_overview(self):
        nodes = [{"id": f"service:blockwise-{index:02d}", "kind": "service"} for index in range(14)]
        edges = [{"id": "edge:blockwise", "from": nodes[0]["id"], "to": nodes[-1]["id"]}]
        graph = {"graph_revision": GRAPH["graph_revision"], "nodes": nodes, "edges": edges}
        diagram, metadata = graph_to_archify(graph, "projection:blockwise/runtime")
        self.assertEqual(diagram["layout"]["cols"], 4)
        self.assertEqual(len(diagram["connections"]), 1)
        self.assertEqual(metadata["exclusions"], [])

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
