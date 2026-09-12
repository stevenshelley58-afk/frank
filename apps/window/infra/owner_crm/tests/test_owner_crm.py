from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]


class OwnerCrmFoundationTests(unittest.TestCase):
    def setUp(self):
        self.compose = (ROOT / "compose.yaml").read_text()
        self.pins = (ROOT / "pins.env").read_text()
        self.apps = json.loads((ROOT / "apps.json").read_text())

    def test_isolated_loopback_only_compose(self):
        self.assertIn("name: owner-crm", self.compose)
        self.assertIn("internal: true", self.compose)
        self.assertIn('"127.0.0.1:18081:8080"', self.compose)
        self.assertIn('/srv/frank/owner-crm/sites', self.compose)
        self.assertNotIn("blockwise-product", self.compose)
        self.assertNotIn("blockwise-crm", self.compose)

    def test_mail_and_scheduler_are_disabled(self):
        self.assertNotIn("\n  scheduler:", self.compose)
        self.assertGreaterEqual(self.compose.count("mute_emails 1"), 2)
        self.assertGreaterEqual(self.compose.count("enable_scheduler 0"), 2)

    def test_config_and_site_commands_are_single_bash_scripts(self):
        self.assertEqual(self.compose.count("    command:\n      - >-"), 2)
        self.assertNotIn("    command: >-", self.compose)
        self.assertIn('restart: "no"', self.compose)
        self.assertIn("set -C; printf", self.compose)
        self.assertIn("test ! -L sites/common_site_config.json", self.compose)

    def test_site_installs_the_supported_app_set(self):
        self.assertIn("--install-app crm --install-app telephony --install-app helpdesk", self.compose)
        self.assertEqual(
            [(app["url"].rsplit("/", 1)[-1], app["branch"]) for app in self.apps],
            [("crm", "v1.83.0"), ("telephony", "develop"), ("helpdesk", "v1.30.1")],
        )

    def test_pins_are_exact_and_build_checks_them(self):
        for key in ("FRAPPE_DOCKER_SHA", "FRAPPE_SHA", "CRM_SHA", "HELPDESK_SHA", "TELEPHONY_SHA"):
            value = next(line.split("=", 1)[1] for line in self.pins.splitlines() if line.startswith(key + "="))
            self.assertRegex(value, r"^[0-9a-f]{40}$")
        build = (ROOT / "bin/build-image.sh").read_text()
        self.assertIn("assert_ref", build)
        self.assertIn("dirty source checkout", build)
        self.assertIn("images/custom/Containerfile", build)
        self.assertIn("git -C \"apps/$app\" rev-parse HEAD", build)
        self.assertIn("free_gib < 15", build)

    def test_secrets_and_backup_requirements_stay_outside_source(self):
        example = (ROOT / ".env.example").read_text()
        self.assertIn("/srv/frank/secrets/owner-crm.env", example)
        wrapper = (ROOT / "bin/owner-crm").read_text()
        self.assertIn("source checkout is not clean", wrapper)
        self.assertIn("refusing an unmarked runtime root", wrapper)
        self.assertIn("frappe_uid=1000", wrapper)
        self.assertIn("up -d --force-recreate configurator", wrapper)
        health = (ROOT / "bin/health.sh").read_text()
        self.assertNotIn("show-config", health)
        self.assertIn("common_site_config.json", health)
        backup = (ROOT / "bin/backup-preflight.sh").read_text()
        self.assertIn("age", backup)
        self.assertIn("restore", backup)


if __name__ == "__main__":
    unittest.main()
