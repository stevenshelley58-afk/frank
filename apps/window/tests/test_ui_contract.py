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
        self.assertIn('method: "DELETE"', script)
        self.assertIn("discardAttachments", script)
        self.assertIn("att-image-pending", styles)
        self.assertIn("att-folder-pending", styles)

    def test_accounts_tool_is_secret_safe_and_responsive(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        script = (WEB / "js" / "app.js").read_text(encoding="utf-8")
        widgets = (WEB / "js" / "widgets.js").read_text(encoding="utf-8")
        styles = (WEB / "app.css").read_text(encoding="utf-8")

        self.assertIn('data-view="accounts"', html)
        self.assertIn('id="account-credential"', html)
        self.assertIn('role="dialog"', html)
        self.assertIn('id="account-results-status" aria-live="polite"', html)
        self.assertNotIn('type="password"', html)
        self.assertIn('id: "account-manager"', widgets)
        self.assertIn('id: "campaigns"', widgets)
        self.assertIn('accountRequest("/api/accounts")', script)
        self.assertIn("accountEditorKeydown", script)
        self.assertIn('aria-pressed="${selected}"', script)
        self.assertIn(".account-editor", styles)
        self.assertIn("max-width: 1100px", styles)
        self.assertIn(".rail-item { min-height: 44px; }", styles)


if __name__ == "__main__":
    unittest.main()
