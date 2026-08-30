import hashlib
import re
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
CONTROL_ROOT = REPO_ROOT / "governance" / "control-plane"
BUILD_CONTEXT = CONTROL_ROOT / "build-context.yaml"
BASELINE_RECEIPT = CONTROL_ROOT / "evidence" / "step0-baseline.yaml"
HERMES_RECEIPT = CONTROL_ROOT / "evidence" / "step0-hermes-remediation.yaml"
RECEIPT_MANIFEST = CONTROL_ROOT / "evidence" / "step0-receipts.sha256"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def scalar(document: str, name: str) -> str:
    match = re.search(rf"(?m)^\s*{re.escape(name)}:\s*([^#\r\n]+?)\s*$", document)
    if not match:
        raise AssertionError(f"missing scalar {name}")
    return match.group(1).strip().strip('"\'')


class ControlBaselineContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = BUILD_CONTEXT.read_text(encoding="utf-8")
        cls.baseline = BASELINE_RECEIPT.read_text(encoding="utf-8")
        cls.hermes = HERMES_RECEIPT.read_text(encoding="utf-8")

    def test_baseline_sha_is_a_remote_commit_and_matches_deployment_receipt(self):
        baseline_sha = scalar(self.context, "accepted_baseline_sha")
        self.assertRegex(baseline_sha, SHA40)
        subprocess.run(
            ["git", "cat-file", "-e", f"{baseline_sha}^{{commit}}"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        )
        self.assertIn(f"origin_sha: {baseline_sha}", self.context)
        self.assertIn(f"deployed_source_sha: {baseline_sha}", self.context)
        self.assertIn(f"project:frank: {baseline_sha}", self.baseline)
        self.assertIn(f"service:frank-window: {baseline_sha}", self.baseline)

    def test_bootstrap_register_is_hash_bound(self):
        register_hash = scalar(self.context, "sha256")
        self.assertRegex(register_hash, SHA256)
        self.assertIn('reviewed_at: "2026-08-30"', self.context)
        self.assertIn("repository_copy_status: pending_step_1", self.context)

    def test_receipts_are_redacted_and_stable_id_scoped(self):
        self.assertIn("id: receipt:baseline/frank-vps-20260830-001", self.baseline)
        self.assertIn("id: receipt:hermes/consolidation-20260830-001", self.hermes)
        for document in (self.baseline, self.hermes):
            self.assertIn("redaction: secret_filtered", document)
            self.assertNotRegex(document, r"(?im)^\s*(api[_-]?key|token|password):\s*\S+")

    def test_receipt_manifest_binds_canonical_repository_bytes(self):
        seen = set()
        evidence_root = RECEIPT_MANIFEST.parent.resolve()
        for line in RECEIPT_MANIFEST.read_text(encoding="utf-8").splitlines():
            expected, relative = line.split("  ", 1)
            self.assertRegex(expected, SHA256)
            path = (evidence_root / relative).resolve()
            self.assertEqual(path.parent, evidence_root)
            self.assertNotIn(path.name, seen)
            seen.add(path.name)
            body = path.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            self.assertEqual(hashlib.sha256(body).hexdigest(), expected)
        self.assertEqual(len(seen), 6)

    def test_one_hermes_and_unknown_evidence_are_explicit(self):
        self.assertIn("id: runtime:hermes-default", self.context)
        self.assertIn("final_state: disabled_and_inactive", self.hermes)
        self.assertIn("active_turn_leases_at_cutover: 0", self.hermes)
        self.assertIn("ad_template_builder_blockwise_runtime_consumption: unknown", self.context)
        self.assertIn("custom_grill_skill_sources: unknown_after_bounded_search", self.context)
        self.assertIn("status: unavailable", self.context)

    def test_canonical_commands_use_the_proven_working_directory(self):
        self.assertIn(
            "focused_tests: cd /projects/frank/apps/window && "
            "python -m unittest discover -s tests",
            self.context,
        )
        self.assertIn("git ls-files -z '*.js' '*.mjs'", self.context)
        self.assertIn("preview-<run-slug>", self.context)


if __name__ == "__main__":
    unittest.main()
