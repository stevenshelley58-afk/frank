import unittest

from hermes_adapter.http import RestSurface
from hermes_adapter.kanban import KanbanCli, KanbanError, frozen_create_payload, validate_id
from hermes_adapter.models import ModelCatalog, ModelError


class _FakeResponse:
    def __init__(self, result):
        self.result = result

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    @property
    def status(self):
        return self.result[0]

    def read(self, limit):
        import json

        return json.dumps(self.result[1]).encode()


class ModelCatalogTest(unittest.TestCase):
    def catalog(self, payload):
        surface = RestSurface(
            "gateway", "http://127.0.0.1:18643", lambda: {},
            urlopen=lambda request, timeout: _FakeResponse((200, payload)),
        )
        return ModelCatalog(surface)

    def test_validate_choice_returns_effective_entry_with_metadata(self):
        options = {"options": [{"model": "hermes-agent", "provider": "nous", "price": 0.0, "reasoning": ["low", "high"]}]}
        entry = self.catalog({"options": options["options"]}).validate_choice("hermes-agent", provider="nous")
        self.assertEqual(entry["price"], 0.0)
        self.assertEqual(entry["reasoning"], ["low", "high"])

    def test_unknown_model_is_error_never_fallback(self):
        options = {"options": [{"model": "other", "provider": "nous"}]}
        with self.assertRaises(ModelError):
            self.catalog(options).validate_choice("hermes-agent")

    def test_provider_conflict_is_error(self):
        options = {"options": [{"model": "hermes-agent", "provider": "nous"}]}
        with self.assertRaises(ModelError):
            self.catalog(options).validate_choice("hermes-agent", provider="openai")


class KanbanCliTest(unittest.TestCase):
    def test_no_verbs_is_refused_at_construction(self):
        with self.assertRaises(ValueError):
            KanbanCli(executable="/usr/bin/hermes", allowed_verbs=set())

    def test_unallowlisted_verb_refused_without_execution(self):
        ran = []

        def runner(argv, **kwargs):
            ran.append(argv)
            raise AssertionError("must not execute")

        cli = KanbanCli(executable="/usr/bin/hermes", allowed_verbs={"list"}, runner=runner)
        with self.assertRaises(KanbanError):
            cli.run("destroy")
        self.assertEqual(ran, [])

    def test_argv_is_array_without_shell_and_output_is_json(self):
        captured = {}

        class Completed:
            returncode = 0
            stdout = b'{"tasks": []}'
            stderr = b""

        def runner(argv, **kwargs):
            captured.update(kwargs, argv=argv)
            return Completed()

        cli = KanbanCli(executable="/usr/bin/hermes", allowed_verbs={"list"}, runner=runner)
        result = cli.run("list", ["--board", "v021canary-b1"])
        self.assertEqual(result, {"tasks": []})
        self.assertEqual(captured["argv"][0], "/usr/bin/hermes")
        self.assertIn("kanban", captured["argv"])
        self.assertIn("--json", captured["argv"])
        self.assertFalse(captured["shell"])

    def test_unsafe_ids_refused(self):
        cli = KanbanCli(executable="/usr/bin/hermes", allowed_verbs={"list"}, runner=lambda *a, **k: None)
        with self.assertRaises(KanbanError):
            cli.run("list", ["--board", "a;rm -rf /"])

    def test_frozen_create_payload(self):
        payload = frozen_create_payload(
            title=" Do work ",
            workspace_path="/projects/blockwise",
            idempotency_key="v021canary-abc123",
            resolve_path=lambda p: p,
        )
        self.assertTrue(payload["triage"])
        self.assertEqual(payload["workspace_kind"], "dir")
        self.assertEqual(payload["assignee"], "default")
        self.assertFalse(payload["kanban.auto_decompose"])
        self.assertFalse(payload["kanban.auto_subscribe_on_create"])
        self.assertEqual(payload["workspace_path"], "/projects/blockwise")
        with self.assertRaises(KanbanError):
            frozen_create_payload(title="x", workspace_path="relative/../path", idempotency_key="k", resolve_path=None)
        with self.assertRaises(KanbanError):
            frozen_create_payload(title="x", workspace_path="/projects/p", idempotency_key="bad key!", resolve_path=None)

    def test_validate_id(self):
        self.assertEqual(validate_id("run_abc.1", "id"), "run_abc.1")
        with self.assertRaises(KanbanError):
            validate_id("../escape", "id")


if __name__ == "__main__":
    unittest.main()
