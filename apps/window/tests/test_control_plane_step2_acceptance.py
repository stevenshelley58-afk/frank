"""Step 2 acceptance tests: real declarations, evidence, and safe publication.

These tests intentionally exercise the repository-shaped inputs and the host
publication boundary.  They are not unit tests with permissive fixtures: a
failed assertion is a release gap that must be fixed in the implementation.
"""
from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
CONTROL = ROOT / "governance" / "control-plane"
WINDOW = ROOT / "apps" / "window"

import sys
sys.path.insert(0, str(WINDOW))

from graph.control_contract import (  # noqa: E402
    ControlContractError,
    graph_from_collector_receipt,
    materialize_control_graph,
)
from graph.control_inventory import inventory, matrix_from_declarations  # noqa: E402
from graph.control_plane import ControlPlaneContracts, canonical_sha256  # noqa: E402
from graph.control_store import ControlGraphStore  # noqa: E402
from scripts.control_reconcile import Collector  # noqa: E402


def _yaml(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class Step2AcceptanceTests(unittest.TestCase):
    def test_actual_catalog_materializes_against_graph_schema(self):
        payload = ControlPlaneContracts(CONTROL).validate()
        catalog = payload["catalog"]
        graph, assertions, manifest = materialize_control_graph(
            catalog,
            receipt_ids=["receipt:control/declared"],
            schema_hash="sha256:" + "1" * 64,
            generator_hash="sha256:" + "2" * 64,
        )
        schema = json.loads((CONTROL / "schema" / "graph.schema.json").read_text())
        Draft202012Validator(schema).validate(graph)
        self.assertEqual(manifest["graph_revision"], graph["graph_revision"])
        self.assertEqual(manifest["graph_hash"], canonical_sha256(graph))
        self.assertTrue(graph["nodes"])
        self.assertTrue(all(node["layer"] == "declared" for node in graph["nodes"]))
        self.assertTrue(all(set(assertion) <= {"subject_id", "predicate", "scope_id", "layer", "value", "evidence_receipt_ids"}
                            for assertion in assertions["assertions"]))

    def test_actual_alias_document_does_not_materialize_second_hermes(self):
        payload = ControlPlaneContracts(CONTROL).validate()
        catalog = payload["catalog"]
        aliases = payload["aliases"]
        alias_map = {
            item["alias_id"]: item["canonical_id"]
            for item in aliases.get("aliases", [])
        }
        # A host receipt may name Hermes by a runtime alias.  It must collapse
        # to the one declared canonical identity, never create another node.
        observed = {"nodes": [{"id": "runtime:hermes-default", "authority": "hermes"}], "relationships": []}
        graph, _, _ = materialize_control_graph(catalog, observed, aliases=alias_map)
        hermes = [node for node in graph["nodes"] if node["id"].startswith("runtime:hermes")]
        self.assertEqual([node["id"] for node in hermes], ["runtime:hermes-default"])
        with self.assertRaises(ControlContractError):
            materialize_control_graph(
                catalog,
                {"nodes": [
                    {"id": "runtime:hermes-default", "authority": "hermes"},
                    {"id": "service:hermes-second", "authority": "hermes"},
                ]},
                aliases=alias_map,
            )

    def test_collector_fixture_is_a_real_graph_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            sources = {
                "identity": {"host": "frank-vps", "project": "frank"},
                "revision": {"checkout": "a" * 40},
                "compose": {"containers": ["frank-window"]},
                "systemd": {},
                "caddy": {},
                "monitoring": {"status": "unavailable"},
                "deployment": {},
                "capabilities": {},
                "health": {},
            }
            receipt = Collector(Path(tmp), sources=sources).run("fast")
            self.assertEqual(receipt["status"], "success")
            # The adapter must accept the actual nested collector receipt, not
            # only an undocumented hand-written graph fixture.
            payload = ControlPlaneContracts(CONTROL).validate()
            graph, assertions, manifest = graph_from_collector_receipt(payload["catalog"], receipt)
            schema = json.loads((CONTROL / "schema" / "graph.schema.json").read_text())
            Draft202012Validator(schema).validate(graph)
            self.assertEqual(manifest["graph_revision"], graph["graph_revision"])
            self.assertTrue(assertions["assertions"])

    def test_full_inventory_uses_fixed_mappings_and_deterministic_ids(self):
        declarations = _yaml(CONTROL / "source-adapters.yaml")
        external_roots = sorted({item["root"] for item in declarations["adapters"] if item["root"] != "/projects/frank"})
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            mappings = {root: base / root.strip("/").replace("/", "_") for root in external_roots}
            for target in mappings.values():
                target.mkdir(parents=True, exist_ok=True)
            # One representative file per external adapter, with a secret on
            # the first line to ensure metadata extraction is redacted.
            for item in declarations["adapters"]:
                if item["root"] == "/projects/frank":
                    continue
                target = mappings[item["root"]]
                pattern = item["patterns"][0].replace("**/", "").replace("*", "fixture")
                relative = Path(pattern)
                path = target / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("Authorization: Bearer top-secret\n# Fixture source\n", encoding="utf-8")
            matrix = matrix_from_declarations(CONTROL / "source-adapters.yaml", ROOT, mappings)
            first, second = inventory(matrix), inventory(matrix)
            self.assertGreater(first["record_count"], 0)
            self.assertEqual(first, second)
            self.assertEqual(len({record["id"] for record in first["records"]}), first["record_count"])
            locators = [record["source_locator"] for record in first["records"]]
            missing = [root for root in external_roots
                       if not any(locator.startswith(root + "/") for locator in locators)]
            self.assertFalse(missing, msg=f"declared external roots without materialized records: {missing}")
            self.assertTrue(all(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", record["source_revision"])
                                for record in first["records"]))
            self.assertNotIn("top-secret", json.dumps(first))

    def test_store_rejects_tampering_and_keeps_previous_snapshot(self):
        declared = {"nodes": [{"id": "service:frank-window", "kind": "service", "version": "1"}], "relationships": []}
        with tempfile.TemporaryDirectory() as tmp:
            store = ControlGraphStore(Path(tmp))
            graph, assertions, manifest = materialize_control_graph(declared, receipt_ids=["receipt:control/declared"])
            revision = graph["graph_revision"]
            generation = store.write_generation(revision, graph, assertions, manifest)
            store.advance_current(revision)
            original = store.read_snapshot()
            manifest_path = generation / "manifest.json"
            manifest_path.write_text(manifest_path.read_text(encoding="utf-8").replace(revision, "g_" + "f" * 64), encoding="utf-8")
            with self.assertRaises(ControlContractError):
                store.read_snapshot()
            # A second publication can never overwrite the immutable revision.
            with self.assertRaises(ControlContractError):
                store.write_generation(revision, graph, assertions, manifest)
            self.assertEqual(original["graph"]["graph_revision"], revision)
            with self.assertRaises(ControlContractError):
                store.advance_current("../escape")

    def test_step2_units_flags_and_compose_boundary_are_exact(self):
        flags = _yaml(CONTROL / "feature-flags.yaml")
        self.assertTrue(flags["defaults"])
        self.assertTrue(all(value is False for value in flags["defaults"].values()))
        self.assertFalse(flags["defaults"]["reconciliation_schedules"])
        fast = (WINDOW / "infra" / "control_plane" / "frank-control-reconcile-fast.timer").read_text()
        full = (WINDOW / "infra" / "control_plane" / "frank-control-reconcile-full.timer").read_text()
        self.assertIn("OnBootSec=5m", fast)
        self.assertIn("OnUnitActiveSec=15m", fast)
        self.assertIn("Persistent=true", fast)
        self.assertIn("OnCalendar=*-*-* 03:10:00 UTC", full)
        self.assertIn("Persistent=true", full)
        for unit in ("frank-control-reconcile-fast.service", "frank-control-reconcile-full.service"):
            body = (WINDOW / "infra" / "control_plane" / unit).read_text()
            self.assertIn("User=root", body)
            self.assertIn("Group=hermes", body)
            self.assertIn("ProtectSystem=full", body)
            self.assertIn("ReadWritePaths=/srv/frank/data/window/control-graph", body)
        compose = (WINDOW / "docker-compose.yml").read_text()
        dockerfile = (WINDOW / "Dockerfile").read_text()
        self.assertNotRegex(compose, r"/var/run/docker\.sock|/run/docker\.sock")
        self.assertNotRegex(compose, r"(?m)^\s*-\s*/projects:\s*")
        self.assertIn("context: ../..", compose)
        self.assertIn("COPY governance/control-plane/schema ./governance/control-plane/schema", dockerfile)
        self.assertIn("ENV FRANK_REPOSITORY_ROOT=/app", dockerfile)


if __name__ == "__main__":
    unittest.main()
