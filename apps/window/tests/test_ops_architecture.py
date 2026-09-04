"""Architecture guardrails for Frank's read-only ops boundary."""

import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from ops_projections import BlockwiseOpsClient, OpsProjectionStore, ProjectionError, publish_bundle


ROOT = Path(__file__).resolve().parents[1]


class OpsArchitectureTest(unittest.TestCase):
    def test_legacy_upstream_client_is_quarantined(self):
        with self.assertRaisesRegex(ProjectionError, "does not poll Blockwise"):
            BlockwiseOpsClient("https://blockwise.invalid", "not-used")
        with self.assertRaisesRegex(ProjectionError, "does not load Blockwise auth"):
            BlockwiseOpsClient.from_env()

    def test_window_cannot_publish_or_mutate_staged_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ProjectionError, "does not publish ops bundles"):
                publish_bundle({}, root)
            self.assertFalse((root / "current.json").exists())
            self.assertFalse((root / "generations").exists())

    def test_store_reads_a_staged_generation_without_writing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            generation = root / "generations" / "gen-test"
            generation.mkdir(parents=True)
            receipt = {
                "schema": "schema://frank.ops-publication-receipt/v1",
                "project_id": "blockwise",
                "workspace_ids": ["123e4567-e89b-12d3-a456-426614174000"],
                "publication_receipt_id": "receipt:ops/test",
                "source_revision": "hermes-test",
                "source_receipt_ids": ["receipt:ops/source"],
                "published_at": "2026-09-04T00:00:00Z",
                "projection_count": 9,
            }
            receipt_body = json.dumps(receipt) + "\n"
            (generation / "publication-receipt.json").write_text(receipt_body, encoding="utf-8")
            pointer = {
                "schema": "schema://frank.ops-pointer/v1", "version": 1,
                "generation": "gen-test", "publication_receipt_id": "receipt:ops/test",
            }
            pointer_body = json.dumps(pointer) + "\n"
            (root / "current.json").write_text(pointer_body, encoding="utf-8")
            customer_envelope = {
                "schema": "schema://frank.ops.customer-summary/v1", "version": 1,
                "projection": "customers", "project_id": "blockwise",
                "workspace_ids": receipt["workspace_ids"],
                "source_scope": {"project_id": "blockwise", "workspace_ids": receipt["workspace_ids"], "system": "customers"},
                "source_revision": "hermes-test", "source_receipt_ids": receipt["source_receipt_ids"],
                "publication_receipt_id": "receipt:ops/test",
                "published_at": "2026-09-04T00:00:00Z", "fresh_until": "2099-01-01T00:00:00Z",
                "items": [{"id": receipt["workspace_ids"][0], "workspace_id": receipt["workspace_ids"][0], "display_name": "Safe customer"}],
            }
            (generation / "customers.json").write_text(json.dumps(customer_envelope) + "\n", encoding="utf-8")
            for name, spec in __import__("ops_projections").PROJECTION_SPECS.items():
                target = generation / spec["filename"]
                if not target.exists():
                    empty = {**customer_envelope, "schema": spec["schema"], "projection": name, "source_scope": {"project_id": "blockwise", "workspace_ids": receipt["workspace_ids"], "system": name}, "items": []}
                    target.write_text(json.dumps(empty) + "\n", encoding="utf-8")
            files = {spec["filename"]: hashlib.sha256((generation / spec["filename"]).read_bytes()).hexdigest() for spec in __import__("ops_projections").PROJECTION_SPECS.values()}
            files["publication-receipt.json"] = hashlib.sha256((generation / "publication-receipt.json").read_bytes()).hexdigest()
            manifest_input = {"generation": "gen-test", "publication_receipt_id": "receipt:ops/test", "files": files, "pointer_sha256": hashlib.sha256((root / "current.json").read_bytes()).hexdigest()}
            manifest = {"schema": "schema://frank.ops-manifest/v1", "version": 1, **manifest_input, "bundle_sha256": hashlib.sha256(json.dumps(manifest_input, separators=(",", ":")).encode()).hexdigest()}
            (generation / "manifest.json").write_text(json.dumps(manifest) + "\n", encoding="utf-8")
            before = (root / "current.json").read_bytes()
            snapshot = OpsProjectionStore(root).load("customers")
            self.assertEqual(snapshot.status, "ready")
            self.assertEqual(snapshot.items[0]["display_name"], "Safe customer")
            self.assertEqual((root / "current.json").read_bytes(), before)

    def test_frank_deployment_has_no_blockwise_poller_or_secret_mount(self):
        compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        deploy = (ROOT / "deploy.sh").read_text(encoding="utf-8")
        installer = (ROOT / "infra" / "control_plane" / "install.sh").read_text(encoding="utf-8")
        self.assertIn("/srv/frank/data/ops-projections:/ops-projections:ro", compose)
        self.assertNotIn("BLOCKWISE_OPS_BASE_URL", compose + deploy + installer)
        self.assertNotIn("BLOCKWISE_INTERNAL_AUTH_SECRET_FILE", compose + deploy + installer)
        self.assertNotIn("frank-ops-projections", compose + deploy + installer)
        self.assertFalse((ROOT / "scripts" / "publish_ops_projections.py").exists())
        self.assertFalse((ROOT / "infra" / "ops" / "frank-ops-projections.service").exists())
        self.assertFalse((ROOT / "infra" / "ops" / "frank-ops-projections.timer").exists())


if __name__ == "__main__":
    unittest.main()
