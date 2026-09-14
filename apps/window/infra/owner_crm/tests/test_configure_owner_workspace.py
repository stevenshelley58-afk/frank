"""Contract tests for the owner workspace configuration mechanism."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bin" / "configure-owner-workspace.sh"
LOCALE = ROOT / "bin" / "configure-owner-locale.sh"


class OwnerWorkspaceConfigTests(unittest.TestCase):
    def setUp(self):
        self.script = SCRIPT.read_text(encoding="utf-8")
        self.locale = LOCALE.read_text(encoding="utf-8")

    def test_preview_is_the_default_and_writes_nothing(self):
        self.assertIn("--apply", self.script)
        self.assertIn("No value is written without --apply.", self.script)
        preview = self.script[self.script.index("if (( ! apply )); then"):self.script.index("set_single \"System Settings\"")]
        self.assertNotIn("set_single", preview)

    def test_only_supported_single_doctype_settings_are_written(self):
        for target in ('set_single "System Settings" "app_name"',
                       'set_single "FCRM Settings" "brand_name"',
                       'set_single "HD Settings" "brand_name"'):
            self.assertIn(target, self.script)
        # No application file may be patched to hide navigation.
        self.assertNotIn("sed -i", self.script)
        self.assertNotIn("site-packages", self.script)
        self.assertNotIn("frontend/src", self.script)

    def test_base_url_is_asserted_through_the_application_accessor(self):
        self.assertIn("frappe.utils.get_url", self.script)
        self.assertIn("configure-owner-locale.sh --apply", self.script)

    def test_locale_script_owns_the_public_origin(self):
        self.assertIn("OWNER_CRM_PUBLIC_URL", self.locale)
        self.assertIn("https://crm.frank.fail", self.locale)
        self.assertIn('docker exec "$container" bench --site "$site" set-config host_name "$url"', self.locale)

    def test_owner_least_privilege_is_asserted(self):
        self.assertIn('assert "System Manager" not in role_names', self.script)
        self.assertIn("HD Agent", self.script)
        self.assertIn("required = {", self.script)

    def test_verification_reads_live_state(self):
        self.assertIn("docker exec", self.script)
        self.assertIn("list-apps", self.script)
        self.assertIn("frappe.permissions.get_roles", self.script)


if __name__ == "__main__":
    unittest.main()
