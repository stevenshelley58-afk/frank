"""Workspace-execution lease tests: races, fairness, generations, recovery."""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from infra.workspace.lease import (
    LeaseRefused,
    LeaseUnavailable,
    StaleGeneration,
    WorkspaceLease,
)
from infra.workspace.schemas import WORKSPACE_LEASE_SCHEMA, LeaseOwner


def _owner(kind="hermes", ident="exec-1", **kwargs):
    return LeaseOwner(executor_kind=kind, executor_id=ident, **kwargs)


class FakeVerifier:
    def __init__(self, alive=set()):
        self.alive = set(alive)
        self.calls = []
        self.fail = False

    def __call__(self, owner):
        self.calls.append(owner)
        if self.fail:
            raise RuntimeError("verifier outage")
        return (owner.executor_kind, owner.executor_id) in self.alive


class LeaseBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.verifier = FakeVerifier(alive={("hermes", "exec-1"), ("codex", "codex-9")})
        self.lease = WorkspaceLease(self.root, ttl_seconds=0.2, verifier=self.verifier)

    def tearDown(self):
        self.temp.cleanup()


class LeaseAcquireTest(LeaseBase):
    def test_acquire_heartbeat_release_round_trip(self):
        grant = self.lease.acquire("ws-a", _owner())
        self.assertTrue(grant.generation)
        self.assertEqual(grant.owner.executor_kind, "hermes")
        renewed = self.lease.heartbeat("ws-a", grant.generation)
        self.assertGreaterEqual(renewed.expires_at, grant.expires_at)
        result = self.lease.release("ws-a", grant.generation)
        self.assertTrue(result["released"])
        record = self.lease.inspect("ws-a")
        self.assertEqual(record["state"], "released")

    def test_second_workspace_is_independent(self):
        first = self.lease.acquire("ws-a", _owner())
        second = self.lease.acquire("ws-b", _owner("codex", "codex-9"))
        self.assertNotEqual(first.generation, second.generation)
        self.assertNotEqual(first.workspace_id, second.workspace_id)

    def test_busy_workspace_refuses_without_residue(self):
        self.lease.acquire("ws-a", _owner())
        with self.assertRaises(LeaseRefused):
            self.lease.acquire("ws-a", _owner("codex", "codex-9"))
        record = self.lease.inspect("ws-a")
        self.assertEqual(record["queue"], [])

    def test_wait_queue_promotes_fairly_fifo(self):
        first = self.lease.acquire("ws-a", _owner())
        order = []
        results = {}

        def waiter(name, ident):
            try:
                grant = self.lease.acquire("ws-a", _owner("codex", ident), max_wait_seconds=3.0)
                order.append(name)
                results[name] = grant
            except LeaseRefused:
                order.append(f"{name}:refused")

        threads = [
            threading.Thread(target=waiter, args=("two", "codex-2")),
            threading.Thread(target=waiter, args=("three", "codex-3")),
        ]
        for thread in threads:
            thread.start()
            time.sleep(0.05)  # preserve enqueue order
        self.lease.release("ws-a", first.generation)
        for thread in threads:
            thread.join(timeout=5)
        self.assertEqual(order[:2], ["two", "three"])  # FIFO fairness
        self.assertEqual(results["two"].owner.executor_id, "codex-2")

    def test_queue_bound_is_enforced(self):
        holder = WorkspaceLease(self.root, ttl_seconds=10, verifier=self.verifier)
        holder.acquire("ws-a", _owner())  # live holder, long TTL
        small = WorkspaceLease(self.root, ttl_seconds=10, max_queue=1, verifier=self.verifier)
        queued = threading.Thread(
            target=lambda: small.acquire("ws-a", _owner("codex", "codex-9"), max_wait_seconds=0.6)
        )
        queued.start()
        time.sleep(0.1)  # queue now holds one entry
        with self.assertRaises(LeaseRefused):
            small.acquire("ws-a", _owner("gateway", "gw-1"), max_wait_seconds=0.05)
        queued.join(timeout=3)
        self.assertEqual(holder.inspect("ws-a")["queue"], [])  # timed-out entry removed

    def test_invalid_executor_refused(self):
        with self.assertRaises(LeaseRefused):
            self.lease.acquire("ws-a", _owner(kind="alien"))
        with self.assertRaises(LeaseRefused):
            self.lease.acquire("ws-a", _owner(ident=""))

    def test_cancel_queued_removes_entry(self):
        self.lease.acquire("ws-a", _owner())
        small = WorkspaceLease(self.root, ttl_seconds=0.2, verifier=self.verifier)
        queued = None
        holder = {"stop": False}

        def waiter():
            nonlocal queued
            try:
                small.acquire("ws-a", _owner("codex", "codex-9"), max_wait_seconds=0.5)
            except LeaseRefused:
                pass

        thread = threading.Thread(target=waiter)
        thread.start()
        time.sleep(0.1)
        record = self.lease.inspect("ws-a")
        queued = record["queue"][0]["generation"] if record["queue"] else None
        if queued:
            self.lease.cancel_queued("ws-a", queued)
        thread.join(timeout=3)
        self.assertEqual(self.lease.inspect("ws-a")["queue"], [])


class LeaseGenerationTest(LeaseBase):
    def test_stale_generation_rejected_on_heartbeat_and_release(self):
        grant = self.lease.acquire("ws-a", _owner())
        with self.assertRaises(StaleGeneration):
            self.lease.heartbeat("ws-a", "forged-generation")
        with self.assertRaises(StaleGeneration):
            self.lease.release("ws-a", "forged-generation")
        self.lease.release("ws-a", grant.generation)
        with self.assertRaises(StaleGeneration):
            self.lease.release("ws-a", grant.generation)  # double release fails closed

    def test_replay_after_release_does_not_resurrect(self):
        grant = self.lease.acquire("ws-a", _owner())
        self.lease.release("ws-a", grant.generation)
        with self.assertRaises(StaleGeneration):
            self.lease.heartbeat("ws-a", grant.generation)
        fresh = self.lease.acquire("ws-a", _owner("codex", "codex-9"))
        self.assertNotEqual(fresh.generation, grant.generation)

    def test_cross_workspace_release_rejected(self):
        grant_a = self.lease.acquire("ws-a", _owner())
        self.lease.acquire("ws-b", _owner("codex", "codex-9"))
        with self.assertRaises(StaleGeneration):
            self.lease.release("ws-b", grant_a.generation)


class LeaseReclaimTest(LeaseBase):
    def test_live_owner_beyond_ttl_is_not_stolen(self):
        self.lease.acquire("ws-a", _owner())  # ("hermes","exec-1") is alive
        time.sleep(0.25)  # TTL 0.2 passed
        with self.assertRaises(LeaseRefused):
            self.lease.acquire("ws-a", _owner("codex", "codex-9"), max_wait_seconds=0.05)
        record = self.lease.inspect("ws-a")
        self.assertEqual(record["state"], "active")
        self.assertTrue(self.verifier.calls)

    def test_dead_owner_verified_reclaim(self):
        self.lease.acquire("ws-a", _owner("codex", "dead-exec"))
        self.verifier.alive.discard(("codex", "dead-exec"))
        time.sleep(0.25)
        grant = self.lease.acquire("ws-a", _owner())  # verifier says dead → reclaim
        self.assertEqual(grant.owner.executor_kind, "hermes")

    def test_verifier_outage_fails_closed(self):
        self.lease.acquire("ws-a", _owner("codex", "maybe-dead"))
        time.sleep(0.25)
        self.verifier.fail = True
        with self.assertRaises(LeaseUnavailable):
            self.lease.acquire("ws-a", _owner())

    def test_reconcile_resolves_dead_and_promotes(self):
        dead = self.lease.acquire("ws-a", _owner("codex", "dead-exec"))
        self.verifier.alive.discard(("codex", "dead-exec"))
        marked = self.lease.recover_all()  # restart: mark reconciling
        self.assertEqual(marked, ["ws-a"])
        time.sleep(0.25)
        record = self.lease.reconcile("ws-a")
        self.assertEqual(record["state"], "released")
        with self.assertRaises(StaleGeneration):
            self.lease.heartbeat("ws-a", dead.generation)

    def test_reconcile_keeps_live_owner(self):
        grant = self.lease.acquire("ws-a", _owner())  # alive
        self.lease.recover_all()  # mark reconciling first
        self.verifier.fail = True
        with self.assertRaises(LeaseUnavailable):
            self.lease.reconcile("ws-a")  # outage keeps reconciling; fail closed
        self.verifier.fail = False
        result = self.lease.reconcile("ws-a")
        self.assertEqual(result["state"], "active")
        self.lease.heartbeat("ws-a", grant.generation)  # still valid


class LeaseRestartTest(LeaseBase):
    def test_recover_all_marks_reconciling_and_refuses(self):
        self.lease.acquire("ws-a", _owner("codex", "dead-exec"))
        self.lease.acquire("ws-b", _owner("codex", "codex-9"))
        marked = self.lease.recover_all()
        self.assertEqual(sorted(marked), ["ws-a", "ws-b"])
        with self.assertRaises(LeaseRefused):
            self.lease.acquire("ws-a", _owner("codex", "other"))  # fail closed
        self.verifier.fail = True
        with self.assertRaises(LeaseUnavailable):
            self.lease.reconcile("ws-a")
        self.verifier.fail = False
        self.lease.reconcile("ws-a")  # dead-exec is not alive → released
        grant = self.lease.acquire("ws-a", _owner("codex", "other"))
        self.assertTrue(grant.generation)

    def test_corrupt_storage_fails_closed(self):
        self.lease.acquire("ws-a", _owner())
        record_path = self.root / "leases" / "ws-a.json"
        record_path.write_text("{corrupt", encoding="utf-8")
        with self.assertRaises(LeaseUnavailable):
            self.lease.inspect("ws-a")
        with self.assertRaises(LeaseUnavailable):
            self.lease.acquire("ws-a", _owner("codex", "codex-9"))

    def test_invalid_workspace_id_refused(self):
        with self.assertRaises(LeaseRefused):
            self.lease.acquire("../escape", _owner())

    def test_record_schema_is_versioned(self):
        self.lease.acquire("ws-a", _owner())
        raw = json.loads((self.root / "leases" / "ws-a.json").read_text(encoding="utf-8"))
        self.assertEqual(raw["schema"], WORKSPACE_LEASE_SCHEMA)
        self.assertEqual(
            set(raw.keys()),
            {"schema", "workspace_id", "state", "grant", "queue", "events"},
        )


class LeaseRaceTest(LeaseBase):
    def test_same_workspace_concurrent_acquire_single_winner(self):
        winners = []
        barrier = threading.Barrier(8)

        def contender(index):
            owner = _owner("codex" if index % 2 else "hermes", f"exec-{index}")
            barrier.wait()
            try:
                grant = self.lease.acquire("ws-a", owner, max_wait_seconds=0.02)
                winners.append(grant.generation)
            except LeaseRefused:
                pass

        threads = [threading.Thread(target=contender, args=(i,)) for i in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
        self.assertEqual(len(winners), 1)

    def test_different_workspaces_concurrent_all_win(self):
        results = []
        barrier = threading.Barrier(4)

        def contender(index):
            barrier.wait()
            grant = self.lease.acquire(f"ws-{index}", _owner("codex", f"codex-{index}"))
            results.append(grant.workspace_id)

        threads = [threading.Thread(target=contender, args=(i,)) for i in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)
        self.assertEqual(len(results), 4)


if __name__ == "__main__":
    unittest.main()
