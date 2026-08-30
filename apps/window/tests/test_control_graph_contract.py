import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from graph.control_contract import ControlContractError, _resolve_repository_root, derive_graph_revision, graph_from_collector_receipt, materialize_control_graph, reconcile_assertions
from graph.control_store import ControlGraphStore
from graph.control_provider import ControlProvider

DECLARED = {"nodes": [{"id": "service:frank-window", "kind": "service", "version": "1"}], "relationships": []}
OBSERVED = {"nodes": [{"id": "service:frank-window", "kind": "service", "version": "2"}, {"name": "mystery"}], "relationships": []}

RUNTIME_CATALOG = {
    "schema_version": 1,
    "revision": "rev_" + "a" * 40,
    "nodes": [
        {"id": "service:frank-window", "kind": "service", "title": "Frank Window",
         "state_axes": {"lifecycle": "approved", "trust": "reviewed", "installation": "installed",
                         "enablement": "enabled", "production_authority": "operate"},
         "evidence_receipt_ids": ["receipt:reconciliation/fast/test"]},
        {"id": "store:frank-window-data", "kind": "data_store", "title": "Frank Window data",
         "state_axes": {"lifecycle": "approved", "trust": "reviewed", "installation": "installed",
                         "enablement": "enabled", "production_authority": "operate"},
         "evidence_receipt_ids": ["receipt:reconciliation/fast/test"]},
    ],
    "relationships": [],
}

class ControlGraphContractTest(unittest.TestCase):
    def test_shallow_image_path_does_not_crash_repository_resolution(self):
        with tempfile.TemporaryDirectory() as tmp:
            shallow = Path(tmp) / "app" / "graph" / "control_contract.py"
            shallow.parent.mkdir(parents=True)
            shallow.touch()
            self.assertEqual(_resolve_repository_root(shallow), shallow.parent.resolve())
            configured = Path(tmp) / "schema-root"
            self.assertEqual(
                _resolve_repository_root(shallow, str(configured)),
                configured.resolve(),
            )

    def test_deterministic_and_does_not_mutate_inputs(self):
        original = copy.deepcopy(DECLARED)
        a = materialize_control_graph(DECLARED, OBSERVED, receipt_ids=["receipt:one"])
        b = materialize_control_graph(DECLARED, OBSERVED, receipt_ids=["receipt:one"])
        self.assertEqual(a, b); self.assertEqual(DECLARED, original)
        self.assertTrue(any(n["kind"] == "observed-only/unclassified" for n in a[0]["nodes"]))

    def test_duplicate_ids_and_reconciliation(self):
        with self.assertRaises(ControlContractError):
            materialize_control_graph({"nodes": [{"id": "service:x"}, {"id": "service:x"}]})
        got = reconcile_assertions([{"subject_id":"service:x","predicate":"revision","scope_id":"service:x","value":"a"}],
                                   [{"subject_id":"service:x","predicate":"revision","scope_id":"service:x","value":"b"}])
        self.assertEqual(got[0]["reconciliation_result"], "revision_mismatch")

    def test_store_pointer_and_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = ControlGraphStore(Path(tmp)); graph, assertions, manifest = materialize_control_graph(
                DECLARED, {"nodes": [{"id": "service:frank-window", "kind": "service", "version": "1"}], "relationships": []},
            )
            h = graph["graph_revision"]
            store.write_generation(h, graph, assertions, manifest); store.advance_current(h)
            self.assertEqual(ControlProvider(store).snapshot()["status"], "ready")
            (Path(tmp) / "graph" / "current.json").unlink()
            self.assertEqual(ControlProvider(store).snapshot()["status"], "empty")

    def test_store_binds_revision_to_manifest_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = ControlGraphStore(Path(tmp))
            graph, assertions, manifest = materialize_control_graph(DECLARED)
            tampered = copy.deepcopy(manifest)
            tampered["generator_version"] = "attacker"
            with self.assertRaises(ControlContractError):
                store.write_generation(graph["graph_revision"], graph, assertions, tampered)

    def test_store_concurrent_same_generation_converges(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = ControlGraphStore(Path(tmp))
            graph, assertions, manifest = materialize_control_graph(DECLARED)
            def write():
                return store.write_generation(graph["graph_revision"], graph, assertions, manifest)
            with ThreadPoolExecutor(max_workers=2) as executor:
                paths = list(executor.map(lambda _: write(), range(2)))
            self.assertEqual(paths[0], paths[1])
            self.assertEqual(store.graph_root.joinpath(graph["graph_revision"]).is_dir(), True)

    def test_sensitive_instruction_fields_are_not_persisted(self):
        declared = copy.deepcopy(DECLARED)
        declared["nodes"][0].update({"instruction_body": "do not persist", "api_token": "secret-value"})
        graph, assertions, _ = materialize_control_graph(declared)
        serialized = repr((graph, assertions))
        self.assertNotIn("do not persist", serialized)
        self.assertNotIn("secret-value", serialized)

    def test_discovered_unknown_runtime_records_are_observed_only(self):
        receipt = {"status": "success", "scope": "fast", "receipt_id": "receipt:reconciliation/fast/test", "facts": {
            "compose": {"containers": {"mystery": {"status": "ready", "output": "mystery|running|healthy|sha256:x|mystery:current"}}, "volumes": {"mystery-volume": {"status": "ready"}}},
            "systemd": {"mystery.service": {"status": "ready", "output": "LoadState=loaded"}},
            "identity": {"project_checkouts": {"mystery-project": {"status": "metadata_only"}}},
        }}
        graph, _, _ = graph_from_collector_receipt({
            "schema_version": 1, "revision": "rev_" + "a" * 40,
            "nodes": [{"id": "project:frank", "kind": "project", "title": "Frank", "state_axes": {"lifecycle": "approved", "trust": "reviewed", "installation": "installed", "enablement": "enabled", "production_authority": "operate"}, "evidence_receipt_ids": ["receipt:reconciliation/fast/test"]}],
            "relationships": [],
        }, receipt)
        observed = [node for node in graph["nodes"] if node["layer"] == "observed"]
        self.assertGreaterEqual(len(observed), 4)

    def test_known_mount_materializes_deterministic_store_relationship(self):
        receipt = {"status": "success", "scope": "fast", "receipt_id": "receipt:reconciliation/fast/test",
                   "facts": {"compose": {
                       "containers": {"frank-window": {"status": "ready", "mounts": [
                           {"type": "volume", "name": "frank-window-data", "destination": "/data"},
                       ]}},
                       "volumes": {"frank-window-data": {"status": "ready", "name": "frank-window-data",
                                                            "mounted_by": ["frank-window"],
                                                            "used_by": ["service:frank-window"]}},
                   }}}
        first = graph_from_collector_receipt(RUNTIME_CATALOG, receipt)
        second = graph_from_collector_receipt(RUNTIME_CATALOG, receipt)
        self.assertEqual(first, second)
        mounts = [edge for edge in first[0]["edges"] if edge["relationship"] == "uses"]
        self.assertEqual(len(mounts), 1)
        self.assertEqual(mounts[0]["from"], "service:frank-window")
        self.assertEqual(mounts[0]["to"], "store:frank-window-data")

    def test_fixed_docker_output_materializes_named_volume_relationship(self):
        receipt = {"status": "success", "scope": "fast",
                   "receipt_id": "receipt:reconciliation/fast/test", "facts": {
            "compose": {
                "containers": {
                    "frank-window": {
                        "status": "ready",
                        "output": "frank-window|running|healthy|sha256:image|frank-window:current|frank-window-data,",
                    },
                },
                "volumes": {"frank-window-data": {"status": "ready"}},
            },
        }}
        graph, _, _ = graph_from_collector_receipt(RUNTIME_CATALOG, receipt)
        uses = [edge for edge in graph["edges"] if edge["relationship"] == "uses"]
        self.assertEqual([(edge["from"], edge["to"]) for edge in uses], [
            ("service:frank-window", "store:frank-window-data"),
        ])

    def test_unknown_volume_stays_observed_only_and_is_not_promoted(self):
        receipt = {"status": "success", "scope": "fast", "receipt_id": "receipt:reconciliation/fast/test",
                   "facts": {"compose": {
                       "containers": {"frank-window": {"status": "ready", "mounts": [
                           {"type": "volume", "name": "unrelated-volume", "destination": "/other"},
                       ]}},
                       "volumes": {"unrelated-volume": {"status": "ready", "name": "unrelated-volume"}},
                   }}}
        graph, _, _ = graph_from_collector_receipt(RUNTIME_CATALOG, receipt)
        unknown = [node for node in graph["nodes"] if node["layer"] == "observed"
                   and node["id"].startswith("finding:observed-only/")]
        self.assertEqual(len(unknown), 1)
        self.assertFalse(any(edge["to"] == "store:frank-window-data" for edge in graph["edges"]))

    def test_candidate_inventory_records_never_materialize_as_capabilities(self):
        candidate = {"id": "skill:frank/candidate/example", "kind": "skill",
                     "state_axes": {"lifecycle": "draft", "trust": "unreviewed"},
                     "evidence_receipt_ids": ["receipt:reconciliation/fast/test"]}
        accepted = {"id": "skill:frank/accepted/example", "kind": "skill",
                    "state_axes": {"lifecycle": "approved", "trust": "reviewed"},
                    "evidence_receipt_ids": ["receipt:reconciliation/fast/test"]}
        receipt = {"status": "success", "scope": "full",
                   "receipt_id": "receipt:reconciliation/full/test", "facts": {
                       "capabilities": {"inventory": {
                           "records": [candidate, accepted], "accepted_records": [accepted],
                       }},
                   }}
        graph, _, _ = graph_from_collector_receipt(RUNTIME_CATALOG, receipt)
        ids = {node["id"] for node in graph["nodes"]}
        self.assertIn(accepted["id"], ids)
        self.assertNotIn(candidate["id"], ids)
        accepted_node = next(node for node in graph["nodes"] if node["id"] == accepted["id"])
        self.assertEqual(accepted_node["kind"], "skill")
        self.assertEqual(accepted_node["state_axes"]["trust"], "reviewed")

    def test_provider_fails_closed_on_malformed_snapshot(self):
        class MalformedStore:
            def read_snapshot(self):
                return {"manifest": {}, "graph": [], "assertions": {}, "findings": []}
        result = ControlProvider(MalformedStore()).snapshot()
        self.assertEqual(result["status"], "attention")
        self.assertIsNone(result["graph"])

    def test_provider_unavailable_and_error_statuses(self):
        class UnavailableStore:
            def read_snapshot(self):
                raise OSError("storage unavailable")

        class BrokenStore:
            def read_snapshot(self):
                raise RuntimeError("unexpected provider failure")

        self.assertEqual(ControlProvider(UnavailableStore()).snapshot()["status"], "unavailable")
        self.assertEqual(ControlProvider(BrokenStore()).snapshot()["status"], "error")

    def test_store_rechecks_graph_root_after_symlink_swap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "store"
            store = ControlGraphStore(root)
            graph, assertions, manifest = materialize_control_graph(DECLARED)
            moved = Path(tmp) / "moved"
            root.rename(moved)
            try:
                root.symlink_to(moved, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("directory symlinks are unavailable")
            with self.assertRaises(ControlContractError):
                store.write_generation(graph["graph_revision"], graph, assertions, manifest)

    def test_manifest_binds_validated_receipt_and_evidence_hashes(self):
        receipt = "receipt:reconciliation/fast/test"
        digest = "sha256:" + "a" * 64
        graph, _, manifest = materialize_control_graph(
            DECLARED,
            receipt_ids=[receipt],
            observation_receipt_ids=[receipt],
            evidence_receipt_ids=[receipt],
            receipt_hashes={receipt: digest},
            observation_metadata={
                "captured_at": "2026-08-30T00:00:00Z",
                "fresh_until": "2026-08-30T01:00:00Z",
                "freshness": "fresh",
                "confidence": "high",
            },
        )
        self.assertEqual(manifest["receipt_hashes"][receipt], digest)
        self.assertEqual(manifest["observation_metadata"]["confidence"], "high")
        self.assertEqual(derive_graph_revision(graph, manifest), graph["graph_revision"])
        with self.assertRaises(ControlContractError):
            materialize_control_graph(DECLARED, receipt_ids=[receipt], receipt_hashes={receipt: "bad"})

    def test_provider_attention_for_stale_and_material_findings(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = ControlGraphStore(Path(tmp))
            matching = {"nodes": [{"id": "service:frank-window", "kind": "service", "version": "1"}], "relationships": []}
            graph, assertions, manifest = materialize_control_graph(
                DECLARED, matching,
                observation_metadata={"freshness": "stale", "captured_at": "2026-08-30T00:00:00Z"},
            )
            store.write_generation(graph["graph_revision"], graph, assertions, manifest)
            store.advance_current(graph["graph_revision"])
            result = ControlProvider(store).snapshot()
            self.assertEqual(result["status"], "attention")
            self.assertIn("stale", result["error"])

            graph, assertions, manifest = materialize_control_graph(
                DECLARED, {"nodes": [{"id": "service:frank-window", "kind": "service", "version": "2"}], "relationships": []},
            )
            store.write_generation(graph["graph_revision"], graph, assertions, manifest)
            store.advance_current(graph["graph_revision"])
            self.assertEqual(ControlProvider(store).snapshot()["status"], "attention")

    def test_fixed_discovery_rejects_explicit_second_hermes_but_not_name_substring(self):
        receipt = {"status": "success", "scope": "fast", "receipt_id": "receipt:reconciliation/fast/test", "facts": {
            "systemd": {
                "hermes-gateway.service": {"status": "ready", "output": "LoadState=loaded"},
                "hermes-secondary.service": {"status": "ready", "hermes_authority": True, "output": "LoadState=loaded"},
            },
        }}
        with self.assertRaises(ControlContractError):
            graph_from_collector_receipt(RUNTIME_CATALOG, receipt)
        receipt["facts"]["systemd"]["hermes-secondary.service"].pop("hermes_authority")
        graph, _, _ = graph_from_collector_receipt(RUNTIME_CATALOG, receipt)
        self.assertTrue(any(node["layer"] == "observed" for node in graph["nodes"]))

if __name__ == "__main__": unittest.main()
