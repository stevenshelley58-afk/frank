import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.blueprint import KNOWLEDGE_PROJECTION_ADAPTER, TOOL_MANIFEST_ADAPTER, registration_blueprint


class GraphBlueprintTest(unittest.TestCase):
    def test_live_descriptor_claims_assembled_runtime_features(self):
        blueprint = registration_blueprint()
        self.assertEqual(blueprint["capabilities"], ["frank.graph.v1", "frank.graph.v2"])
        self.assertEqual(blueprint["views"], [])
        self.assertEqual([item["id"] for item in blueprint["widgets"]], ["entity-graph"])
        self.assertEqual(blueprint["aliases"], {})
        self.assertEqual(blueprint["adapters"], [TOOL_MANIFEST_ADAPTER, KNOWLEDGE_PROJECTION_ADAPTER])
        self.assertEqual(blueprint["widgets"][0]["surfaces"], ["project", "tool"])
        self.assertEqual(TOOL_MANIFEST_ADAPTER["produces"], ["schema://frank.graph/v1"])
        self.assertEqual(TOOL_MANIFEST_ADAPTER["accepts"], ["schema://frank.tool-app-manifest/v1"])
        self.assertEqual(TOOL_MANIFEST_ADAPTER["surfaces"], ["tool"])
        self.assertNotIn("schema://frank.tool-app-command/v1", TOOL_MANIFEST_ADAPTER["accepts"])
        self.assertNotIn("schema://frank.tool-app-event/v1", TOOL_MANIFEST_ADAPTER["accepts"])
        self.assertNotIn("schema://frank.tool-app-trace/v1", TOOL_MANIFEST_ADAPTER["accepts"])
        self.assertNotIn("trace", TOOL_MANIFEST_ADAPTER["surfaces"])
        self.assertEqual(KNOWLEDGE_PROJECTION_ADAPTER["produces"], ["schema://frank.graph/v2"])
        self.assertEqual(KNOWLEDGE_PROJECTION_ADAPTER["surfaces"], ["project"])
        self.assertEqual(KNOWLEDGE_PROJECTION_ADAPTER["lens"], "knowledge.combined")

    def test_returned_records_are_copies(self):
        blueprint = registration_blueprint()
        blueprint["adapters"][0]["surfaces"].append("bad")
        self.assertNotIn("bad", TOOL_MANIFEST_ADAPTER["surfaces"])
        blueprint["adapters"][1]["surfaces"].append("bad")
        self.assertNotIn("bad", KNOWLEDGE_PROJECTION_ADAPTER["surfaces"])


if __name__ == "__main__":
    unittest.main()
