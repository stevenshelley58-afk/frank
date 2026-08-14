import json
import re
import unittest
from pathlib import Path

from tool_apps import discover_tool_apps, validate_home_manifest


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
    "ad-template-generator": "schema://frank.tool-app-release/v1",
    "content-factory": "schema://frank.content-factory-release/v1",
}
SAFE_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


class ToolAppCatalogTest(unittest.TestCase):
    def test_all_migration_tools_share_the_platform_contract(self):
        manifests = discover_tool_apps(TOOLS_ROOT)
        self.assertEqual({manifest["id"] for manifest in manifests}, EXPECTED_TOOLS)

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
