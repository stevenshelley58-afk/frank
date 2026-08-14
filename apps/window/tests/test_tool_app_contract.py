import json
import tempfile
import unittest
from pathlib import Path

from tool_apps.adapters import HermesAdapter, command, event, trace
from tool_apps.home_manifest import validate_home_manifest
from tool_apps.contracts import (
    COMMAND_SCHEMA,
    MANIFEST_SCHEMA,
    PIPELINE_SCHEMA,
    SETTING_SCHEMA,
    ContractError,
    SettingRevisionStore,
    discover_tool_apps,
    validate_manifest,
    validate_pipeline,
    _walk_safe,
)


def manifest(**overrides):
    value = {
        "schema": MANIFEST_SCHEMA, "id": "weekly-report", "version": "1.0.0",
        "name": "Weekly report", "description": "Review a project report.",
        "scopes": ["project"], "settings": {"schema": SETTING_SCHEMA, "properties": {
            "prompt_ref": {"type": "string"}, "prompt_version": {"type": "string"},
            "style_preset": {"type": "string"}, "model_policy": {"type": "object"},
            "connection_id": {"type": "string"}, "capabilities": {"type": "array"}, "schedule": {"type": "string"},
            "threshold": {"type": "number"}, "approval_gate": {"type": "boolean"},
        }}, "pipelines": [{"schema": PIPELINE_SCHEMA, "nodes": [
            {"id": "start", "kind": "trigger"}, {"id": "run", "kind": "hermes-command"}],
            "edges": [{"from": "start", "to": "run"}]}],
        "capabilities": ["reports.read"], "connectors": [], "schedules": [],
        "thresholds": [], "approval_gates": [],
    }
    value.update(overrides)
    return value


class ToolAppContractTest(unittest.TestCase):
    def test_tool_owned_home_manifest_is_exact_and_non_executable(self):
        home = {"id": "weekly-report", "name": "Weekly report", "kind": "tool", "blurb": "Review a project report.", "capabilities": ["reports.read"], "default_widget_ids": [], "connection_capabilities": []}
        self.assertEqual(validate_home_manifest(home)["kind"], "tool")
        reordered = {key: home[key] for key in reversed(home)}
        self.assertEqual(validate_home_manifest(reordered)["id"], "weekly-report")
        with self.assertRaises(ContractError):
            validate_home_manifest({**home, "callback": "run()"})
        with self.assertRaises(ContractError):
            validate_home_manifest({key: value for key, value in home.items() if key != "blurb"})

    def test_discovery_loads_versioned_manifests_and_rejects_mismatch(self):
        with tempfile.TemporaryDirectory() as root:
            app_dir = Path(root) / "weekly-report"
            app_dir.mkdir()
            (app_dir / "manifest.json").write_text(json.dumps(manifest()), encoding="utf-8")
            self.assertEqual(discover_tool_apps(root)[0]["id"], "weekly-report")
            (app_dir / "manifest.json").write_text(json.dumps(manifest(id="other")), encoding="utf-8")
            with self.assertRaises(ContractError):
                discover_tool_apps(root)

    def test_manifest_rejects_html_secrets_and_bad_scopes(self):
        for payload in (manifest(description="<b>unsafe</b>"), manifest(description="Bearer abcdefghijklmnop"), manifest(scopes=["tenant"]), manifest(scopes=["project", "project"])):
            with self.subTest(payload=payload):
                with self.assertRaises(ContractError):
                    validate_manifest(payload)
        with self.assertRaises(ContractError):
            validate_manifest(manifest(settings={"schema": SETTING_SCHEMA, "properties": {"secret_ref": {"type": "string"}}}))

    def test_declarative_values_are_strict_json_and_executable_keys_are_rejected(self):
        for value in (float("nan"), float("inf"), b"bytes", ("tuple",), object(), {1: "non-string key"}):
            with self.subTest(value=type(value).__name__), self.assertRaises(ContractError):
                _walk_safe(value)
        cycle = []
        cycle.append(cycle)
        with self.assertRaises(ContractError):
            _walk_safe(cycle)
        cyclic_settings = {"schema": SETTING_SCHEMA, "properties": {}}
        cyclic_settings["loop"] = cyclic_settings
        with self.assertRaises(ContractError):
            validate_manifest(manifest(settings=cyclic_settings))
        with self.assertRaises(ContractError):
            _walk_safe({"nested": {"handler": "not executable"}})

        forbidden = ("credential", "vault_ref", "provider", "secret", "token", "password", "api_key", "connection_ref", "connector_ref")
        for field in forbidden:
            with self.subTest(field=field), self.assertRaises(ContractError):
                validate_manifest(manifest(settings={"schema": SETTING_SCHEMA, "properties": {field: {"type": "string"}}}))
        self.assertEqual(validate_manifest(manifest(settings={"schema": SETTING_SCHEMA, "properties": {"connection_id": {"type": "string"}, "capabilities": {"type": "array"}}}))["id"], "weekly-report")

    def test_pipeline_is_acyclic_and_has_known_edges(self):
        cyclic = {"schema": PIPELINE_SCHEMA, "nodes": [{"id": "a", "kind": "step"}, {"id": "b", "kind": "step"}], "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}]}
        with self.assertRaises(ContractError):
            validate_pipeline(cyclic)
        with self.assertRaises(ContractError):
            validate_pipeline({"schema": PIPELINE_SCHEMA, "nodes": [{"id": "a", "kind": "step", "callback": "run"}], "edges": []})
        with self.assertRaises(ContractError):
            validate_pipeline({"schema": PIPELINE_SCHEMA, "nodes": [{"id": "a", "kind": "step"}, {"id": "b", "kind": "step"}], "edges": [{"from": "a", "to": "b", "handler": "run"}]})

    def test_settings_are_scoped_optimistic_and_immutable(self):
        store = SettingRevisionStore(["project"])
        first = store.update("project:frank", {"prompt_ref": "openbao://frank/prompts/report"}, 0)
        self.assertEqual(first["revision"], 1)
        with self.assertRaises(ContractError):
            store.update("project:frank", {"prompt_ref": "new"}, 0)
        with self.assertRaises(ContractError):
            store.update("project:frank", {"token": "plain-text"}, 1)
        first["settings"]["prompt_ref"] = "changed"
        self.assertEqual(store.read("project:frank")["settings"]["prompt_ref"], "openbao://frank/prompts/report")
        self.assertEqual(len(store.history("project:frank")), 1)

    def test_command_event_trace_adapter_are_ordered_envelopes(self):
        request = command("weekly-report", "run", "project:frank", {"style": "brief"}, request_id="req-1")
        self.assertEqual(request["schema"], COMMAND_SCHEMA)
        emitted = [event("req-1", 0, "started", {}), event("req-1", 1, "completed", {"rows": 3})]
        self.assertEqual(trace("req-1", emitted)["events"], emitted)
        seen = []
        self.assertEqual(HermesAdapter(lambda _request: emitted, seen.append).dispatch(request), emitted)
        self.assertEqual(seen, emitted)

    def test_command_event_and_trace_reject_invalid_envelopes(self):
        with self.assertRaises(ContractError):
            command("weekly-report", "run", "project:frank", [])
        for tool_id, action in (("Weekly Report", "run"), ("weekly-report", "run now")):
            with self.assertRaises(ContractError):
                command(tool_id, action, "project:frank", {})
        for kwargs in (
            {"request_id": "bad id"}, {"kind": "not an event"}, {"status": "unknown"},
            {"timestamp": float("inf")}, {"data": []},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ContractError):
                values = {"request_id": "req-1", "sequence": 0, "kind": "started", "data": {}}
                values.update(kwargs)
                event(**values)
        valid = event("req-1", 0, "started", {})
        for invalid in (
            {**valid, "schema": "other"}, {**valid, "sequence": 1},
            {**valid, "request_id": "req-2"},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ContractError):
                trace("req-1", [invalid])
        with self.assertRaises(ContractError):
            trace("req-1", [valid, {**valid, "sequence": 0}])

    def test_request_ids_use_their_own_bounded_contract(self):
        uuid_like = "123e4567-e89b-12d3-a456-426614174000"
        request = command("weekly-report", "run", "project:frank", {}, request_id=uuid_like)
        self.assertEqual(request["request_id"], uuid_like)
        generated = command("weekly-report", "run", "project:frank", {})["request_id"]
        self.assertRegex(generated, r"^req-[A-Za-z0-9-]{1,127}$")
        for unsafe in ("req 1", "req/1", ""):
            with self.subTest(unsafe=unsafe), self.assertRaises(ContractError):
                command("weekly-report", "run", "project:frank", {}, request_id=unsafe)

    def test_adapter_validates_event_fields_before_emitting(self):
        request = command("weekly-report", "run", "project:frank", {}, request_id="req-1")
        emitted = []
        invalid = {**event("req-1", 0, "started", {}), "status": "unknown"}
        with self.assertRaises(ContractError):
            HermesAdapter(lambda _request: [invalid], emitted.append).dispatch(request)
        self.assertEqual(emitted, [])

    def test_adapter_requires_strict_command_and_event_batches(self):
        request = command("weekly-report", "run", "project:frank", {}, request_id="req-1")
        for invalid_request in (
            {**request, "extra": True}, {**request, "payload": []},
            {**request, "scope": "tenant:other"}, {**request, "request_id": "req/1"},
        ):
            with self.subTest(invalid_request=invalid_request), self.assertRaises(ContractError):
                HermesAdapter(lambda _request: [], lambda _event: self.fail("forwarded invalid command")).dispatch(invalid_request)
        emitted = []
        valid = event("req-1", 0, "started", {})
        for result in ({"not": "a list"}, [valid, event("req-2", 1, "completed", {})]):
            with self.subTest(result=result), self.assertRaises(ContractError):
                HermesAdapter(lambda _request, result=result: result, emitted.append).dispatch(request)
            self.assertEqual(emitted, [])


if __name__ == "__main__":
    unittest.main()
