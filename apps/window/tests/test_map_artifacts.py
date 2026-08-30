import base64
import hashlib
import tempfile
import unittest
from pathlib import Path

from graph.control_plane import ControlContractError
from graph.map_artifacts import MapArtifactProvider, MapArtifactStore, id_key


GRAPH = "g_" + "a" * 64
ARCHIFY = "sha256:" + "b" * 64
ARTIFACT = b"<!doctype html><svg xmlns='http://www.w3.org/2000/svg'></svg>"


def manifest(projection="projection:vps/world", generation="generation:vps-world-001", *, artifact=ARTIFACT, **extra):
    value = {
        "projection_id": projection,
        "graph_revision": GRAPH,
        "generation_id": generation,
        "source_revisions": {"frank": "c" * 40},
        "deployed_revisions": {"frank": "d" * 40},
        "generated_at": "2026-08-30T10:00:00Z",
        "coverage": ["workloads", "routes"],
        "exclusions": ["secrets"],
        "archify_version": "1.2.3",
        "archify_hash": ARCHIFY,
        "validation_receipt_id": "receipt:map/vps-world-validation-001",
        "artifact_hash": "sha256:" + hashlib.sha256(artifact).hexdigest(),
        "prior_passing_manifest": None,
        "freshness": "fresh",
        "stale_reason": None,
        "stable_id_map": {"service:frank-window": "n_aaaaaaaaaaaaaaaa"},
        "relationship_count": 1,
        "rendered_relationship_count": 1,
        "status": "generated",
    }
    value.update(extra)
    return value


class MapArtifactStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = MapArtifactStore(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_id_key_is_reversible_and_canonical(self):
        value = "projection:vps/world"
        self.assertEqual(id_key(value), "id_" + base64.urlsafe_b64encode(value.encode()).decode().rstrip("="))
        self.assertNotIn("/", id_key(value))

    def test_passing_generation_advances_preview_current(self):
        generation = manifest()
        target = self.store.write_generation(generation["projection_id"], generation["generation_id"], generation, ARTIFACT)
        pointer = self.store.advance_current(generation["projection_id"], generation["generation_id"], preview_run_key="run:preview-001")
        self.assertTrue(target.joinpath("manifest.json").is_file())
        self.assertEqual(pointer.relative_to(self.root).parts[:2], ("previews", id_key("run:preview-001")))
        resolved = self.store.resolve_current(generation["projection_id"], preview_run_key="run:preview-001")
        self.assertEqual(resolved["artifact"], ARTIFACT)
        self.assertEqual(resolved["manifest"]["graph_revision"], GRAPH)

    def test_failing_generation_preserves_exact_prior_pointer_and_bytes(self):
        first = manifest()
        self.store.write_generation(first["projection_id"], first["generation_id"], first, ARTIFACT)
        self.store.advance_current(first["projection_id"], first["generation_id"], preview_run_key="run:preview-001")
        pointer = self.root / "previews" / id_key("run:preview-001") / "maps" / id_key(first["projection_id"]) / "current.json"
        before = pointer.read_bytes()
        second = manifest(generation="generation:vps-world-002", artifact=b"new artifact")
        bad = dict(second)
        bad["artifact_hash"] = "sha256:" + "e" * 64
        with self.assertRaises(ControlContractError):
            self.store.write_generation(second["projection_id"], second["generation_id"], bad, b"new artifact")
        self.assertEqual(pointer.read_bytes(), before)
        self.assertEqual(self.store.resolve_current(first["projection_id"], preview_run_key="run:preview-001")["artifact"], ARTIFACT)

    def test_generation_is_immutable_and_tamper_is_rejected(self):
        value = manifest()
        target = self.store.write_generation(value["projection_id"], value["generation_id"], value, ARTIFACT)
        self.assertEqual(self.store.write_generation(value["projection_id"], value["generation_id"], value, ARTIFACT), target)
        (target / "artifact.html").write_bytes(b"tampered")
        with self.assertRaises(ControlContractError):
            self.store.write_generation(value["projection_id"], value["generation_id"], value, ARTIFACT)

    def test_manifest_propagates_revisions_and_explicit_missing_coverage(self):
        missing = manifest(
            projection="projection:ad-template-builder/data-flow",
            generation="generation:ad-template-builder-data-flow-001",
            artifact_hash="sha256:" + hashlib.sha256(b"").hexdigest(),
            status="not_generated",
            freshness="unknown",
            stale_reason="active deployed runtime consumption is not evidenced",
            missing_evidence=["active_deployed_runtime_consumption_receipt"],
        )
        target = self.store.write_missing(missing["projection_id"], missing["generation_id"], missing, preview_run_key="run:preview-001")
        resolved = self.store.resolve_current(missing["projection_id"], preview_run_key="run:preview-001")
        self.assertIsNone(resolved["artifact"])
        self.assertEqual(resolved["manifest"]["missing_evidence"], ["active_deployed_runtime_consumption_receipt"])
        self.assertTrue(target.joinpath("manifest.json").is_file())

    def test_rejects_traversal_and_symlinked_artifacts(self):
        value = manifest()
        with self.assertRaises(ControlContractError):
            self.store.write_generation("projection:../escape", value["generation_id"], value, ARTIFACT)
        source = self.root / "outside.html"
        source.write_bytes(ARTIFACT)
        link = self.root / "link.html"
        try:
            link.symlink_to(source)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        with self.assertRaises(ControlContractError):
            self.store.write_generation(value["projection_id"], value["generation_id"], value, link)

    def test_provider_lists_and_resolves_only_preview_current_maps(self):
        value = manifest()
        self.store.write_generation(value["projection_id"], value["generation_id"], value, ARTIFACT)
        self.store.advance_current(value["projection_id"], value["generation_id"], preview_run_key="run:preview-001")
        provider = MapArtifactProvider(self.store, "run:preview-001")
        listed = provider.list_projections()
        self.assertEqual([item["projection_id"] for item in listed], [value["projection_id"]])
        self.assertEqual(provider.resolve_current(value["projection_id"])["artifact"], ARTIFACT)

    def test_production_pointer_has_no_store_api(self):
        self.assertFalse(hasattr(self.store, "promote_production"))
        self.assertFalse((self.root / "maps").exists())


if __name__ == "__main__":
    unittest.main()
