import unittest

from graph.evaluations import EvaluationError, make_receipt, run_evaluation


class EvaluationTests(unittest.TestCase):
    def test_deterministic_structural_scores_and_no_output_persistence(self):
        tasks = [{"id": "rule-precedence", "kind": "rule_precedence", "scope": "frank", "input": {"rules": ["base", "project"]}, "expected": {"winner": "project"}, "source_ids": ["rule:frank/base"]}]
        result = run_evaluation(tasks, lambda task: {"winner": "project", "private": "not persisted"}, source_revisions={"rule:frank/base": "a" * 40})
        self.assertTrue(result["passed"])
        self.assertNotIn("private", result["results"][0])
        self.assertFalse(result["mutated"])

    def test_fresh_context_and_private_fields_rejected(self):
        with self.assertRaises(EvaluationError):
            run_evaluation([{"id": "x", "kind": "skill", "scope": "frank", "input": {"transcript": "secret"}, "expected": {}}], lambda _: {}, source_revisions={"rule:x": "a"})

    def test_receipt_is_redacted_and_machine_readable(self):
        result = run_evaluation([{"id": "x", "kind": "skill", "scope": "frank", "input": {}, "expected": {}}], lambda _: {}, source_revisions={"rule:x": "a"})
        receipt = make_receipt(result, receipt_id="receipt:evaluation/run")
        self.assertEqual(receipt["redaction"], "secret_filtered")
        self.assertNotIn("results", receipt["facts"])


if __name__ == "__main__":
    unittest.main()
