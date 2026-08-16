import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.blueprint import TOOL_MANIFEST_ADAPTER, registration_blueprint


class GraphBlueprintTest(unittest.TestCase):
    def test_isolated_descriptor_does_not_claim_unwired_runtime_features(self):
        blueprint = registration_blueprint()
        self.assertEqual(blueprint["capabilities"], [])
        self.assertEqual(blueprint["views"], [])
        self.assertEqual(blueprint["widgets"], [])
        self.assertEqual(blueprint["aliases"], {})
        self.assertEqual(blueprint["adapters"], [TOOL_MANIFEST_ADAPTER])
        self.assertEqual(TOOL_MANIFEST_ADAPTER["produces"], ["schema://frank.graph/v1"])
        self.assertNotIn("schema://frank.tool-app-command/v1", TOOL_MANIFEST_ADAPTER["accepts"])
        self.assertNotIn("schema://frank.tool-app-event/v1", TOOL_MANIFEST_ADAPTER["accepts"])
        self.assertNotIn("schema://frank.tool-app-trace/v1", TOOL_MANIFEST_ADAPTER["accepts"])
        self.assertNotIn("trace", TOOL_MANIFEST_ADAPTER["surfaces"])

    def test_returned_records_are_copies(self):
        blueprint = registration_blueprint()
        blueprint["adapters"][0]["surfaces"].append("bad")
        self.assertNotIn("bad", TOOL_MANIFEST_ADAPTER["surfaces"])


if __name__ == "__main__":
    unittest.main()
