import tempfile
import unittest
from pathlib import Path

from acceptance.production_acceptance import run_acceptance


ROOT = Path(__file__).resolve().parents[3]


class Step8AcceptanceHarnessTests(unittest.TestCase):
    def test_repository_contracts_pass_without_fabricating_live_evidence(self):
        report = run_acceptance(ROOT)
        self.assertFalse(report.failed, [f.detail for f in report.failed])
        self.assertTrue(any(f.name == "production.evidence" and f.status == "pending" for f in report.findings))

    def test_live_receipt_requires_all_bindings_and_exact_flag_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "receipt.yaml"
            path.write_text("""source_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
image_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
deployed_sha: 'cccccccccccccccccccccccccccccccccccccccc'
graph_revision: 'g_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
projection_manifests: [real]
tests: [real]
runtime_health: [real]
browser_review: [real]
screenshot_hashes: [real]
reviewer: Steven
rollback_target: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
feature_flag_hash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
feature_flags: {live_view: true}
timestamp: '2026-08-30T00:00:00Z'
""", encoding="utf-8")
            report = run_acceptance(ROOT, path, require_live=True)
            self.assertTrue(any(f.name == "production.all-flags-bound" and f.status == "fail" for f in report.findings))


if __name__ == "__main__":
    unittest.main()
