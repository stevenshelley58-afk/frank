import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.release_state import ReleaseEvidenceError, ReleaseStateStore
from scripts import promote_control_release as cli


STAGE_FLAGS = {
    "step5": {"live_view", "map_view", "control_read", "reconciliation_schedules", "runtime_monitoring"},
    "step6c": {"live_view", "map_view", "control_read", "reconciliation_schedules", "runtime_monitoring", "safe_actions", "operational_actions", "source_actions"},
    "step7c": {"live_view", "map_view", "control_read", "reconciliation_schedules", "runtime_monitoring", "safe_actions", "operational_actions", "source_actions", "cleanup_jobs", "discovery_jobs", "evaluation_jobs", "chat_pattern_candidates"},
    "step8": set(cli.ALL_FLAGS),
}


class PromoteTests(unittest.TestCase):
    def evidence(self, release_id="rel-step7", stage="step7c"):
        sha = "a" * 40
        return {
            "release_id": release_id,
            "stage": stage,
            "source_sha": sha,
            "deployed_sha": sha,
            "image_digest": "sha256:" + "b" * 64,
            "graph_revision": "sha256:" + "c" * 64,
            "projection_manifests": [1],
            "tests": [1],
            "runtime_evidence": [1],
            "browser_evidence": [1],
            "rollback_target": sha,
            "feature_flags": {key: True for key in STAGE_FLAGS[stage]},
            "captured_at": "2026-08-30T00:00:00Z",
        }

    def seed(self, root: Path, stages=("step5", "step6c", "step7c", "step8")):
        store = ReleaseStateStore(root)
        records = {}
        for stage in stages:
            release_id = "rel-" + stage
            record = store.create_release(release_id, stage, self.evidence(release_id, stage))
            store.advance_current(release_id)
            records[stage] = record
        flags = root / "feature-flags.env"
        flags.write_bytes(cli._flags_bytes(records[stages[-1]]["evidence"]["feature_flags"]))
        os.chmod(flags, 0o600)
        return store, records, flags

    def test_dry_run_has_no_pointer_flags_or_systemctl(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "evidence.json"
            source.write_text(json.dumps(self.evidence()), encoding="utf-8")
            with patch.object(cli.subprocess, "run") as run:
                cli.main([str(source), "--store", str(root), "--flags-file", str(root / "feature-flags.env"), "--dry-run"])
                run.assert_not_called()
            self.assertFalse((root / "current.json").exists())
            self.assertFalse((root / "feature-flags.env").exists())

    def test_valid_rollback_selects_prior_release_flags_and_cumulative_timers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store, records, flags = self.seed(root)
            with patch.object(cli.subprocess, "run") as run:
                cli.main([str(root / "unused.json"), "--store", str(root), "--flags-file", str(flags), "--rollback", "--release-id", "rel-step7c"])
            self.assertEqual(store.read_current()["release_id"], "rel-step7c")
            self.assertEqual(
                cli._effective_flags(cli._parse_flags(flags.read_bytes())),
                cli._effective_flags(records["step7c"]["evidence"]["feature_flags"]),
            )
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(flags.stat().st_mode), 0o600)
            commands = {tuple(call.args[0]) for call in run.call_args_list}
            self.assertIn(("systemctl", "disable", "--now", "frank-restore-drill.timer"), commands)
            for unit in cli._desired_units("step7c"):
                self.assertIn(("systemctl", "enable", "--now", unit), commands)

    def test_missing_rollback_target_changes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store, _, flags = self.seed(root)
            pointer_before = (root / "current.json").read_bytes()
            flags_before = flags.read_bytes()
            with patch.object(cli.subprocess, "run") as run, self.assertRaises(ReleaseEvidenceError):
                cli.main([str(root / "unused.json"), "--store", str(root), "--flags-file", str(flags), "--rollback", "--release-id", "missing"])
            run.assert_not_called()
            self.assertEqual((root / "current.json").read_bytes(), pointer_before)
            self.assertEqual(flags.read_bytes(), flags_before)
            self.assertEqual(store.read_current()["release_id"], "rel-step8")

    def test_systemctl_failure_restores_pointer_flags_and_prior_timers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store, _, flags = self.seed(root)
            pointer_before = (root / "current.json").read_bytes()
            flags_before = flags.read_bytes()
            calls = []

            def fail_once(command, check):
                calls.append(tuple(command))
                if len(calls) == 1:
                    raise subprocess.CalledProcessError(1, command)

            with patch.object(cli.subprocess, "run", side_effect=fail_once), self.assertRaises(ReleaseEvidenceError):
                cli.main([str(root / "unused.json"), "--store", str(root), "--flags-file", str(flags), "--rollback", "--release-id", "rel-step7c"])
            self.assertEqual((root / "current.json").read_bytes(), pointer_before)
            self.assertEqual(flags.read_bytes(), flags_before)
            self.assertEqual(store.read_current()["release_id"], "rel-step8")
            for unit in cli._desired_units("step8"):
                self.assertIn(("systemctl", "enable", "--now", unit), calls)

    def test_forward_failure_restores_exact_prior_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store, _, flags = self.seed(root, stages=("step5", "step6c", "step7c"))
            source = root / "evidence.json"
            source.write_text(json.dumps(self.evidence("rel-step8-new", "step8")), encoding="utf-8")
            pointer_before = (root / "current.json").read_bytes()
            flags_before = flags.read_bytes()
            calls = []

            def fail_once(command, check):
                calls.append(tuple(command))
                if len(calls) == 1:
                    raise subprocess.CalledProcessError(1, command)

            with patch.object(cli.subprocess, "run", side_effect=fail_once), self.assertRaises(ReleaseEvidenceError):
                cli.main([str(source), "--store", str(root), "--flags-file", str(flags)])
            self.assertEqual((root / "current.json").read_bytes(), pointer_before)
            self.assertEqual(flags.read_bytes(), flags_before)
            self.assertEqual(store.read_current()["release_id"], "rel-step7c")
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(flags.stat().st_mode), 0o600)
            for unit in cli._desired_units("step7c"):
                self.assertIn(("systemctl", "enable", "--now", unit), calls)

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_symlinked_flags_file_is_rejected_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store, _, flags = self.seed(root)
            target = root / "real-flags"
            flags.replace(target)
            try:
                flags.symlink_to(target)
            except OSError:
                self.skipTest("symlink creation unavailable")
            pointer_before = (root / "current.json").read_bytes()
            with patch.object(cli.subprocess, "run") as run, self.assertRaises(ReleaseEvidenceError):
                cli.main([str(root / "unused.json"), "--store", str(root), "--flags-file", str(flags), "--rollback", "--release-id", "rel-step7c"])
            run.assert_not_called()
            self.assertEqual((root / "current.json").read_bytes(), pointer_before)
            self.assertEqual(store.read_current()["release_id"], "rel-step8")

    def test_stage_timer_allowlist_is_fixed(self):
        self.assertEqual(
            set(cli.UNITS["step7c"]),
            {"frank-cleanup-report.timer", "frank-discovery-refresh.timer", "frank-evaluation.timer", "frank-chat-pattern.timer"},
        )
        for unit in cli.ALL_UNITS:
            self.assertRegex(unit, r"^frank-[a-z-]+\.timer$")


if __name__ == "__main__":
    unittest.main()
