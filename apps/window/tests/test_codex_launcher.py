"""Lease-gated Codex launcher tests: gated start, renewal, fail-closed exit."""
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infra.workspace.codex_launcher import LaunchRefused, run_leased_task
from infra.workspace.lease import WorkspaceLease, LeaseUnavailable
from infra.workspace.schemas import LeaseOwner


def _owner(ident="codex-canary"):
    return LeaseOwner(executor_kind="codex", executor_id=ident)


class CodexLauncherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workdir = Path(self.temp.name)
        self.alive = {("codex", "codex-canary"), ("hermes", "exec-1")}
        self.lease = WorkspaceLease(
            self.workdir / "lease-root", ttl_seconds=1.0, verifier=lambda owner: (owner.executor_kind, owner.executor_id) in self.alive,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_task_runs_inside_lease_and_releases_after_exit(self):
        result = run_leased_task(
            self.lease, "ws-canary", _owner(),
            ["/bin/sh", "-c", "echo ran > task-output.txt"],
            workdir=str(self.workdir), heartbeat_interval=0.05,
        )
        self.assertTrue(result["ok"])
        self.assertTrue((self.workdir / "task-output.txt").is_file())
        record = self.lease.inspect("ws-canary")
        self.assertEqual(record["state"], "released")
        self.assertEqual(record["queue"], [])

    def test_busy_workspace_refuses_before_entering_checkout(self):
        holder = self.lease.acquire("ws-canary", LeaseOwner(executor_kind="hermes", executor_id="exec-1"))
        with self.assertRaises(LaunchRefused):
            run_leased_task(
                self.lease, "ws-canary", _owner(),
                ["/bin/sh", "-c", "echo should-not-run > intruder.txt"],
                workdir=str(self.workdir), heartbeat_interval=0.05,
            )
        self.assertFalse((self.workdir / "intruder.txt").exists())  # never entered
        self.lease.release("ws-canary", holder.generation)

    def test_heartbeat_renews_across_ttl(self):
        result = run_leased_task(
            self.lease, "ws-canary", _owner(),
            ["/bin/sh", "-c", "sleep 1.2; echo done > slow-output.txt"],
            workdir=str(self.workdir), heartbeat_interval=0.2,
        )
        self.assertTrue(result["ok"])  # TTL 1.0 survived via heartbeats
        self.assertTrue((self.workdir / "slow-output.txt").is_file())

    def test_renewal_failure_terminates_task_fail_closed(self):
        state = {"fail": False}
        def owner_verifier(owner):
            return not state["fail"]
        import threading

        def flip():
            time.sleep(0.3)
            state["fail"] = True

        threading.Thread(target=flip, daemon=True).start()
        with self.assertRaises(LaunchRefused):
            run_leased_task(
                self.lease, "ws-canary", _owner(),
                ["/bin/sh", "-c", "sleep 5; echo never > never.txt"],
                workdir=str(self.workdir), heartbeat_interval=0.1,
                owner_verifier=owner_verifier,
            )
        self.assertFalse((self.workdir / "never.txt").exists())
        # The lease was released in the finally block; workspace is free again.
        self.assertEqual(self.lease.inspect("ws-canary")["state"], "released")

    def test_race_two_launchers_one_enters(self):
        outcomes = []
        import threading

        def contender(index):
            try:
                outcome = run_leased_task(
                    self.lease, "ws-canary", _owner(f"codex-{index}"),
                    ["/bin/sh", "-c", f"echo {index} > winner-{index}.txt"],
                    workdir=str(self.workdir), heartbeat_interval=0.05,
                )
                outcomes.append((index, outcome["ok"]))
            except LaunchRefused:
                outcomes.append((index, "refused"))

        threads = [threading.Thread(target=contender, args=(i,)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertEqual(len(outcomes), 2)
        entered = [index for index, status in outcomes if status is True]
        refused = [index for index, status in outcomes if status == "refused"]
        self.assertEqual(len(entered), 1)
        self.assertEqual(len(refused), 1)
        winners = list(self.workdir.glob("winner-*.txt"))
        self.assertEqual(len(winners), 1)  # one checkout, one task


if __name__ == "__main__":
    unittest.main()
