from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "window"


class InfraContractTest(unittest.TestCase):
    def test_window_image_copies_all_imported_runtime_modules(self):
        dockerfile = (APP / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("COPY connections_agent.py .", dockerfile)
        self.assertIn('"import connections_agent, home_platform, server;', (APP / "deploy.sh").read_text(encoding="utf-8"))

    def test_caddy_receives_only_derived_basic_auth_env(self):
        compose = (APP / "docker-compose.yml").read_text(encoding="utf-8")
        caddy = compose.split("  frank-caddy:", 1)[1].split("\n  volumes:", 1)[0]
        self.assertIn("FRANK_CADDY_ENV_FILE", caddy)
        self.assertNotIn("FRANK_WINDOW_ENV_FILE", caddy)
        self.assertNotIn("HERMES_CONNECTIONS_AGENT_KEY", caddy)
        self.assertNotIn("HERMES_VAULT_BROKER_KEY", caddy)
        self.assertNotIn("HERMES_API_KEY", caddy)
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("header_up -X-Frank-Operator-Attestation", caddyfile)
        self.assertIn("header_up X-Frank-Operator-Attestation {$FRANK_BASIC_AUTH_HASH}", caddyfile)
        self.assertIn("request>headers>X-Frank-Operator-Attestation delete", caddyfile)

    def test_release_runbook_orders_private_dependencies_before_frank(self):
        runbook = (ROOT / "docs" / "FRANK_RELEASE_RUNBOOK.md").read_text(encoding="utf-8")
        order = [
            "Validate `/srv/frank/secrets/window.env`",
            "Seed the Frank keys",
            "Start and private-canary Infisical",
            "Bootstrap Hermes config and credentials",
            "Deploy and canary the Hermes Connections Agent",
            "Verify the private ports `18082` and `18080`",
            "Deploy Frank",
        ]
        positions = [runbook.index(item) for item in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("rollback", runbook.lower())
        self.assertIn("chat data", runbook.lower())
        self.assertIn("non-symlink", runbook)

    def test_deploy_keeps_unconfigured_hermes_extensions_fail_closed(self):
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        required = deploy.split("# Validate the core Window boundary", 1)[1].split("done", 1)[0]
        self.assertIn("HERMES_API_KEY FRANK_BASIC_AUTH_USER FRANK_BASIC_AUTH_HASH", required)
        self.assertNotIn("HERMES_CONNECTIONS_AGENT_KEY", required)
        self.assertNotIn("HERMES_VAULT_BROKER_KEY", required)
        self.assertIn("Connections Agent ingress is not configured", deploy)
        self.assertIn("vault/provider status remains setup_needed", deploy)
        self.assertIn("never invent a key or broker URL", deploy)
