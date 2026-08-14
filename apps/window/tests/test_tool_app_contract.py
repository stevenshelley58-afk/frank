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
)


def manifest(**overrides):
    value = {
        "schema": MANIFEST_SCHEMA, "id": "weekly-report", "version": "1.0.0",
        "name": "Weekly report", "description": "Review a project report.",
        "scopes": ["project"], "settings": {"schema": SETTING_SCHEMA, "properties": {
            "prompt_ref": {"type": "string"}, "prompt_version": {"type": "string"},
            "style_preset": {"type": "string"}, "model_policy": {"type": "object"},
            "connector_ref": {"type": "string"}, "schedule": {"type": "string"},
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
        home_path = Path(__file__).parents[1] / "tool_apps" / "weekly_report" / "home.json"
        home = json.loads(home_path.read_text(encoding="utf-8"))
        self.assertEqual(tuple(home), ("id", "name", "kind", "blurb", "capabilities", "default_widget_ids", "connection_capabilities"))
        self.assertEqual(validate_home_manifest(home)["kind"], "tool")
        with self.assertRaises(ContractError):
            validate_home_manifest({**home, "callback": "run()"})

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
        self.assertEqual(validate_manifest(manifest(settings={"schema": SETTING_SCHEMA, "properties": {"secret_ref": {"type": "string"}}}))["id"], "weekly-report")

    def test_pipeline_is_acyclic_and_has_known_edges(self):
        cyclic = {"schema": PIPELINE_SCHEMA, "nodes": [{"id": "a", "kind": "step"}, {"id": "b", "kind": "step"}], "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}]}
        with self.assertRaises(ContractError):
            validate_pipeline(cyclic)

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


if __name__ == "__main__":
    unittest.main()
