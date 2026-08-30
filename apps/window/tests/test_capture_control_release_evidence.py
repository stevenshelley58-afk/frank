import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from acceptance.production_acceptance import AcceptanceReport, _evidence_checks
from graph.map_artifacts import MapArtifactStore
from graph.map_release_orchestrator import promote
from graph.release_state import ReleaseStateStore


ROOT = Path(__file__).parents[3]
SCRIPT = Path(__file__).parents[1] / "scripts" / "capture_control_release_evidence.py"
MANDATORY = {
    "projection:vps/world",
    "projection:frank/architecture",
    "projection:blockwise/runtime",
    "projection:mini-frank/knowledge-flow",
    "projection:ad-template-builder/architecture",
    "projection:ad-template-builder/workflow",
}
SURFACES = ("/", "/mini-frank", "/live", "/map", "/control", "/agenttrail/")
OUTCOMES = {
    "csp", "keyboard", "reduced_motion", "mini_frank_preserved", "live_navigation",
    "map_navigation", "map_artifact", "control_navigation", "records", "runtime_summary",
    "export", "import_preview", "agenttrail_mutation_denied", "no_overflow",
}


class CaptureEvidenceTests(unittest.TestCase):
    def test_stage_flag_contract_is_ordered(self):
        from scripts import capture_control_release_evidence as c
        self.assertEqual(c.STAGE_FLAGS["step5"], c.FLAGS[:5])
        self.assertEqual(c.STAGE_FLAGS["step6c"], c.FLAGS[:8])
        self.assertEqual(c.STAGE_FLAGS["step7c"], c.FLAGS[:12])

    def _maps(self, root: Path) -> None:
        store = MapArtifactStore(root)
        manifests = {}
        for index, projection_id in enumerate(sorted(MANDATORY)):
            artifact = f"<!doctype html><p>{projection_id}</p>".encode("utf-8")
            generation_id = f"generation:step8-{index}"
            manifest = {
                "projection_id": projection_id,
                "graph_revision": "g_" + "a" * 64,
                "generation_id": generation_id,
                "source_revisions": {"frank": "b" * 40},
                "deployed_revisions": {"frank": "c" * 40},
                "coverage": ["verified"],
                "exclusions": ["private-content"],
                "archify_version": "1.2.3",
                "archify_hash": "sha256:" + "d" * 64,
                "validation_receipt_id": f"receipt:map/capture-{index}",
                "artifact_hash": "sha256:" + hashlib.sha256(artifact).hexdigest(),
                "prior_passing_manifest": None,
                "generated_at": "2026-08-30T10:00:00Z",
                "freshness": "fresh",
                "stale_reason": None,
                "status": "generated",
                "preview_only": True,
            }
            store.write_generation(projection_id, generation_id, manifest, artifact)
            manifests[projection_id] = manifest
        promote(
            receipt={"status": "passed", "run_key": "run:step8-capture", "manifests": manifests},
            production_root=root,
            mandatory=MANDATORY,
        )

    def _browser(self, root: Path) -> Path:
        journeys = {}
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        for name, viewport in (("desktop", {"width": 1280, "height": 800}), ("mobile", {"width": 390, "height": 844})):
            screenshots = {}
            for index, surface in enumerate(SURFACES):
                path = root / f"{name}-{index}.png"
                data = f"{name}:{surface}:real-screenshot".encode("utf-8")
                path.write_bytes(data)
                screenshots[surface] = {"path": path.name, "sha256": "sha256:" + hashlib.sha256(data).hexdigest()}
            journeys[name] = {"viewport": viewport, "outcomes": {key: True for key in OUTCOMES}, "screenshots": screenshots}
        receipt = {
            "schema": "frank.browser-journey/v2",
            "status": "pass",
            "url": "https://frank.fail",
            "browser": "chromium",
            "browser_version": "test",
            "authenticated_context": True,
            "journeys": journeys,
            "captured_at": now,
        }
        path = root / "browser-receipt.json"
        path.write_text(json.dumps(receipt), encoding="utf-8")
        return path

    def _inputs(self, root: Path) -> list[str]:
        browser = self._browser(root)
        tests = root / "tests.json"; tests.write_text(json.dumps([{"suite": "full", "status": "passed"}]), encoding="utf-8")
        runtime = root / "runtime.json"; runtime.write_text(json.dumps([{"system": "frank", "health": "healthy"}, {"system": "blockwise", "health": "healthy"}]), encoding="utf-8")
        restore = root / "restore.json"
        restore_captured = datetime.now(timezone.utc).replace(microsecond=0)
        restore.write_text(json.dumps({
            "schema": "frank.restore-drill-evidence/v1",
            "status": "passed",
            "outcome": "pass",
            "content_match": True,
            "receipt_id": "receipt:retention/restore-drill-step8-test",
            "captured_at": restore_captured.isoformat().replace("+00:00", "Z"),
            "fresh_until": (restore_captured + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
            "source_revision_set": {"project:frank": "f" * 40},
            "deployed_revision_set": {"project:frank": "f" * 40},
            "backup_sha256": "sha256:" + "3" * 64,
            "file_count": 3,
            "redaction": "secret_filtered",
            "evidence_uris": [
                "host:/srv/frank/backups/step8/control-graph.tar.gz",
                "host:/srv/frank/backups/step8/source-manifest.json",
                "host:/srv/frank/backups/step8/restored-manifest.json",
            ],
        }), encoding="utf-8")
        return [
            sys.executable, str(SCRIPT),
            "--maps-root", str(root / "maps-root"),
            "--browser-receipt", str(browser),
            "--tests", str(tests),
            "--runtime-evidence", str(runtime),
            "--restore-receipt", str(restore),
            "--release-id", "release-step8-test",
            "--source-sha", "e" * 40,
            "--deployed-sha", "f" * 40,
            "--image-digest", "sha256:" + "1" * 64,
            "--rollback-target", "2" * 40,
            "--reviewer", "Steven",
            "--output-dir", str(root / "bundle"),
        ]

    def test_bundle_passes_release_and_live_acceptance_contracts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); maps_root = root / "maps-root"; self._maps(maps_root)
            result = subprocess.run(self._inputs(root), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            bundle = root / "bundle"
            evidence = json.loads((bundle / "evidence.json").read_text(encoding="utf-8"))
            release = ReleaseStateStore(root / "release-store").create_release("release-step8-test", "step8", evidence)
            self.assertEqual(release["evidence"]["graph_revision"], "g_" + "a" * 64)
            report = AcceptanceReport(); _evidence_checks(evidence, ROOT, report, True, bundle)
            self.assertFalse(report.failed, [item.detail for item in report.failed])
            self.assertEqual({item["projection_id"] for item in evidence["projection_manifests"]}, MANDATORY)

    def test_pre_step8_bundles_have_exact_flags_without_restore_claims(self):
        from scripts import capture_control_release_evidence as c
        expected_counts = {"step5": 5, "step6c": 8, "step7c": 12}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self._maps(root / "maps-root")
            for stage, count in expected_counts.items():
                args = self._inputs(root)
                args[args.index("--restore-receipt"):args.index("--restore-receipt") + 2] = []
                args.extend(["--stage", stage])
                args[args.index("--release-id") + 1] = f"release-{stage}-test"
                output = root / f"bundle-{stage}"
                args[args.index("--output-dir") + 1] = str(output)
                result = subprocess.run(args, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                evidence = json.loads((output / "evidence.json").read_text(encoding="utf-8"))
                self.assertEqual(evidence["stage"], stage)
                self.assertEqual(set(evidence["feature_flags"]), set(c.STAGE_FLAGS[stage]))
                self.assertEqual(len(evidence["feature_flags"]), count)
                self.assertTrue(all(evidence["feature_flags"].values()))
                self.assertNotIn("restore_drill", evidence)
                ReleaseStateStore(root / f"release-store-{stage}").create_release(
                    f"release-{stage}-test", stage, evidence
                )

    def test_step8_without_restore_receipt_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self._maps(root / "maps-root")
            args = self._inputs(root)
            args[args.index("--restore-receipt"):args.index("--restore-receipt") + 2] = []
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)["error_code"], "evidence_rejected")
            self.assertFalse((root / "bundle").exists())

    def test_incomplete_selector_fails_without_publishing_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); maps_root = root / "maps-root"; self._maps(maps_root)
            current_path = maps_root / "current.json"; current = json.loads(current_path.read_text(encoding="utf-8"))
            current["projections"].pop("projection:blockwise/runtime"); current_path.write_text(json.dumps(current), encoding="utf-8")
            result = subprocess.run(self._inputs(root), capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)["error_code"], "evidence_rejected")
            self.assertFalse((root / "bundle").exists())

    def test_metadata_only_restore_receipt_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._maps(root / "maps-root")
            args = self._inputs(root)
            (root / "restore.json").write_text(
                json.dumps({
                    "status": "passed",
                    "receipt_id": "receipt:retention/metadata-only",
                }),
                encoding="utf-8",
            )
            result = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)["error_code"], "evidence_rejected")
            self.assertFalse((root / "bundle").exists())


if __name__ == "__main__":
    unittest.main()
