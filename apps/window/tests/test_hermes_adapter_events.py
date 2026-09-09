import unittest

from hermes_adapter.events import SequenceTracker, derived_label, normalize


class DerivedLabelTest(unittest.TestCase):
    def test_frozen_table(self):
        cases = {
            "run.failed": "terminal_error",
            "run.cancelled": "terminal_error",
            "run.provider_error": "provider_error",
            "run.approval_required": "approval_required",
            "approval.pending": "approval_required",
            "run.tool.progress": "tool_progress",
            "tool.completed": "tool_progress",
            "message.assistant.delta": "assistant_message",
            "reasoning.delta": "reasoning_delta",
            "thinking.delta": "reasoning_delta",
            "todo.updated": "todo_updated",
            "subagent.started": "subagent_lifecycle",
        }
        for native, expected in cases.items():
            self.assertEqual(derived_label(native), expected, native)

    def test_unknown_events_retained_not_guessed(self):
        self.assertEqual(derived_label("brand.new.event"), "unknown")
        self.assertEqual(derived_label(""), "unknown")

    def test_no_native_approval_expire_is_mapped(self):
        # There is no native approval expiry in the contract; if one ever
        # appears it must stay unknown, never silently normalized.
        self.assertEqual(derived_label("approval.expire"), "unknown")


class NormalizeTest(unittest.TestCase):
    def test_envelope_shape_and_frank_origin_false(self):
        event = normalize(42, "run.failed", {"error": "boom"}, run_id="r1", session_id="s1", timestamp=5.0)
        self.assertEqual(
            set(event),
            {"seq", "native_event", "derived_label", "run_id", "session_id", "timestamp", "payload", "frank_origin"},
        )
        self.assertEqual(event["derived_label"], "terminal_error")
        self.assertFalse(event["frank_origin"])

    def test_validation(self):
        with self.assertRaises(ValueError):
            normalize(-1, "run.failed", {})
        with self.assertRaises(ValueError):
            normalize(1, "run.failed", ["not", "an", "object"])


class SequenceTrackerTest(unittest.TestCase):
    def test_duplicates_dropped_exactly_once(self):
        tracker = SequenceTracker()
        events = [normalize(1, "run.tool.progress", {}), normalize(1, "run.tool.progress", {}), normalize(2, "run.failed", {})]
        kept = tracker.reconcile(events)
        self.assertEqual([event["seq"] for event in kept], [1, 2])

    def test_interim_already_streamed_reconciles_against_final(self):
        tracker = SequenceTracker()
        interim = normalize(7, "message.assistant.interim", {"already_streamed": True})
        final = normalize(7, "message.assistant.complete", {"text": "done"})
        kept = tracker.reconcile([interim, final])
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["native_event"], "message.assistant.complete")
        kept2 = SequenceTracker().reconcile([final, interim])
        self.assertEqual(kept2[0]["native_event"], "message.assistant.complete")

    def test_gap_is_preserved_not_filled(self):
        tracker = SequenceTracker()
        kept = tracker.reconcile([normalize(1, "run.tool.progress", {}), normalize(4, "run.failed", {})])
        self.assertEqual([event["seq"] for event in kept], [1, 4])


if __name__ == "__main__":
    unittest.main()
