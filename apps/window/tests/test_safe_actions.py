import tempfile
import unittest
from pathlib import Path

from graph.safe_actions import ActionError, ActionRegistry, ImmutableReceiptStore, SafeActionService


class Hermes:
    def __init__(self, **values): self.values = values; self.calls = []
    def request(self, **kwargs): self.calls.append(kwargs); return {"authorized": True, **self.values}


class Adapter:
    adapter_id = "tool:adapter-reconciliation"
    adapter_version = "1.0.0"
    adapter_hash = "sha256:" + "a" * 64
    def __init__(self, result=None): self.result = result or {"ok": True}
    def execute(self, target_id, arguments, *, timeout_seconds): return self.result


def definitions():
    return {"actions": [
        {"id": "tool:refresh-evidence", "enabled": True, "target_allowlist": ["project:frank"], "arguments": {"mode": {"type": "enum"}, "idempotency_key": {"type": "idempotency_key"}}, "confirmation_class": "none", "adapter_id": Adapter.adapter_id, "adapter_version": "1.0.0", "adapter_hash": Adapter.adapter_hash, "lock_key": "control-plane", "timeout_seconds": 1, "rollback_action_id": None},
        {"id": "tool:regenerate-map", "enabled": True, "target_allowlist": ["projection:frank/architecture"], "arguments": {"projection_id": {"type": "stable_id"}, "idempotency_key": {"type": "idempotency_key"}}, "confirmation_class": "none", "adapter_id": "tool:adapter-archify", "adapter_version": "1.0.0", "adapter_hash": Adapter.adapter_hash, "lock_key": "control-plane", "timeout_seconds": 1, "rollback_action_id": "tool:restore-map"},
    ]}


class SafeActionsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.adapter = Adapter()
        self.service = SafeActionService(ActionRegistry(definitions(), enabled=True), Hermes(), {self.adapter.adapter_id: self.adapter}, ImmutableReceiptStore(self.root))

    def test_plan_apply_and_idempotent_replay(self):
        plan = self.service.plan(action_id="refresh_evidence", target_id="project:frank", target_revision="r1", base_revision="r1", idempotency_key="safe-key-1")
        self.assertTrue(self.service.confirm(plan)["confirmed"])
        first = self.service.apply(plan)
        second = self.service.apply(plan)
        self.assertFalse(first["replayed"]); self.assertTrue(second["replayed"])
        self.assertEqual(first["receipt"]["redaction"], "secret_filtered")

    def test_rejects_unknown_target_and_string_passthrough(self):
        with self.assertRaises(ActionError): self.service.plan(action_id="refresh_evidence", target_id="project:other", target_revision="r1", base_revision="r1", idempotency_key="safe-key-2")
        bad = definitions()["actions"][0].copy(); bad["arguments"] = {"shell": {"type": "string"}, "idempotency_key": {"type": "idempotency_key"}}
        with self.assertRaises(ActionError): ActionRegistry({"actions": [bad]}, enabled=True)

    def test_stale_base_and_adapter_mismatch(self):
        service = SafeActionService(ActionRegistry(definitions(), enabled=True), Hermes(current_revision="r2"), {self.adapter.adapter_id: self.adapter}, ImmutableReceiptStore(self.root))
        plan = service.plan(action_id="refresh_evidence", target_id="project:frank", target_revision="r1", base_revision="r1", idempotency_key="safe-key-3")
        self.assertEqual(service.apply(plan)["receipt"]["outcome"], "fail")
        plan["adapter_hash"] = "sha256:" + "b" * 64
        with self.assertRaises(ActionError): self.service.apply(plan)


if __name__ == "__main__": unittest.main()
