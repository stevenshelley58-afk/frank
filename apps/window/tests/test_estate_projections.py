from __future__ import annotations

import unittest

from graph.estate_projections import ProjectionError, build_estate_projections, build_projection


def node(stable_id: str, kind: str, title: str = "Node"):
    return {"id": stable_id, "kind": kind, "title": title, "layer": "declared", "evidence_receipt_ids": ["receipt:test/graph-001"]}


def edge(edge_id: str, source: str, target: str, relationship: str):
    return {"id": edge_id, "from": source, "to": target, "relationship": relationship, "evidence_receipt_ids": ["receipt:test/edge-001"]}


class EstateProjectionTests(unittest.TestCase):
    def graph(self):
        return {
            "graph_revision": "g_" + "a" * 64,
            "nodes": [
                node("project:blockwise", "project", "Blockwise"),
                node("service:blockwise-app", "service", "Blockwise product app"),
                node("store:blockwise-db", "data_store", "Blockwise database"),
                node("release:blockwise", "release", "Blockwise release"),
                node("route:blockwise-health", "route", "Blockwise health"),
                node("project:mini-frank", "project", "Mini Frank knowledge"),
                node("component:frank-window", "component", "Frank Window"),
                node("capability:frank/ad-template-builder", "capability", "Ad Template Builder"),
                node("runtime:hermes-default", "service", "Hermes"),
                node("component:ad-template-output", "component", "Generated template"),
            ],
            "edges": [
                edge("edge:blockwise-app-db", "service:blockwise-app", "store:blockwise-db", "writes"),
                edge("edge:ad-produces", "capability:frank/ad-template-builder", "component:ad-template-output", "produces"),
                edge("edge:ad-hermes", "runtime:hermes-default", "capability:frank/ad-template-builder", "executes"),
            ],
        }

    def test_blockwise_projection_is_scoped_and_reports_coverage(self):
        result = build_projection(self.graph(), "projection:blockwise/runtime")
        ids = {item["id"] for item in result["nodes"]}
        self.assertIn("service:blockwise-app", ids)
        self.assertIn("store:blockwise-db", ids)
        self.assertEqual(result["status"], "generated")
        self.assertEqual(result["cross_links"]["project:blockwise"], "project:blockwise")

    def test_mini_frank_never_contains_runtime_or_service_nodes(self):
        result = build_projection(self.graph(), "projection:mini-frank/knowledge-flow")
        self.assertTrue(result["nodes"])
        self.assertNotIn("service", {item["kind"] for item in result["nodes"]})
        self.assertNotIn("runtime", {item["kind"] for item in result["nodes"]})
        self.assertIn("component:frank-window", {item["id"] for item in result["nodes"]})

    def test_mini_frank_rejects_declared_runtime_node(self):
        graph = self.graph()
        graph["nodes"].append(node("service:mini-frank-runtime", "service", "Mini Frank runtime"))
        with self.assertRaises(ProjectionError):
            build_projection(graph, "projection:mini-frank/knowledge-flow")

    def test_mini_frank_keeps_frank_window_boundary_without_unrelated_routes(self):
        graph = self.graph()
        graph["nodes"].extend([
            node("service:frank-window", "service", "Frank Window"),
            node("route:unrelated-product", "route", "Unrelated route"),
            node("hook:frank/infra/knowledge/generate-mini-frank-sh-a1b2c3d4", "hook", "Mini Frank generator"),
        ])
        result = build_projection(graph, "projection:mini-frank/knowledge-flow")
        ids = {item["id"] for item in result["nodes"]}
        self.assertIn("service:frank-window", ids)
        self.assertIn("hook:frank/infra/knowledge/generate-mini-frank-sh-a1b2c3d4", ids)
        self.assertNotIn("route:unrelated-product", ids)

    def test_unproved_blockwise_consumes_is_not_emitted_and_finding_is_visible(self):
        graph = self.graph()
        graph["nodes"].append(node("project:ad-template-builder", "project", "Ad Template Builder"))
        graph["edges"].append(edge("edge:unproved-consumes", "project:ad-template-builder", "project:blockwise", "consumes"))
        result = build_projection(graph, "projection:ad-template-builder/architecture")
        self.assertFalse(any(item.get("relationship") == "consumes" for item in result["relationships"]))
        self.assertTrue(any("No verified Blockwise connection" in item["message"] for item in result["findings"]))
        self.assertEqual(result["mappings"], [])

    def test_exact_mapping_requires_source_and_active_runtime_evidence(self):
        graph = self.graph()
        graph["nodes"].append(node("project:ad-template-builder", "project", "Ad Template Builder"))
        graph["edges"].append(edge("edge:proved-consumes", "project:ad-template-builder", "project:blockwise", "consumes"))
        mapping = {"id": "mapping:ad-template-builder/blockwise", "canonical_id": "project:ad-template-builder", "destination_id_or_path": "project:blockwise", "status": "verified", "confidence": "high", "evidence_receipt_id": "receipt:mapping/primary-001", "source_revision": "a" * 40}
        evidence = {"source_contract": {"receipt_id": "receipt:mapping/source-contract-001"}, "active_runtime": {"receipt_id": "receipt:mapping/runtime-001"}}
        result = build_projection(graph, "projection:ad-template-builder/architecture", mappings=[mapping], evidence=evidence)
        consumes = [item for item in result["relationships"] if item.get("relationship") == "consumes"]
        self.assertEqual(len(consumes), 1)
        self.assertEqual(result["mappings"][0]["evidence_receipt_ids"], ["receipt:mapping/primary-001", "receipt:mapping/runtime-001", "receipt:mapping/source-contract-001"])

    def test_conditional_data_flow_is_not_generated_without_mapping_proof(self):
        result = build_projection(self.graph(), "projection:ad-template-builder/data-flow")
        self.assertEqual(result["status"], "not_generated")
        self.assertIn("active_deployed_runtime_consumption_receipt", result["missing_evidence"])
        self.assertFalse(result["relationships"])

    def test_all_step_4a_ids_are_deterministic(self):
        first = build_estate_projections(self.graph())
        second = build_estate_projections(self.graph())
        self.assertEqual(first, second)

    def test_rejects_invalid_revision_and_duplicate_graph_ids(self):
        graph = self.graph()
        graph["graph_revision"] = "g_not-a-graph-hash"
        with self.assertRaises(ProjectionError):
            build_projection(graph, "projection:blockwise/runtime")

        graph = self.graph()
        graph["nodes"].append(dict(graph["nodes"][0]))
        with self.assertRaises(ProjectionError):
            build_projection(graph, "projection:blockwise/runtime")

    def test_rejects_unsafe_mapping_values(self):
        graph = self.graph()
        with self.assertRaises(ProjectionError):
            build_projection(
                graph,
                "projection:ad-template-builder/architecture",
                mappings=[{"id": "mapping:ad-template-builder/x", "canonical_id": "project:ad-template-builder", "destination_id_or_path": "../blockwise"}],
            )

    def test_data_flow_requires_covered_inputs_outputs_and_stores(self):
        graph = self.graph()
        mapping = {"id": "mapping:ad-template-builder/blockwise", "canonical_id": "capability:frank/ad-template-builder", "destination_id_or_path": "project:blockwise", "status": "verified", "confidence": "high", "evidence_receipt_id": "receipt:mapping/primary-001", "source_revision": "a" * 40}
        evidence = {"source_contract": {"receipt_id": "receipt:mapping/source-contract-001"}, "active_runtime": {"receipt_id": "receipt:mapping/runtime-001"}}
        result = build_projection(graph, "projection:ad-template-builder/data-flow", mappings=[mapping], evidence=evidence)
        self.assertEqual(result["status"], "not_generated")
        self.assertIn("verified_data", result["missing_evidence"])


if __name__ == "__main__":
    unittest.main()
