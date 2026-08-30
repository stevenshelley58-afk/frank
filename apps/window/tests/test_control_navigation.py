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
        self.assertNotIn("setup-board", live)
        self.assertNotIn("spawn", live)


if __name__ == "__main__":
    unittest.main()
