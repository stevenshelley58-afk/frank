import unittest

import work_state


class WorkStateMappingTest(unittest.TestCase):
    def test_passive_states_map_to_queued(self):
        for native in ("triage", "todo", "scheduled", "ready"):
            self.assertEqual(work_state.task_group(native), "queued", native)
        self.assertEqual(work_state.task_label("triage"), "Planned")
        self.assertEqual(work_state.task_label("scheduled"), "Scheduled")

    def test_running_maps_running(self):
        self.assertEqual(work_state.task_group("running"), "running")
        self.assertEqual(work_state.task_label("running"), "Running")

    def test_blocked_and_review_map_waiting(self):
        self.assertEqual(work_state.task_group("blocked"), "waiting")
        self.assertEqual(work_state.task_label("blocked"), "Waiting")
        self.assertEqual(work_state.task_group("review"), "waiting")
        self.assertEqual(work_state.task_label("review"), "Waiting for review")

    def test_done_and_archived(self):
        self.assertEqual(work_state.task_group("done"), "completed")
        self.assertEqual(work_state.task_group("archived"), "archived")
        self.assertTrue(work_state.project_task({"state": "archived"})["hidden_by_default"])

    def test_unknown_native_never_guessed(self):
        self.assertEqual(work_state.task_group("frobnicated"), "unknown")
        self.assertEqual(work_state.task_label("frobnicated"), "Unknown")

    def test_run_states_exact_terminal_or_transitional(self):
        self.assertEqual(work_state.run_group("stopping"), "transitional")
        self.assertEqual(work_state.run_group("running"), "running")
        for terminal in ("succeeded", "failed", "cancelled"):
            self.assertEqual(work_state.run_group(terminal), "terminal", terminal)
        self.assertEqual(work_state.run_label("failed"), "Failed")
        self.assertEqual(work_state.run_label("cancelled"), "Cancelled")

    def test_projection_preserves_native_state(self):
        row = work_state.project_task({"id": "t1", "state": "blocked", "title": "x"})
        self.assertEqual(row["native_state"], "blocked")
        self.assertEqual(row["group"], "waiting")
        self.assertEqual(row["label"], "Waiting")

    def test_summarize_counts_truthfully(self):
        rows = [{"group": "running"}, {"group": "waiting"}, {"group": "running"}, {"group": "unknown"}]
        counts = work_state.summarize(rows)
        self.assertEqual(counts["running"], 2)
        self.assertEqual(counts["waiting"], 1)
        self.assertEqual(counts["unknown"], 1)


if __name__ == "__main__":
    unittest.main()
