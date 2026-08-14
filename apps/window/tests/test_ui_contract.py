from pathlib import Path
import re
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
        self.assertIn('<option value="customer">Customer</option>', html)
        self.assertIn('id="account-auth-status"', html)
        self.assertIn('id="account-billing-status"', html)
        self.assertIn('Card and bank details are rejected', html)
        self.assertIn('changing this does not alter project access', html)
        self.assertIn('role="dialog"', html)
        self.assertIn('id="account-results-status" aria-live="polite"', html)
        self.assertNotIn('type="password"', html)
        self.assertIn('id: "account-manager"', widgets)
        self.assertIn('id: "campaigns"', widgets)
        self.assertIn('accountRequest("/api/accounts")', script)
        self.assertIn("accountEditorKeydown", script)
        self.assertIn("syncAccountKindFields", script)
        self.assertIn('kind === "customer"', script)
        self.assertIn('aria-pressed="${selected}"', script)
        self.assertIn(".account-editor", styles)
        self.assertIn("max-width: 1100px", styles)
        self.assertIn(".rail-item { min-height: 44px; }", styles)

    def test_entity_homes_add_tools_without_changing_the_live_rail(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        app = (WEB / "js" / "app.js").read_text(encoding="utf-8")
        widgets = (WEB / "js" / "widgets.js").read_text(encoding="utf-8")
        homes = (WEB / "js" / "homes.js").read_text(encoding="utf-8")
        registry = (WEB / "js" / "registry.js").read_text(encoding="utf-8")
        styles = (WEB / "app.css").read_text(encoding="utf-8")

        rail_views = re.findall(r'<button class="rail-item[^>]*data-view="([^"]+)"', html)
        self.assertEqual(rail_views, ["hub", "files", "tools", "trace", "releases"])
        rail_projects = re.findall(r'<button class="rail-item[^>]*data-project="([^"]+)"', html)
        self.assertEqual(rail_projects, ["blockwise", "merrypaws", "elfwonder", "pavone"])

        self.assertIn('data-view="entity-home"', html)
        self.assertIn('data-view="widget-builder"', html)
        self.assertIn('data-view="connections"', html)
        self.assertIn('id="view-title" tabindex="-1"', html)
        self.assertIn('id="widget-catalog"', html)
        self.assertIn('id="connection-catalog"', html)
        self.assertNotIn('type="password"', html)
        self.assertIn('id: "connections"', widgets)
        self.assertIn('id: "widget-builder"', widgets)
        self.assertIn('id: "hermes-tool"', widgets)
        self.assertIn("openProjectHome(currentProject)", app)
        self.assertIn('window.addEventListener("frank:entity-home"', app)
        self.assertIn("expected_revision", homes)
        self.assertIn("Widget identity mismatch", homes)
        self.assertIn('freshness !== "poll"', homes)
        self.assertIn("window.setInterval(refreshPollingWidgets, 30_000)", homes)
        self.assertIn("textContent", homes)
        self.assertNotIn("innerHTML", homes)
        self.assertIn("duplicate widget", registry)
        self.assertIn("home-size-wide", styles)
        self.assertIn(".tool-workspace", styles)

    def test_widget_and_connection_editors_are_plain_text_reference_surfaces(self):
        html = (WEB / "index.html").read_text(encoding="utf-8")
        app = (WEB / "js" / "app.js").read_text(encoding="utf-8")
        homes = (WEB / "js" / "homes.js").read_text(encoding="utf-8")
        browser_canary = (WEB.parent / "tests" / "hosted_focus_canary.js").read_text(encoding="utf-8")
        dockerfile = (WEB.parent / "Dockerfile").read_text(encoding="utf-8")

        self.assertIn("API keys, passwords, provider code, and arbitrary HTML are rejected", html)
        self.assertIn("Never paste a password, API key, OAuth token, card number, or bank detail", html)
        self.assertIn("Activepieces credentials are configured in its secure UI", html)
        self.assertIn('id="connection-credential-ref"', html)
        self.assertIn('id="connection-ref"', html)
        self.assertIn('id="connection-status-field"', html)
        self.assertIn('role="dialog" aria-modal="true"', html)
        self.assertIn('tabindex="-1"', html)
        self.assertIn('value="setup_needed"', html)
        self.assertIn('value="connected"', html)
        self.assertIn('value="verified"', html)
        self.assertIn('value="error"', html)
        self.assertIn("Provider configuration was not changed", homes)
        self.assertIn('event.key === "Escape"', homes)
        self.assertIn('event.key !== "Tab"', homes)
        self.assertIn("inertModalBackground", homes)
        self.assertIn('$(".rail")', homes)
        self.assertIn('$(".topbar")', homes)
        self.assertIn("restoreModalBackground", homes)
        self.assertIn("closeHomeEditors({ restoreFocus: false })", app)
        self.assertIn('$("#view-title")?.focus({ preventScroll: true })', app)
        self.assertIn('activeElement: document.activeElement?.id || ""', browser_canary)
        self.assertIn('result.activeElement !== "view-title"', browser_canary)
        self.assertIn('titleTabIndex !== "-1"', browser_canary)
        self.assertIn("restoreFocus = true", homes)
        self.assertIn("offsetParent !== null", homes)
        self.assertIn('setAttribute("inert", "")', homes)
        self.assertIn("editorReturnFocus", homes)
        self.assertIn("export function closeHomeEditors", homes)
        self.assertIn('"--workers", "1"', dockerfile)
        self.assertNotIn('"--workers", "2"', dockerfile)


if __name__ == "__main__":
    unittest.main()
