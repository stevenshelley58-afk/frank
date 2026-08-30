import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from graph.cleanup_report import (
    CleanupError, applicable_reporters, make_receipt, normalize_candidate,
    quota_warning, retention_candidates, run_report, stable_finding_id,
)


class CleanupReportTests(unittest.TestCase):
    def test_applicability_is_language_bounded(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); (root / "app.py").write_text("print('x')")
            self.assertEqual([r.name for r in applicable_reporters(root)], ["jscpd", "vulture"])

    def test_finding_id_is_stable_and_metadata_is_preserved(self):
        args = dict(project_id="project:frank", kind="dead_code", source_revision="abc", evidence_receipt_id="receipt:cleanup/run")
        left = normalize_candidate({"file": "apps/a.py", "confidence": "high", "replacement": "none", "references": ["tests/a.py"]}, **args)
        right = normalize_candidate({"file": "apps/a.py", "confidence": "high", "replacement": "none", "references": ["tests/a.py"]}, **args)
        self.assertEqual(left, right)
        self.assertEqual(left["status"], "candidate")
        self.assertEqual(left["review"]["source_sha"], "abc")

    @patch("graph.cleanup_report.shutil.which", return_value=None)
    def test_unavailable_reporter_is_failure_without_mutation(self, _which):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); (root / "app.py").write_text("print('x')")
            report = run_report(project_id="project:frank", root=root, source_revision="abc", report_kind="dead_code", receipt_id="receipt:cleanup/run")
            self.assertFalse(report["mutated"])
            self.assertTrue(report["errors"])
            self.assertEqual((root / "app.py").read_text(), "print('x')")

    @patch("graph.cleanup_report.shutil.which", return_value="/usr/bin/tool")
    @patch("graph.cleanup_report.subprocess.run")
    def test_parse_error_and_exclusion_are_safe(self, run, _which):
        run.return_value = type("Result", (), {"stdout": json.dumps({"issues": [{"file": "a.py"}, {"file": "vendor/x.py"}]}), "returncode": 0})()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw); (root / "app.py").write_text("print('x')")
            report = run_report(project_id="project:frank", root=root, source_revision="abc", report_kind="dead_code", receipt_id="receipt:cleanup/run", exclusions=["vendor/x.py"])
            self.assertEqual(len(report["findings"]), 1)
            self.assertFalse(report["mutated"])
            self.assertTrue(run.call_args.kwargs["shell"] is False)

    def test_receipt_and_retention_guards(self):
        report = {"project_id": "project:frank", "source_revision": "abc", "captured_at": "2026-01-01T00:00:00Z", "fresh_until": "2026-01-09T00:00:00Z", "findings": [], "errors": []}
        receipt = make_receipt(report, receipt_id="receipt:cleanup/run")
        self.assertEqual(receipt["redaction"], "secret_filtered")
        self.assertTrue(quota_warning(used_bytes=80, quota_bytes=100))
        candidates = retention_candidates(artifacts=[{"id": "old", "modified_at": 0}, {"id": "kept", "modified_at": 0}], referenced_ids={"kept"}, now=__import__("datetime").datetime.fromtimestamp(1000000000, __import__("datetime").timezone.utc))
        self.assertEqual([x["id"] for x in candidates], ["old"])

    def test_guards_reject_invalid_inputs(self):
        with self.assertRaises(CleanupError): stable_finding_id(project_id="not-an-id", kind="dead_code", subject="x", source_revision="a")
        with self.assertRaises(CleanupError): quota_warning(used_bytes=1, quota_bytes=0)


if __name__ == "__main__": unittest.main()
