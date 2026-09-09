import tempfile
import threading
import unittest
from pathlib import Path

from hermes_adapter.ledger import LedgerError, OperationLedger, payload_digest


class OperationLedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger = OperationLedger(Path(self.tmp.name) / "ledger")

    def tearDown(self):
        self.tmp.cleanup()

    def test_prepare_journals_hash_and_metadata_only(self):
        payload = {"message": "secret prompt text", "model": "m1"}
        record = self.ledger.prepare("prompt.submit", "session-1", payload, refs={"frank_turn": "t1"})
        self.assertEqual(record["state"], "prepared")
        self.assertEqual(record["payload_sha256"], payload_digest(payload))
        raw = (Path(self.tmp.name) / "ledger" / f"{record['op_id']}.json").read_text()
        self.assertNotIn("secret prompt text", raw)

    def test_forbidden_metadata_keys_rejected(self):
        with self.assertRaises(LedgerError):
            self.ledger.prepare("prompt.submit", "s", {}, refs={"prompt": "text"})
        with self.assertRaises(LedgerError):
            self.ledger.prepare("prompt.submit", "s", {}, refs={"password": "hunter2"})
        with self.assertRaises(LedgerError):
            self.ledger.prepare("prompt.submit", "s", {}, refs={"nested": {"session_token": "x"}})

    def test_lifecycle_prepared_sending_acknowledged(self):
        record = self.ledger.prepare("cron.trigger", "job-9", {"at": 1})
        op_id = record["op_id"]
        self.ledger.mark_sending(op_id)
        self.ledger.mark_acknowledged(op_id, result_refs={"runtime_id": "r1"})
        final = self.ledger.get(op_id)
        self.assertEqual(final["state"], "acknowledged")
        self.assertEqual(final["result_refs"], {"runtime_id": "r1"})
        self.assertEqual([entry["state"] for entry in final["history"]], ["prepared", "sending", "acknowledged"])

    def test_uncertain_requires_reason_and_resolves_from_evidence(self):
        record = self.ledger.prepare("prompt.submit", "s", {})
        op_id = record["op_id"]
        self.ledger.mark_sending(op_id)
        self.ledger.mark_uncertain(op_id, "socket dropped after write")
        self.assertEqual(self.ledger.get(op_id)["state"], "uncertain")
        self.ledger.resolve(op_id, "acknowledged", evidence={"event": "message.complete", "sequence": 9})
        resolved = self.ledger.get(op_id)
        self.assertEqual(resolved["state"], "resolved")
        self.assertEqual(resolved["resolved_outcome"], "acknowledged")
        with self.assertRaises(LedgerError):
            self.ledger.resolve(op_id, "failed")

    def test_outstanding_scoped_by_target(self):
        a = self.ledger.prepare("prompt.submit", "session-a", {})["op_id"]
        self.ledger.prepare("prompt.submit", "session-b", {})
        self.ledger.mark_sending(a)
        outstanding = self.ledger.outstanding("session-a")
        self.assertEqual([item["op_id"] for item in outstanding], [a])
        self.assertEqual(len(self.ledger.outstanding()), 2)

    def test_recover_marks_incomplete_uncertain_never_retries(self):
        a = self.ledger.prepare("prompt.submit", "s1", {})["op_id"]
        b = self.ledger.prepare("prompt.submit", "s1", {})["op_id"]
        self.ledger.mark_sending(b)
        self.ledger.mark_acknowledged(b)
        recovered = self.ledger.recover()
        self.assertEqual([item["op_id"] for item in recovered], [a])
        self.assertEqual(self.ledger.get(a)["state"], "uncertain")
        self.assertEqual(self.ledger.get(b)["state"], "acknowledged")

    def test_target_lock_serializes_same_target_only(self):
        lock_a1 = self.ledger.target_lock("session-1")
        lock_a2 = self.ledger.target_lock("session-1")
        lock_b = self.ledger.target_lock("session-2")
        self.assertIs(lock_a1, lock_a2)
        self.assertIsNot(lock_a1, lock_b)
        acquired = threading.Event()
        release = threading.Event()

        def holder():
            with lock_a1:
                acquired.set()
                release.wait(2)

        thread = threading.Thread(target=holder)
        thread.start()
        self.assertTrue(acquired.wait(2))
        self.assertFalse(lock_a1.acquire(blocking=False))
        self.assertTrue(lock_b.acquire(blocking=False))
        lock_b.release()
        release.set()
        thread.join(2)


if __name__ == "__main__":
    unittest.main()
