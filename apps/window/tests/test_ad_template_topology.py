import hashlib
import json
import unittest
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

from graph.control_plane import ControlPlaneContracts
from graph.estate_projections import build_projection


ROOT = Path(__file__).resolve().parents[3]
CONTROL = ROOT / "governance" / "control-plane"
RECEIPT_ID = "receipt:ad-template-builder/runtime-consumption-20260831-001"
STAGES = ("source", "build", "render", "compare", "final-check", "live")


class AdTemplateTopologyContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = yaml.safe_load((CONTROL / "catalog.yaml").read_text(encoding="utf-8"))
        cls.receipt = yaml.safe_load((CONTROL / "evidence" / "ad-template-builder-runtime-consumption-20260831-001.yaml").read_text(encoding="utf-8"))

    def test_catalog_validates_and_declares_the_real_boundary(self):
        payload = ControlPlaneContracts(CONTROL).validate()
        nodes = {item["id"]: item for item in payload["catalog"]["nodes"]}
        edges = {item["id"]: item for item in payload["catalog"]["relationships"]}
        self.assertEqual(nodes["component:frank/ad-studio"]["source_locator"], "apps/window/web/js/ad-studio.js")
        self.assertEqual(nodes["route:hermes-tool-runs"]["source_locator"], "apps/window/server.py")
        self.assertEqual(nodes["tool:ad-template-generator"]["evidence_receipt_ids"], [RECEIPT_ID])
        for stage in STAGES:
            self.assertIn(f"component:frank/ad-template-builder/{stage}", nodes)
        self.assertEqual(edges["edge:ad-studio/routes-tool-runs"]["to"], "route:hermes-tool-runs")
        self.assertEqual(edges["edge:hermes-tool-runs/routes-hermes"]["to"], "runtime:hermes-default")
        self.assertEqual(edges["edge:ad-template-generator/executes-source"]["from"], "tool:ad-template-generator")
        self.assertEqual(edges["edge:ad-template-builder/compare-revises-render"]["to"], "component:frank/ad-template-builder/render")

    def test_declared_source_files_contain_the_boundaries_the_graph_names(self):
        studio = (ROOT / "apps" / "window" / "web" / "js" / "ad-studio.js").read_text(encoding="utf-8")
        server = (ROOT / "apps" / "window" / "server.py").read_text(encoding="utf-8")
        self.assertIn('const PIPELINE_STAGES = ["source", "build", "render", "compare", "final-check", "live"]', studio)
        self.assertIn('"final-review.completed"', studio)
        self.assertIn('"template.imported"', studio)
        self.assertIn('schema": "schema://hermes.tool-run-command/v1"', server)
        self.assertIn('hermes_request("/v1/tool-runs"', server)
        self.assertIn('prefix = "/ad-studio/templates/"', server)

    def test_stage_order_and_import_are_bound_to_runtime_receipt(self):
        edges = self.catalog["relationships"]
        stage_edges = [item for item in edges if item["id"].startswith("edge:ad-template-builder/") and "-to-" in item["id"]]
        self.assertEqual(
            [(item["from"].rsplit("/", 1)[-1], item["to"].rsplit("/", 1)[-1]) for item in stage_edges],
            list(zip(STAGES, STAGES[1:])),
        )
        self.assertTrue(all(item["type"] == "produces" for item in stage_edges))
        imported = next(item for item in edges if item["id"] == "edge:ad-template-builder/live-consumes-blockwise")
        self.assertEqual(imported["to"], "project:blockwise")
        self.assertEqual(imported["evidence_receipt_ids"], [RECEIPT_ID])
        self.assertEqual(self.receipt["facts"]["observed_stages"], list(STAGES))
        self.assertEqual(self.receipt["facts"]["final_review"], "accepted")
        self.assertEqual(self.receipt["facts"]["import"]["status"], "imported")

    def test_ad_projection_selects_stages_and_keeps_import_conditional(self):
        nodes = []
        for item in self.catalog["nodes"]:
            nodes.append({"id": item["id"], "kind": item["kind"], "title": item["title"]})
        edges = []
        for item in self.catalog["relationships"]:
            edges.append({"id": item["id"], "from": item["from"], "to": item["to"], "relationship": item["type"]})
        graph = {"graph_revision": "g_" + "a" * 64, "nodes": nodes, "edges": edges}
        unproved = build_projection(graph, "projection:ad-template-builder/architecture")
        self.assertFalse(any(item["relationship"] == "consumes" for item in unproved["relationships"]))
        self.assertTrue(any("No verified Blockwise connection" in item["message"] for item in unproved["findings"]))
        mapping = next(
            item
            for item in yaml.safe_load((CONTROL / "aliases.yaml").read_text(encoding="utf-8"))["external_mappings"]
            if item["id"] == "mapping:ad-template-builder/blockwise"
        )
        evidence = {
            "source_contract": {"receipt_id": "receipt:baseline/frank-vps-20260830-001"},
            "active_runtime": {"receipt_id": RECEIPT_ID},
        }
        projection = build_projection(
            graph,
            "projection:ad-template-builder/architecture",
            mappings=[mapping],
            evidence=evidence,
        )
        selected = {item["id"] for item in projection["nodes"]}
        self.assertTrue({f"component:frank/ad-template-builder/{stage}" for stage in STAGES} <= selected)
        self.assertIn("gate:frank/ad-template-final-review", selected)
        self.assertTrue(any(item["relationship"] == "consumes" for item in projection["relationships"]))
        self.assertEqual(projection["mappings"][0]["destination_id_or_path"], "project:blockwise")

    def test_runtime_receipt_is_schema_valid_and_checksum_bound(self):
        schema = json.loads((CONTROL / "schema" / "receipt.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(list(Draft202012Validator(schema).iter_errors(self.receipt)), [])
        receipt_path = CONTROL / "evidence" / "ad-template-builder-runtime-consumption-20260831-001.yaml"
        checksum = (CONTROL / "evidence" / "ad-template-builder-runtime-consumption-20260831-001.sha256").read_text(encoding="utf-8").split()[0]
        self.assertEqual(hashlib.sha256(receipt_path.read_bytes()).hexdigest(), checksum)


if __name__ == "__main__":
    unittest.main()
