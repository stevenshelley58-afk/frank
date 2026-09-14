"""Contract tests for the owner webmail component.

These assert the properties the design claims and that a later edit cannot
silently undo them: pinned upstream images, credential isolation between the
three services, a one-use short-lived launch token, and a client that never
receives a mailbox credential.
"""

from pathlib import Path
import importlib.util
import re
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "launch"))

import launch_server  # noqa: E402


class ComposeContractTests(unittest.TestCase):
    def setUp(self):
        self.compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")

    def test_images_are_pinned_by_digest(self):
        dockerfiles = {
            "roundcube": (ROOT / "roundcube" / "Dockerfile").read_text(encoding="utf-8"),
            "launch": (ROOT / "launch" / "Dockerfile").read_text(encoding="utf-8"),
        }
        self.assertIn("roundcube/roundcubemail:1.7.4-apache@sha256:", dockerfiles["roundcube"])
        self.assertIn("python:3.12-alpine@sha256:", dockerfiles["launch"])
        self.assertIn("nginx:1.28.0-alpine@sha256:", self.compose)
        self.assertNotIn(":latest", self.compose)
        self.assertNotIn(":latest", "".join(dockerfiles.values()))

    def test_only_the_ingress_publishes_a_loopback_port(self):
        self.assertEqual(self.compose.count("ports: ["), 1)
        self.assertIn('"127.0.0.1:${OWNER_WEBMAIL_HOST_PORT:-18107}:80"', self.compose)
        self.assertNotIn("0.0.0.0:", self.compose)

    def test_private_network_is_internal_and_only_the_client_has_egress(self):
        self.assertIn("name: frank_owner_webmail_private\n    internal: true", self.compose)
        self.assertIn(
            "networks: [owner-webmail-private, owner-webmail-egress]\n    security_opt: [no-new-privileges:true]",
            self.compose,
        )
        self.assertIn("networks: [owner-webmail-private]\n    read_only: true", self.compose)

    def test_mailbox_credential_is_only_visible_to_the_mail_client(self):
        webmail, launch, ingress = self._blocks()
        self.assertIn("OWNER_WEBMAIL_IMAP_PASSWORD", webmail)
        self.assertNotIn("OWNER_WEBMAIL_IMAP_PASSWORD", launch)
        self.assertNotIn("OWNER_WEBMAIL_IMAP_PASSWORD", ingress)
        self.assertNotIn("OWNER_WEBMAIL_INGRESS_SECRET", webmail)

    def test_launch_broker_holds_no_mailbox_secret_and_is_hardened(self):
        _, launch, _ = self._blocks()
        self.assertIn("read_only: true", launch)
        self.assertIn("cap_drop", self.compose)
        self.assertIn("security_opt: [no-new-privileges:true]", launch)

    def test_committed_configuration_ships_in_the_image_not_as_a_runtime_edit(self):
        dockerfile = (ROOT / "roundcube" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY config.inc.php /usr/src/roundcubemail/config/config.inc.php", dockerfile)
        self.assertIn("COPY plugins/frank_sso /usr/src/roundcubemail/plugins/frank_sso", dockerfile)
        self.assertIn("php -l", dockerfile)
        self.assertIn(
            "COPY entrypoint/10-restore-committed-config.sh /entrypoint-tasks/post-setup/10-restore-committed-config.sh",
            dockerfile,
        )
        self.assertIn("build:\n      context: ./roundcube", self.compose)
        self.assertIn("./ingress/default.conf.template:/etc/nginx/templates/default.conf.template:ro", self.compose)

    def test_every_runtime_variable_the_config_reads_is_passed_in(self):
        import re as _re

        webmail, _, _ = self._blocks()
        readers = (ROOT / "roundcube" / "config.inc.php").read_text(encoding="utf-8")
        readers += (ROOT / "roundcube" / "plugins" / "frank_sso" / "frank_sso.php").read_text(encoding="utf-8")
        wanted = {
            name
            for name in _re.findall(r"OWNER_WEBMAIL_[A-Z_]+", readers)
            if name not in {"OWNER_WEBMAIL_LAUNCH_URL", "OWNER_WEBMAIL_STATE_DIR", "OWNER_WEBMAIL_LAUNCH_PORT"}
        }
        for name in sorted(wanted):
            self.assertIn("%s:" % name, webmail, name)

    def test_running_containers_are_stamped_with_the_applied_revision(self):
        self.assertEqual(self.compose.count("labels: *source-labels"), 3)
        self.assertIn("io.frank.owner-webmail.applied-source-sha", self.compose)

    def _blocks(self) -> tuple[str, str, str]:
        start = self.compose.index("\n  webmail:")
        launch_at = self.compose.index("\n  launch:", start)
        ingress_at = self.compose.index("\n  ingress:", launch_at)
        volumes_at = self.compose.index("\nvolumes:", ingress_at)
        return (
            self.compose[start:launch_at],
            self.compose[launch_at:ingress_at],
            self.compose[ingress_at:volumes_at],
        )


class RoundcubeConfigTests(unittest.TestCase):
    def setUp(self):
        self.config = (ROOT / "roundcube" / "config.inc.php").read_text(encoding="utf-8")

    def test_provider_transport_is_the_documented_one(self):
        self.assertIn("OWNER_WEBMAIL_IMAP_HOST", self.config)
        self.assertIn("OWNER_WEBMAIL_SMTP_HOST", self.config)
        self.assertIn("'verify_peer' => true", self.config)
        self.assertIn("'verify_peer_name' => true", self.config)

    def test_submission_does_not_duplicate_the_sent_copy(self):
        self.assertIn("$config['smtp_save_sent_messages'] = false;", self.config)
        self.assertIn("$config['sent_mbox'] = 'Sent';", self.config)
        self.assertIn("$config['create_default_folders'] = false;", self.config)

    def test_framing_is_delegated_to_the_ingress(self):
        self.assertIn("$config['x_frame_options'] = false;", self.config)

    def test_secure_host_only_session_cookie_behind_the_proxy(self):
        self.assertIn("$config['use_https'] = true;", self.config)
        self.assertIn("$config['proxy_whitelist']", self.config)
        self.assertIn("OWNER_WEBMAIL_COOKIE_SAMESITE", self.config)

    def test_sieve_client_is_not_enabled(self):
        self.assertNotIn("'managesieve'", self.config)

    def test_no_credential_literal(self):
        self.assertNotIn("OWNER_WEBMAIL_IMAP_PASSWORD'] =", self.config)
        self.assertNotIn("password' ]", self.config)
        self.assertIsNone(re.search(r"\$config\['smtp_pass'\]\s*=\s*'[^%]", self.config))


class PluginContractTests(unittest.TestCase):
    def setUp(self):
        self.plugin = (ROOT / "roundcube" / "plugins" / "frank_sso" / "frank_sso.php").read_text(encoding="utf-8")

    def test_uses_documented_roundcube_hooks_only(self):
        for hook in ("startup", "authenticate", "login_after", "logout_after"):
            self.assertIn("add_hook('%s'" % hook, self.plugin)
        self.assertIn("class frank_sso extends rcube_plugin", self.plugin)

    def test_launch_token_travels_in_a_cookie_not_a_url(self):
        self.assertIn("$_COOKIE[self::LAUNCH_COOKIE]", self.plugin)
        self.assertNotIn("$_GET", self.plugin)
        self.assertNotIn("$_REQUEST", self.plugin)

    def test_login_is_only_forced_after_a_successful_redemption(self):
        startup = self.plugin[self.plugin.index("public function startup"):self.plugin.index("public function authenticate")]
        self.assertIn("$this->redeem()", startup)
        self.assertIn("if ($this->redemption !== null)", startup)
        authenticate = self.plugin[self.plugin.index("public function authenticate"):self.plugin.index("public function login_after")]
        self.assertIn("if ($this->redemption === null)", authenticate)
        self.assertIn("$args['valid'] = true;", authenticate)
        self.assertIn("$args['cookiecheck'] = false;", authenticate)

    def test_mailbox_credential_comes_from_the_environment(self):
        self.assertIn("getenv($name)", self.plugin)
        self.assertIn("OWNER_WEBMAIL_IMAP_PASSWORD", self.plugin)
        self.assertNotIn("error_log($imap_pass", self.plugin)

    def test_token_is_cleared_and_not_logged(self):
        self.assertIn("clear_launch_cookie", self.plugin)
        login_after = self.plugin[self.plugin.index("public function login_after"):self.plugin.index("public function logout_after")]
        self.assertIn("$this->clear_launch_cookie();", login_after)
        # Every diagnostic carries a fixed label. A token, a password or a shared
        # secret must never be interpolated into a log or error message.
        for message in re.findall(r"\$this->fail\((.*?)\);", self.plugin):
            self.assertNotIn("$token", message)
            self.assertNotIn("$imap_pass", message)
            self.assertNotIn("$secret", message)
        self.assertNotIn("error_log(", self.plugin)

    def test_identities_use_roundcubes_own_api(self):
        self.assertIn("$user->insert_identity(", self.plugin)
        self.assertIn("$user->list_identities()", self.plugin)
        # rcube_plugin exposes no $this->rcmail property; using it silently
        # disabled identity reconciliation once already.
        self.assertNotIn("$this->rcmail", self.plugin)
        self.assertIn("rcmail::get_instance()->user", self.plugin)


class IngressContractTests(unittest.TestCase):
    def setUp(self):
        self.nginx = (ROOT / "ingress" / "default.conf.template").read_text(encoding="utf-8")

    def test_launch_route_is_exact_match_only(self):
        self.assertIn("location = /frank/launch {", self.nginx)
        self.assertNotIn("location /frank/ {", self.nginx)

    def test_ingress_proof_header_is_set_by_the_ingress(self):
        self.assertIn('proxy_set_header X-Owner-Webmail-Ingress "${OWNER_WEBMAIL_INGRESS_SECRET}";', self.nginx)

    def test_client_cannot_impose_a_framing_or_host_policy(self):
        self.assertIn("proxy_hide_header X-Frame-Options;", self.nginx)
        # 'self' must stay: the client frames its own message list and body.
        self.assertIn("frame-ancestors 'self' ${OWNER_WEBMAIL_FRAME_ANCESTORS}", self.nginx)

    def test_only_owner_variables_are_substituted(self):
        compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn("NGINX_ENVSUBST_FILTER: ^OWNER_WEBMAIL_", compose)


class LaunchStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = launch_server.LaunchStore(str(Path(self.directory.name) / "launch.db"))

    def tearDown(self):
        self.directory.cleanup()

    def test_a_token_is_redeemed_exactly_once(self):
        token = self.store.issue("owner@blockwise.sale", 120)
        self.assertEqual(self.store.consume(token), "owner@blockwise.sale")
        self.assertIsNone(self.store.consume(token))

    def test_an_expired_token_is_not_redeemable(self):
        token = self.store.issue("owner@blockwise.sale", -1)
        self.assertIsNone(self.store.consume(token))

    def test_unknown_and_malformed_tokens_are_not_redeemable(self):
        self.assertIsNone(self.store.consume("not-a-token"))
        self.assertIsNone(self.store.consume(""))
        self.assertIsNone(self.store.consume("x" * 500))

    def test_expired_tokens_are_pruned_on_the_next_issue(self):
        self.store.issue("owner@blockwise.sale", -1)
        self.store.issue("owner@blockwise.sale", 120)
        self.assertEqual(self.store.pending(), 1)

    def test_tokens_are_unique_and_unpredictable(self):
        tokens = {self.store.issue("owner@blockwise.sale", 120) for _ in range(32)}
        self.assertEqual(len(tokens), 32)
        self.assertTrue(all(len(token) >= 40 for token in tokens))


class LaunchSettingsTests(unittest.TestCase):
    def test_missing_secrets_stop_the_broker(self):
        settings = launch_server.Settings({})
        self.assertEqual(
            settings.missing_required(),
            [
                "OWNER_WEBMAIL_INGRESS_SECRET",
                "OWNER_WEBMAIL_CONSUME_SECRET",
                "OWNER_WEBMAIL_OWNER_ID",
            ],
        )

    def test_short_secrets_are_rejected(self):
        settings = launch_server.Settings({
            "OWNER_WEBMAIL_INGRESS_SECRET": "short",
            "OWNER_WEBMAIL_CONSUME_SECRET": "x" * 64,
            "OWNER_WEBMAIL_OWNER_ID": "*",
        })
        self.assertEqual(settings.missing_required(), ["OWNER_WEBMAIL_INGRESS_SECRET"])

    def test_defaults_are_a_short_lived_lax_session(self):
        settings = launch_server.Settings({
            "OWNER_WEBMAIL_INGRESS_SECRET": "x" * 64,
            "OWNER_WEBMAIL_CONSUME_SECRET": "y" * 64,
            "OWNER_WEBMAIL_OWNER_ID": "*",
        })
        self.assertEqual(settings.missing_required(), [])
        self.assertEqual(settings.ttl_seconds, 120)
        self.assertEqual(settings.cookie_samesite, "Lax")
        self.assertEqual(settings.landing_path, "/")


class SecretHygieneTests(unittest.TestCase):
    def test_the_example_file_holds_no_values(self):
        example = (ROOT / ".env.example").read_text(encoding="utf-8")
        secret_keys = [
            "OWNER_WEBMAIL_IMAP_PASSWORD",
            "OWNER_WEBMAIL_DES_KEY",
            "OWNER_WEBMAIL_INGRESS_SECRET",
            "OWNER_WEBMAIL_CONSUME_SECRET",
        ]
        for key in secret_keys:
            self.assertIn("%s=\n" % key, example)

    def test_no_component_file_embeds_a_credential_value(self):
        for path in ROOT.rglob("*"):
            if not path.is_file() or ".git" in path.parts or "tests" in path.parts:
                continue
            if path.suffix not in {".php", ".py", ".sh", ".yaml", ".yml", ".md", ".template"}:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            self.assertNotIn("PURELYMAIL_PASSWORD=", text, path)
            self.assertNotIn("MAUTIC_DB_PASSWORD=", text, path)

    def test_secret_provisioning_never_prints_a_value(self):
        script = (ROOT / "bin" / "provision-secret.sh").read_text(encoding="utf-8")
        self.assertIn("chmod 600", script)
        self.assertIn("chown root:root", script)
        for line in script.splitlines():
            if "printf" in line and ("mail_pass" in line or "SECRET" in line):
                continue
            self.assertNotIn("echo \"$mail_pass", line)
        self.assertIn("no value was printed", script)


if __name__ == "__main__":
    unittest.main()
