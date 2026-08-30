import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
INFRA = ROOT / "infra"
RUNNER = ROOT / "scripts" / "run_scheduled_control_job.py"
JOBS = {
    "cleanup": (INFRA / "cleanup" / "frank-cleanup-report.service", INFRA / "cleanup" / "frank-cleanup-report.timer", "cleanup_jobs", "Sun *-*-* 03:40:00 UTC", "30m"),
    "discovery": (INFRA / "discovery" / "frank-discovery-refresh.service", INFRA / "discovery" / "frank-discovery-refresh.timer", "discovery_jobs", "*-*-* 04:20:00 UTC", "20m"),
    "evaluation": (INFRA / "evaluations" / "frank-evaluation.service", INFRA / "evaluations" / "frank-evaluation.timer", "evaluation_jobs", "Sun *-*-* 05:00:00 UTC", "30m"),
    "chat-pattern": (INFRA / "evaluations" / "frank-chat-pattern.service", INFRA / "evaluations" / "frank-chat-pattern.timer", "chat_pattern_candidates", "*-*-01 05:30:00 UTC", "30m"),
    "retention": (INFRA / "retention" / "frank-restore-drill.service", INFRA / "retention" / "frank-restore-drill.timer", "retention_restore_drills", "quarterly", "60m"),
}

class ScheduledJobTests(unittest.TestCase):
    def test_exact_schedules_and_bounds(self):
        for job, (service, timer, flag, calendar, timeout) in JOBS.items():
            service_text, timer_text = service.read_text(), timer.read_text()
            self.assertIn(f"OnCalendar={calendar}", timer_text, job)
            self.assertIn("Persistent=true", timer_text, job)
            self.assertIn(f"TimeoutStartSec={timeout}", service_text, job)
            if job == "retention":
                self.assertIn("run_restore_drill.py", service_text, job)
                self.assertIn("User=root", service_text, job)
                self.assertIn("ReadWritePaths=/srv/frank/backups/control-plane", service_text, job)
                self.assertNotIn("run_scheduled_control_job.py retention", service_text, job)
            elif job != "cleanup":
                self.assertIn(f"run_scheduled_control_job.py {job}", service_text, job)
            if "run_scheduled_control_job.py" in service_text:
                self.assertIn("/projects/frank/apps/window/scripts/run_scheduled_control_job.py", service_text, job)
                self.assertNotIn("/srv/frank/apps/window", service_text, job)
            self.assertNotIn("--enable", service_text)
            self.assertIn(flag, (RUNNER.read_text() + service_text), job)

    def test_disabled_is_receipted_without_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy(); env.pop("FRANK_FEATURE_FLAG_DISCOVERY_JOBS", None)
            subprocess.run([sys.executable, str(RUNNER), "discovery", "--output-root", tmp], env=env, check=True)
            receipt = json.loads((Path(tmp) / "latest-discovery.json").read_text())
            self.assertEqual(receipt["status"], "disabled")
            self.assertFalse(receipt["mutated"])

    def test_lock_duplicate_is_receipted_without_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy(); env["FRANK_FEATURE_FLAG_EVALUATION_JOBS"] = "1"
            lock = Path(tmp) / "evaluation.lock"; lock.write_text("")
            try:
                import fcntl
            except ImportError:
                self.skipTest("fcntl locking is POSIX-only")
            with lock.open("a+") as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                subprocess.run([sys.executable, str(RUNNER), "evaluation", "--output-root", tmp], env=env, check=True)
            receipt = json.loads((Path(tmp) / "latest-evaluation.json").read_text())
            self.assertEqual(receipt["status"], "already_running")
            self.assertFalse(receipt["mutated"])

if __name__ == "__main__": unittest.main()
