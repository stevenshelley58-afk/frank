import unittest

from graph.chat_patterns import ChatPatternError, make_candidate, make_proposal, make_receipt, normalize_aggregate


def aggregate(**extra):
    value = {"theme": "competing_versions", "count_bucket": "3-5", "scope": "frank", "dates": {"from": "2026-08-01", "to": "2026-08-30"}, "owned_conversation_references": ["conversation:abc"], "evidence_receipt_ids": ["receipt:chat/abc"]}
    value.update(extra)
    return value


class ChatPatternTests(unittest.TestCase):
    def test_only_allowlisted_aggregate_shape_is_accepted(self):
        candidate = make_candidate(aggregate(), base_revision="a" * 40)
        self.assertEqual(candidate["status"], "candidate")
        self.assertFalse(candidate["mutated"])
        proposal = make_proposal(candidate, target_id="rule:frank/base")
        self.assertEqual(proposal["status"], "awaiting owner action")
        self.assertNotIn("transcript", proposal)

    def test_private_content_and_low_count_are_rejected(self):
        with self.assertRaises(ChatPatternError): normalize_aggregate(aggregate(transcript="do not persist"))
        with self.assertRaises(ChatPatternError): normalize_aggregate(aggregate(count_bucket="1-2"))

    def test_candidate_receipt_is_immutable_redacted_evidence(self):
        candidate = make_candidate(aggregate(), base_revision="a" * 40)
        receipt = make_receipt(candidate, receipt_id="receipt:chat-pattern/run")
        self.assertEqual(receipt["redaction"], "secret_filtered")
        self.assertTrue(receipt["facts"]["candidate_only"])


if __name__ == "__main__":
    unittest.main()
