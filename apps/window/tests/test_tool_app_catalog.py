import json
import re
import unittest
from pathlib import Path

from tool_apps import discover_tool_apps, discover_tool_homes, validate_home_manifest


TOOLS_ROOT = Path(__file__).parents[1] / "tools"
EXPECTED_TOOLS = {
    "ad-intelligence",
    "ad-template-generator",
    "content-factory",
    "mail",
    "outreach",
    "prospect-discovery",
}
PUBLISHING_TOOLS = {
    "ad-intelligence": "schema://frank.ad-intelligence-release/v1",
    "ad-template-generator": "schema://frank.template-pack/v1",
    "content-factory": "schema://frank.content-factory-release/v1",
}
ADJUSTABLE_SETTINGS = {
    "ad-intelligence": ("prompt_ref", "style_preset", "model_policy", "thresholds", "cadence"),
    "ad-template-generator": ("model_policy_revision", "placements", "qa_thresholds", "approval_policy"),
    "content-factory": ("prompt_refs", "tone_style", "model_policy", "thresholds", "schedule_ref"),
    "mail": ("reply_classification.prompt_ref", "reply_classification.model_policy", "sync.poll_interval"),
    "outreach": ("personalized_draft.prompt_ref", "personalized_draft.style_preset", "personalized_draft.model_policy", "sequence.timing"),
    "prospect-discovery": ("qualification_policy.prompt_ref", "qualification_policy.model_policy", "qualification_policy.confidence_threshold"),
}


def setting_property(properties, dotted_path):
    current = properties
    for part in dotted_path.split("."):
        current = current[part]
        current = current.get("properties", {})
    return True
SAFE_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


class ToolAppCatalogTest(unittest.TestCase):
    def test_all_migration_tools_share_the_platform_contract(self):
        manifests = discover_tool_apps(TOOLS_ROOT)
        self.assertEqual({manifest["id"] for manifest in manifests}, EXPECTED_TOOLS)
        self.assertEqual({home["id"] for home in discover_tool_homes(TOOLS_ROOT)}, EXPECTED_TOOLS)

        for manifest in manifests:
            tool_id = manifest["id"]
            home = json.loads((TOOLS_ROOT / tool_id / "home.json").read_text(encoding="utf-8"))
            self.assertEqual(validate_home_manifest(home)["id"], tool_id)
            self.assertEqual(home["default_widget_ids"], [])

            pipelines = manifest.get("pipelines")
            self.assertIsInstance(pipelines, list, f"{tool_id}.pipelines")
            self.assertTrue(pipelines, f"{tool_id}.pipelines must not be empty")

            trace = manifest.get("trace")
            self.assertIsInstance(trace, dict, f"{tool_id}.trace")
            self.assertEqual(trace.get("schema"), "schema://frank.tool-app-trace/v1")

            if tool_id in PUBLISHING_TOOLS:
                self.assertEqual(manifest.get("release_schema"), PUBLISHING_TOOLS[tool_id])

            settings = manifest["settings"]["properties"]
            for dotted_path in ADJUSTABLE_SETTINGS[tool_id]:
                with self.subTest(tool_id=tool_id, setting=dotted_path):
                    self.assertTrue(setting_property(settings, dotted_path))

            if home["connection_capabilities"]:
                self.assertIn("connection", settings, f"{tool_id} must select a shared Connection")
                self.assertEqual(set(settings["connection"]["properties"]), {"connection_id", "capability"})

            hermes = manifest.get("hermes")
            self.assertIsInstance(hermes, dict, f"{tool_id}.hermes")
            for field in ("actions", "event_kinds"):
                values = hermes.get(field)
                self.assertIsInstance(values, list, f"{tool_id}.{field}")
                self.assertTrue(values, f"{tool_id}.{field} must not be empty")
                self.assertTrue(
                    all(isinstance(value, str) and SAFE_ID.fullmatch(value) for value in values),
                    f"{tool_id}.{field} must use shared kebab-safe identifiers",
                )


if __name__ == "__main__":
    unittest.main()
