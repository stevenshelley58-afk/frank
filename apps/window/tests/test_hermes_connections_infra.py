import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


APP = Path(__file__).resolve().parents[1]
INFRA = APP / "infra" / "hermes_connections"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


broker = load_module("hermes_connections_broker", INFRA / "broker.py")
plugin = load_module("hermes_connections_plugin", INFRA / "plugin" / "__init__.py")


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = json.dumps(payload).encode("utf-8")
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, limit=-1):
        return self.payload[:limit] if limit >= 0 else self.payload


class HermesConnectionsInfraTests(unittest.TestCase):
    def settings(self):
        return {
            "infisical_url": "http://127.0.0.1:18082",
            "project_id": "project-1",
            "environment": "production",
            "secret_path": "/hermes",
        }

    def test_broker_logs_in_scopes_requests_and_strips_secret_values(self):
        requests = []

        def opener(request, timeout):
            self.assertEqual(timeout, 10)
            requests.append(request)
            if request.full_url.endswith("/api/v1/auth/universal-auth/login"):
                return FakeResponse({"accessToken": "access-token", "expiresIn": 3600})
            if request.method == "GET":
                return FakeResponse({"secrets": [{
                    "id": "secret-1", "secretKey": "RESEND_API_KEY",
                    "secretValue": "must-not-cross", "version": 1,
                }]})
            return FakeResponse({"secret": {
                "id": "secret-1", "secretKey": "RESEND_API_KEY",
                "secretValue": "must-not-cross", "version": 2,
            }})

        with mock.patch.dict(os.environ, {
            "HERMES_CONNECTIONS_INFISICAL_CLIENT_ID": "client-id",
            "HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET": "client-secret",
        }, clear=False):
            client = broker.InfisicalClient(self.settings(), opener=opener)
            listed = client.list_metadata({
                "project_id": "project-1", "environment": "production", "secret_path": "/hermes",
            })
            created = client.create({
                "project_id": "project-1", "environment": "production", "secret_path": "/hermes",
                "secret_name": "RESEND_API_KEY", "secret_value": "input-secret",
            })

        self.assertNotIn("must-not-cross", json.dumps([listed, created]))
        self.assertEqual(created["secret"]["version"], 2)
        list_query = next(request.full_url for request in requests if request.method == "GET")
        self.assertIn("viewSecretValue=false", list_query)
        self.assertIn("expandSecretReferences=false", list_query)

    def test_broker_rejects_any_location_outside_fixed_scope(self):
        with mock.patch.dict(os.environ, {
            "HERMES_CONNECTIONS_INFISICAL_CLIENT_ID": "client-id",
            "HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET": "client-secret",
        }, clear=False):
            client = broker.InfisicalClient(self.settings(), opener=lambda *_args, **_kwargs: None)
        with self.assertRaises(broker.BrokerError) as raised:
            client.create({
                "project_id": "another-project", "environment": "production", "secret_path": "/hermes",
                "secret_name": "RESEND_API_KEY", "secret_value": "input-secret",
            })
        self.assertEqual(raised.exception.code, "scope_denied")

    def test_config_and_plugin_require_exact_loopback_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.yaml"
            config.write_text(
                "plugins:\n  entries:\n    connections-agent:\n      settings:\n"
                "        enabled: true\n        frank_url: http://127.0.0.1:18080\n"
                "        infisical_url: http://127.0.0.1:18082\n"
                "        infisical_project_id: project-1\n"
                "        infisical_environment: production\n        secret_path: /hermes\n",
                encoding="utf-8",
            )
            self.assertEqual(broker.load_settings(config)["project_id"], "project-1")
            with mock.patch.dict(os.environ, {
                "HERMES_CONFIG_FILE": str(config),
                "HERMES_CONNECTIONS_AGENT_KEY": "agent-key-123456",
            }, clear=False):
                self.assertEqual(plugin._settings(), ("http://127.0.0.1:18080", "agent-key-123456"))
            config.write_text(config.read_text(encoding="utf-8").replace("127.0.0.1:18082", "0.0.0.0:18082"), encoding="utf-8")
            with self.assertRaises(broker.BrokerError):
                broker.load_settings(config)

    def test_deploy_bundle_never_places_infisical_identity_in_frank(self):
        deploy = (INFRA / "deploy.sh").read_text(encoding="utf-8")
        unit = (INFRA / "hermes-frank-vault-broker.service").read_text(encoding="utf-8")
        self.assertIn("HERMES_CONNECTIONS_AGENT_KEY", deploy)
        self.assertIn("HERMES_VAULT_BROKER_KEY", deploy)
        self.assertNotIn("HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET=%s", deploy)
        self.assertIn("User=hermes", unit)
        source = (INFRA / "broker.py").read_text(encoding="utf-8")
        self.assertIn("127.0.0.1:18082", source)
        self.assertIn("172.16.1.1", source)


if __name__ == "__main__":
    unittest.main()
