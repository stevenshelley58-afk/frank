import tempfile
import unittest
from pathlib import Path

from graph.safe_actions import ActionRegistry, ImmutableReceiptStore, ActionError
from graph.source_actions import SourceActionService


class Hermes:
    def request(self, **_):
        return {"authorized": True}


class Transport:
    def __init__(self): self.calls = []
    def validate(self, path, content, kind, *, timeout_seconds):
        self.calls.append(("validate", path, kind)); return {"ok": True, "frontmatter": True}
    def diff(self, path, content, *, timeout_seconds): return "--- old\n+++ new\n"
    def apply(self, path, content, *, expected_sha, timeout_seconds): self.calls.append(("apply", path)); return {"ok": True}
    def commit(self, path, *, message, expected_sha, timeout_seconds): return {"ok": True, "revision": "abc123"}
    def set_enablement(self, path, enabled, *, expected_sha, timeout_seconds): self.calls.append(("enable", enabled)); return {"ok": True}


class SourceActionsTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.path = self.root / "RULE.md"
        self.path.write_text("---\nid: rule:frank\n---\n", encoding="utf-8")
        registry = ActionRegistry.from_yaml(Path(__file__).resolve().parents[3] / "governance/control-plane/actions.yaml", enabled=True)
        self.transport = Transport()
        self.service = SourceActionService(registry, Hermes(), {
            "rule:frank": {"kind": "rule", "root": str(self.root), "path": str(self.path), "revision": "base", "project_ids": ["project:frank"]}
        }, self.transport, ImmutableReceiptStore(self.root / "receipts"))

    def test_plan_confirm_apply_and_idempotent_replay(self):
        plan = self.service.plan(action_id="tool:edit-rule", target_id="rule:frank",
                                 base_revision="base", arguments={"source_id": "rule:frank", "content": "---\nid: rule:frank\n---\nnew", "idempotency_key": "edit-rule-001"})
        result = self.service.apply(self.service.confirm(plan))
        self.assertEqual(result["receipt"]["outcome"], "pass")
        replay = self.service.apply(self.service.confirm(plan))
        self.assertTrue(replay["replayed"])
        self.assertEqual([c[0] for c in self.transport.calls], ["validate", "apply"])

    def test_out_of_root_and_stale_base_fail_closed(self):
        self.service.sources["rule:frank"] = {"kind": "rule", "root": str(self.root), "path": str(self.root / ".." / "outside.md"), "revision": "base"}
        with self.assertRaises(ActionError):
            self.service.plan(action_id="tool:edit-rule", target_id="rule:frank", base_revision="base", arguments={"content": "x", "idempotency_key": "edit-rule-002"})
        self.service.sources["rule:frank"]["path"] = str(self.path)
        with self.assertRaises(ActionError):
            self.service.plan(action_id="tool:edit-rule", target_id="rule:frank", base_revision="other", arguments={"content": "x", "idempotency_key": "edit-rule-003"})


if __name__ == "__main__": unittest.main()
