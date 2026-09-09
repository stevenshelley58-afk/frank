import io
import json
import os
import subprocess
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from flask import Flask

import mini_operator


class Response:
    status = 200

    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class MiniOperatorProxyTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(mini_operator.create_blueprint())
        self.client = self.app.test_client()
        self.env = mock.patch.dict(os.environ, {
            "FRANK_BASIC_AUTH_HASH": "operator-hash",
            "MINI_PARTNER_URL": "http://mini-frank:9130",
            "MINI_PARTNER_TOKEN": "server-secret",
        }, clear=False)
        self.env.start()
        self.headers = {"X-Frank-Operator-Attestation": "operator-hash"}

    def tearDown(self):
        self.env.stop()

    def test_operator_auth_is_required_and_browser_never_supplies_partner_token(self):
        self.assertEqual(self.client.get("/api/operator/mini/service-requests").status_code, 401)
        with mock.patch("mini_operator.urllib.request.urlopen", return_value=Response({"requests": []})) as opener:
            response = self.client.get("/api/operator/mini/service-requests", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        upstream = opener.call_args.args[0]
        self.assertEqual(upstream.get_header("Authorization"), "Bearer server-secret")
        self.assertNotIn("server-secret", response.get_data(as_text=True))

    def test_patch_dispatches_status_and_preserves_upstream_http_error(self):
        error = urllib.error.HTTPError(
            "http://mini-frank:9130", 409, "Conflict", {},
            io.BytesIO(b'{"error":"already closed"}'),
        )
        with mock.patch("mini_operator.urllib.request.urlopen", side_effect=error) as opener:
            response = self.client.patch(
                "/api/operator/mini/service-requests/svc_123",
                headers=self.headers,
                json={"status": "contacted"},
            )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json(), {"error": "already closed"})
        upstream = opener.call_args.args[0]
        self.assertEqual(upstream.method, "PATCH")
        self.assertEqual(json.loads(upstream.data), {"status": "contacted"})

    def test_patch_timeout_reports_unknown_outcome(self):
        with mock.patch(
            "mini_operator.urllib.request.urlopen",
            side_effect=urllib.error.URLError(TimeoutError()),
        ):
            response = self.client.patch(
                "/api/operator/mini/service-requests/svc_123",
                headers=self.headers,
                json={"status": "closed"},
            )
        self.assertEqual(response.status_code, 504)
        self.assertIn("may have been applied", response.get_data(as_text=True))
        self.assertIn("refresh before retrying", response.get_data(as_text=True))

    def test_loopback_upstream_is_rejected_as_unreachable_from_container(self):
        os.environ["MINI_PARTNER_URL"] = "http://127.0.0.1:9130"
        response = self.client.get("/api/operator/mini/service-requests", headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertIn("not reachable", response.get_data(as_text=True))

    def test_deep_link_targets_real_frank_project_panel(self):
        response = self.client.get("/frank/mini-service-requests", headers=self.headers)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            response.headers["Location"],
            "/?project=mini-frank&panel=mini-service-requests",
        )


class MiniOperatorRuntimeDispatchTest(unittest.TestCase):
    def _routes(self, peer_mode):
        root = Path(__file__).resolve().parents[1]
        script = """
import json, server
print(json.dumps(sorted((r.rule, r.endpoint, sorted(r.methods)) for r in server.app.url_map.iter_rules() if 'operator/mini' in r.rule)))
"""
        paths = [
            "/tmp/frank-mini-operator-test",
            "/tmp/frank-mini-operator-preview",
            "/tmp/frank-mini-operator-legacy",
        ]
        for path in paths:
            Path(path).mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(path, 0o700)
        env = {
            **os.environ,
            "MINI_PEER_MODE": peer_mode,
            "CHAT_STORE_DIR": paths[0],
            "MINI_PREVIEW_ROOT": paths[1],
            "MINI_LEGACY_PROJECT_ROOT": paths[2],
        }
        result = subprocess.run(
            [sys.executable, "-c", script], cwd=root, env=env,
            check=True, text=True, capture_output=True,
        )
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_peer_mode_installs_only_proxy_rules(self):
        routes = self._routes("1")
        self.assertEqual(
            [route[1] for route in routes],
            ["mini_operator_proxy.service_requests", "mini_operator_proxy.update_service_request"],
        )

    def test_default_preserves_embedded_mini_route(self):
        routes = self._routes("0")
        self.assertEqual(len(routes), 2)
        self.assertTrue(all(route[1].startswith("mini_frank.") for route in routes))


if __name__ == "__main__":
    unittest.main()
