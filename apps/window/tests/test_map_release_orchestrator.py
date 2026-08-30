import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from graph.control_plane import ControlContractError
from graph.map_release_orchestrator import PromotionError, promote
from graph.map_artifacts import MapArtifactProvider, MapArtifactStore, id_key

MANDATORY = {"projection:vps/world", "projection:frank/architecture", "projection:blockwise/runtime", "projection:mini-frank/knowledge-flow", "projection:ad-template-builder/architecture", "projection:ad-template-builder/workflow"}

class MapReleaseTests(unittest.TestCase):
    def receipt(self, root, keys=MANDATORY):
        manifests = {}
        for index, key in enumerate(sorted(keys)):
            generation = f"generation:test-{index}"
            artifact = f"<html>{index}</html>".encode()
            manifest = {
                "projection_id": key,
                "status": "generated",
                "preview_only": True,
                "generation_id": generation,
                "artifact_hash": "sha256:" + hashlib.sha256(artifact).hexdigest(),
                "graph_revision": "g_" + "a" * 64,
                "source_revisions": {"frank": "b" * 40},
                "deployed_revisions": {"frank": "c" * 40},
                "coverage": ["verified"],
                "exclusions": ["secrets"],
                "archify_version": "1.2.3",
                "archify_hash": "sha256:" + "d" * 64,
                "validation_receipt_id": f"receipt:map/test-{index}",
                "prior_passing_manifest": None,
                "generated_at": "2026-08-30T10:00:00Z",
                "freshness": "fresh",
                "stale_reason": None,
                "stable_id_map": {"service:frank-window": "n_aaaaaaaaaaaaaaaa"},
            }
            target = Path(root) / "maps" / id_key(key) / id_key(generation)
            target.mkdir(parents=True, exist_ok=True)
            (target / "artifact.html").write_bytes(artifact)
            (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            manifests[key] = manifest
        return {"status":"passed", "run_key":"run:test", "manifests":manifests}
    def test_six_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            receipt = self.receipt(d)
            self.assertEqual(promote(receipt=receipt, production_root=d, mandatory=MANDATORY)["status"], "promoted")
            self.assertEqual(promote(receipt=receipt, production_root=d, mandatory=MANDATORY)["status"], "promoted")
            provider = MapArtifactProvider(MapArtifactStore(Path(d)))
            self.assertEqual({item["projection_id"] for item in provider.list_projections()}, MANDATORY)
            self.assertTrue(provider.resolve_current("projection:vps/world")["artifact"])

    def test_selector_rejects_receipt_identity_map_drift(self):
        with tempfile.TemporaryDirectory() as d:
            receipt = self.receipt(d)
            receipt["manifests"]["projection:vps/world"]["stable_id_map"] = {"service:frank-window": "n_bbbbbbbbbbbbbbbb"}
            with self.assertRaises(PromotionError):
                promote(receipt=receipt, production_root=d, mandatory=MANDATORY)

    def test_production_selector_requires_the_exact_six_map_set(self):
        with tempfile.TemporaryDirectory() as d:
            receipt = self.receipt(d)
            promote(receipt=receipt, production_root=d, mandatory=MANDATORY)
            current_path = Path(d, "current.json")
            current = json.loads(current_path.read_text(encoding="utf-8"))
            current["projections"].pop("projection:blockwise/runtime")
            current_path.write_text(json.dumps(current), encoding="utf-8")
            with self.assertRaises(ControlContractError):
                MapArtifactProvider(MapArtifactStore(Path(d))).list_projections()
    def test_conditional_missing_or_extra_rejected_and_lkg_kept(self):
        with tempfile.TemporaryDirectory() as d:
            receipt = self.receipt(d)
            promote(receipt=receipt, production_root=d, mandatory=MANDATORY)
            before=Path(d,"current.json").read_bytes()
            with self.assertRaises(PromotionError): promote(receipt=self.receipt(d, MANDATORY-{"projection:blockwise/runtime"}), production_root=d, mandatory=MANDATORY)
            self.assertEqual(before, Path(d,"current.json").read_bytes())
    def test_failed_receipt_does_not_touch_pointer(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(PromotionError): promote(receipt={"status":"failed"}, production_root=d, mandatory=MANDATORY)
            self.assertFalse(Path(d,"current.json").exists())

    def test_run_key_traversal_and_incomplete_manifest_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            receipt = self.receipt(d)
            receipt["run_key"] = "run:../../escape"
            with self.assertRaises(PromotionError): promote(receipt=receipt, production_root=d, mandatory=MANDATORY)
            self.assertFalse(Path(d, "current.json").exists())
            receipt = self.receipt(d)
            first = next(iter(receipt["manifests"].values()))
            del first["projection_id"]
            with self.assertRaises(PromotionError): promote(receipt=receipt, production_root=d, mandatory=MANDATORY)
            self.assertFalse(Path(d, "current.json").exists())

if __name__ == "__main__": unittest.main()
