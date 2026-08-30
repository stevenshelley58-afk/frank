import tempfile
import threading
import time
import unittest
from pathlib import Path

from graph.operational_actions import OperationalActionService
from graph.safe_actions import ActionRegistry, ActionError, ImmutableReceiptStore


HASH = "sha256:" + "b" * 64


def defs(enabled=True):
    common = {"enabled": enabled, "target_allowlist": [], "arguments": {"idempotency_key": {"type": "idempotency_key"}}, "adapter_version": "1.0.0", "adapter_hash": HASH, "lock_key": "release-lock", "timeout_seconds": 1, "rollback_action_id": None}
    items = []
    for action, target, args in [
        ("tool:deploy-frank", "release:frank", {"commit": {"type": "revision"}, "idempotency_key": {"type": "idempotency_key"}}),
        ("tool:rollback-frank", "release:frank", {"prior_revision": {"type": "revision"}, "idempotency_key": {"type": "idempotency_key"}}),
        ("tool:restart-service", "service:frank-window", {"service_id": {"type": "stable_id"}, "idempotency_key": {"type": "idempotency_key"}}),
        ("tool:run-job", "run:reconciliation", {"job_type": {"type": "enum", "values": ["reconcile"]}, "idempotency_key": {"type": "idempotency_key"}}),
        ("tool:retry-job", "run:reconciliation", {"parent_run_id": {"type": "stable_id"}, "failed_action_receipt_id": {"type": "stable_id"}, "idempotency_key": {"type": "idempotency_key"}}),
        ("tool:cancel-job", "run:reconciliation", {"run_id": {"type": "stable_id"}, "idempotency_key": {"type": "idempotency_key"}}),
    ]:
        item = dict(common, id=action, target_allowlist=[target], arguments=args, adapter_id="tool:adapter-ops")
        items.append(item)
    return {"actions": items}


class Hermes:
    def request(self, **kwargs):
        return {"authorized": True}


class Transport:
    def __init__(self):
        self.calls = []
        self.block = False
        self.fail_health = False

    def inspect(self, target_id, *, timeout_seconds):
        if self.block:
            time.sleep(2)
        return {"revision": "old", "health": True, "hermes_available": True, "dirty": False}

    def deploy(self, target_id, revision, *, timeout_seconds):
        self.calls.append(("deploy", target_id, revision))
        return {"ok": True, "health": not self.fail_health}

    def rollback(self, target_id, revision, *, timeout_seconds):
        self.calls.append(("rollback", target_id, revision))
        return {"ok": True, "health": True}

    def restart(self, service_id, *, timeout_seconds):
        self.calls.append(("restart", service_id))
        return {"ok": True, "health": True}

    def run_job(self, job_type, target_id, arguments, *, timeout_seconds):
        self.calls.append(("job", job_type))
        return {"ok": True}

    def cancel_job(self, run_id, *, timeout_seconds):
        self.calls.append(("cancel", run_id))
        return {"ok": True}


class OperationalActionTests(unittest.TestCase):
    def setUp(self):
        self.transport = Transport()
        self.service = OperationalActionService(ActionRegistry(defs(), enabled=True), Hermes(), {"tool:adapter-ops": self.transport}, ImmutableReceiptStore(Path(tempfile.mkdtemp())))

    def execute(self, action, target, arguments):
        plan = self.service.plan(action_id=action, target_id=target, arguments=arguments)
        return self.service.apply(self.service.confirm(plan)), plan

    def test_deploy_authorizes_and_replays(self):
        result, plan = self.execute("tool:deploy-frank", "release:frank", {"commit": "abc123", "idempotency_key": "deploy-001"})
        replay = self.service.apply(self.service.confirm(plan))
        self.assertEqual(result["receipt"]["outcome"], "pass")
        self.assertTrue(replay["replayed"])
        self.assertEqual([call[0] for call in self.transport.calls], ["deploy"])

    def test_dirty_checkout_fails_without_transport_mutation(self):
        self.transport.inspect = lambda target_id, *, timeout_seconds: {"dirty": True, "hermes_available": True}
        result, _ = self.execute("tool:deploy-frank", "release:frank", {"commit": "abc123", "idempotency_key": "deploy-002"})
        self.assertEqual(result["receipt"]["outcome"], "fail")
        self.assertEqual(self.transport.calls, [])

    def test_lock_and_confirmation(self):
        plan = self.service.plan(action_id="tool:restart-service", target_id="service:frank-window", arguments={"service_id": "service:frank-window", "idempotency_key": "restart-01"})
        lock = self.service._lock("release-lock")
        lock.acquire()
        try:
            with self.assertRaises(ActionError): self.service.apply(self.service.confirm(plan))
        finally:
            lock.release()
        with self.assertRaises(ActionError): self.service.apply(plan)


if __name__ == "__main__":
    unittest.main()
