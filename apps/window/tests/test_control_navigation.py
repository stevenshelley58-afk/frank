import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]


class ControlNavigationTests(unittest.TestCase):
    def test_shell_has_operate_tabs_and_surfaces(self):
        html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        for name in ("live", "map", "control"):
            self.assertIn(f'data-view="{name}"', html)
            self.assertIn(f'id="operate-{name}"', html)

    def test_operate_modules_keep_upstreams_separate(self):
        live = (ROOT / "web" / "js" / "live.js").read_text(encoding="utf-8")
        mapping = (ROOT / "web" / "js" / "map.js").read_text(encoding="utf-8")
        self.assertIn("/agenttrail/", live)
        self.assertIn("/api/control/maps/artifact", mapping)
        self.assertIn("mapSummary", mapping)
        self.assertIn("Coverage gaps", mapping)
        self.assertIn("validated", mapping)
        self.assertNotIn("setup-board", live)
        self.assertNotIn("spawn", live)

    def test_map_heading_and_summary_follow_the_selected_projection(self):
        mapping = (ROOT / "web" / "js" / "map.js").read_text(encoding="utf-8")
        self.assertIn('id="map-heading"', mapping)
        self.assertIn('id="map-summary"', mapping)
        self.assertIn("heading.textContent = mapLabel(row)", mapping)
        self.assertIn("summary.textContent = mapSummary(row)", mapping)
        self.assertIn("stable_id_map", mapping)
        self.assertIn("Relationships are listed in Control", mapping)
        self.assertNotIn("<h2>VPS World</h2>", mapping)


if __name__ == "__main__":
    unittest.main()
