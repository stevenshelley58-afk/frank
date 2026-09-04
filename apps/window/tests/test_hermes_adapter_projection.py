import json
import tempfile
import unittest
from pathlib import Path

from hermes_adapter.projection import ProjectionError, EventProjection


def event(sequence, kind="message.delta", **extra):
    base = {"schema": "schema://frank.hermes-event/v1", "sequence": sequence, "kind": kind}
    base.update(extra)
    return base


class EventProjectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "projection"
        self.projection = EventProjection(self.root, clock=lambda: 1000.0)

    def tearDown(self):
        self.tmp.cleanup()

    def key(self, session="s1"):
        return self.projection.scope_key("user-a", "proj-b", session)

    def test_scope_key_rejects_unsafe_components(self):
        for bad in ("", "a/b", "..", None):
            with self.assertRaises(ProjectionError):
                self.projection.scope_key(bad, "p", "s")

    def test_append_is_redacted_before_persistence(self):
        self.projection.append(self.key(), event(1, headers={"Authorization": "Bearer abc123def456ghi789"}), run_id="r1")
        raw = (self.root / self.key() / "events.jsonl").read_text()
        self.assertNotIn("abc123def456ghi789", raw)
        self.assertIn("Authorization", raw)
        self.assertIn("[REDACTED]", raw)

    def test_event_byte_cap_drops_with_receipt(self):
        result = self.projection.append(
            self.key(), event(1, blob="x" * (self.projection._limits["event_byte_cap"] + 10))
        )
        self.assertFalse(result["appended"])
        self.assertEqual(result["dropped"], "event_byte_cap")
        meta = self.projection.meta(self.key())
        self.assertEqual(len(meta["receipts"]), 1)
        self.assertEqual(meta["receipts"][0]["cap"], "event_byte_cap")

    def test_run_byte_cap_and_total_quota(self):
        small = EventProjection(self.root / "small", limits={"run_byte_cap": 250, "event_byte_cap": 500, "total_quota_bytes": 1000}, clock=lambda: 1.0)
        key = small.scope_key("u", "p", "s")
        small.append(key, event(1, data="y" * 30), run_id="r")
        small.append(key, event(2, data="z" * 30), run_id="r")
        third = small.append(key, event(3, data="w" * 40), run_id="r")
        self.assertFalse(third["appended"])
        self.assertEqual(third["dropped"], "run_byte_cap")
        meta = small.meta(key)
        self.assertEqual(len(meta["receipts"]), 1)

    def test_iter_events_is_rebuildable_and_ordered(self):
        for sequence in range(5):
            self.projection.append(self.key(), event(sequence), run_id="r")
        items = list(self.projection.iter_events(self.key()))
        self.assertEqual([item["sequence"] for item in items], [0, 1, 2, 3, 4])
        after = list(self.projection.iter_events(self.key(), after_frank_sequence=2))
        self.assertEqual([item["sequence"] for item in after], [3, 4])

    def test_terminal_freezes_then_compaction_requires_receipt(self):
        self.projection.append(self.key(), event(1), run_id="r")
        with self.assertRaises(ProjectionError):
            self.projection.compact(self.key())
        with self.assertRaises(ProjectionError):
            self.projection.mark_terminal(self.key(), reconciliation_receipt={})
        self.projection.mark_terminal(self.key(), reconciliation_receipt={"verified": True, "last_sequence": 1})
        with self.assertRaises(ProjectionError):
            self.projection.append(self.key(), event(2), run_id="r")
        receipt = self.projection.compact(self.key())
        self.assertEqual(receipt["event_count"], 1)
        compacted = json.loads((self.root / self.key() / "events.jsonl").read_text())
        self.assertIn("receipt", compacted)

    def test_mark_gap_is_visible_and_never_invents_events(self):
        self.projection.mark_gap(self.key(), {"from_sequence": 10, "to_sequence": 14, "reason": "buffer_eviction"})
        items = list(self.projection.iter_events(self.key()))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["reason"], "buffer_eviction")

    def test_prune_removes_only_expired_terminal_sessions(self):
        live = self.key("live")
        expired = self.key("expired")
        for key in (live, expired):
            self.projection.append(key, event(1), run_id="r")
            self.projection.mark_terminal(key, reconciliation_receipt={"ok": True})
        # expired's terminal timestamp is 1000.0; TTL of 100 forces expiry.
        old = EventProjection(self.root, limits={"ttl_seconds": 100}, clock=lambda: 1.0)
        old._limits["ttl_seconds"] = 100
        projection = EventProjection(self.root, clock=lambda: 1200.0)
        projection._limits["ttl_seconds"] = 100
        self.assertEqual(projection.prune(), 2)

    def test_corrupt_line_survives_rebuild_as_visible_marker(self):
        path = self.root / self.key()
        path.mkdir(parents=True)
        (path / "events.jsonl").write_text('{"schema": "x", "sequence": 1}\n{broken\n')
        items = list(self.projection.iter_events(self.key()))
        self.assertEqual(items[0]["sequence"], 1)
        self.assertEqual(items[1]["kind"], "projection.corrupt-line")


if __name__ == "__main__":
    unittest.main()
