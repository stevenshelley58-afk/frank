"""Canonical contract fixtures: adapter-owned copies, checksum-verified.

Derives from Session 1's immutable canonical fixtures at
``docs/contracts/fixtures/`` (contract commit
2139353037fe544ca4306c521492846cf2b03c98); the canonical location is never
edited.  If a checksum changes, the contract changed — stop and reconcile.
"""
import hashlib
import json
import unittest
from pathlib import Path

WINDOW_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
CANONICAL = REPO_ROOT / "docs" / "contracts" / "fixtures"

CANONICAL_CHECKSUMS = {
    "api-server-health.json": "ed89907f6c6d65480d662d06062f8ca36c7771ad3279b43592a492d2ad795618",
    "capabilities.json": "a2831d6c520b533e271060c13926fc2fd164db85e1560649e9f8c9a4c83a504f",
    "run-status-failed.json": "23dff0f74c4e8199b4baf671e46914571a184d48019c979c43eb2431e624c160",
    "run-submit.json": "6cd4c58b4f94b152acd163f78c947df1c9dcd8d7ad3577454a6319b33df057ea",
    "serve-status.json": "3ef7d7b6db307ded255002a1c5053291e5149aec0a9a86e217df7be6517d3650",
    "stt-silence-response.json": "140dc1e91cff7d88c9b4263f84ef6e00a88503f6919bce832190779dcb38b323",
    "tool-runs-404.txt": "d5558cd419c8d46bdc958064cb97f963d1ea793866414c025906ec15033512ed",
}


class CanonicalFixtureTest(unittest.TestCase):
    def test_canonical_fixtures_are_unchanged(self):
        for name, expected in CANONICAL_CHECKSUMS.items():
            path = CANONICAL / name
            self.assertTrue(path.is_file(), f"missing canonical fixture: {name}")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(digest, expected, f"canonical fixture changed: {name}")

    def test_run_submit_fixture_matches_runs_client_expectations(self):
        payload = json.loads((CANONICAL / "run-submit.json").read_text())
        self.assertEqual(set(payload), {"run_id", "status", "replayed"})
        self.assertEqual(payload["status"], "started")

    def test_run_status_failed_fixture_has_structured_error_and_terminal(self):
        payload = json.loads((CANONICAL / "run-status-failed.json").read_text())
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["last_event"], "run.failed")
        self.assertIn("error", payload)

    def test_stt_silence_fixture_is_valid_silence(self):
        payload = json.loads((CANONICAL / "stt-silence-response.json").read_text())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["transcript"], "")

    def test_serve_status_fixture_passes_gate(self):
        from hermes_adapter.serve import serve_status_gate

        payload = json.loads((CANONICAL / "serve-status.json").read_text())
        view = serve_status_gate(payload)
        self.assertTrue(view["gateway_ready"])

    def test_capabilities_fixture_declares_runs_idempotency(self):
        payload = json.loads((CANONICAL / "capabilities.json").read_text())
        idem = payload["features"]["runs_idempotency"]
        self.assertTrue(idem["supported"])
        self.assertTrue(idem["durable"])
        self.assertEqual(idem["retention_seconds"], 86400)

    def test_tool_runs_v1_is_retired(self):
        text = (CANONICAL / "tool-runs-404.txt").read_text()
        self.assertIn("404", text)


if __name__ == "__main__":
    unittest.main()
