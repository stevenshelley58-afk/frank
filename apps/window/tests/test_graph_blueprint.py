import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.blueprint import ALIASES, TOOL_MANIFEST_ADAPTER, VIEW_REGISTRATIONS, WIDGET_MANIFEST, registration_blueprint


class GraphBlueprintTest(unittest.TestCase):
    def test_registration_isolated_until_final_main_assembly(self):
        blueprint = registration_blueprint()
        self.assertEqual(blueprint["capabilities"], ["frank.graph.v1"])
        self.assertEqual({item["id"] for item in blueprint["views"]}, {"graph", "trace"})
        self.assertEqual(blueprint["views"][0]["host"], "slot-graph")
        self.assertEqual(blueprint["views"][1]["host"], "slot-trace")
        self.assertEqual(blueprint["aliases"], {"trace-view": "graph-workbench"})
        self.assertEqual(blueprint["widgets"], [WIDGET_MANIFEST])
        self.assertEqual(blueprint["adapters"], [TOOL_MANIFEST_ADAPTER])
        self.assertEqual(VIEW_REGISTRATIONS[0]["renderer"], "graph-workbench")

    def test_returned_records_are_copies(self):
        blueprint = registration_blueprint()
        blueprint["widgets"][0]["surfaces"].append("bad")
        self.assertNotIn("bad", WIDGET_MANIFEST["surfaces"])


if __name__ == "__main__":
    unittest.main()
