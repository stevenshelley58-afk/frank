from pathlib import Path
import unittest


WEB = Path(__file__).resolve().parents[1] / "web"


class UiContractTest(unittest.TestCase):
    def test_explorer_remains_one_pinnable_vps_tree(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        script = (WEB / "js" / "app.js").read_text(encoding="utf-8")

        self.assertNotIn('id="exp-root"', html)
        self.assertNotIn('id="exp-preview"', html)
        self.assertIn('id="ctx-pin"', html)
        self.assertIn('placeholder="Search VPS"', html)
        self.assertIn('root: "vps"', script)
        self.assertIn("EXPLORER_PINS_KEY", script)
        self.assertIn("togglePin(entry)", script)

    def test_attachments_stage_without_auto_sending(self):
        script = (WEB / "js" / "app.js").read_text(encoding="utf-8")
        styles = (WEB / "app.css").read_text(encoding="utf-8")

        self.assertNotIn("sendFilesNow", script)
        self.assertIn("stageFiles(await filesFromTransfer", script)
        self.assertIn("function pendingAttachment", script)
        self.assertIn("await Promise.allSettled(waits)", script)
        self.assertIn("att-image-pending", styles)


if __name__ == "__main__":
    unittest.main()
