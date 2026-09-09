import unittest

from hermes_adapter.http import ENDPOINTS, RestError, RestSurface, resolve_path


class ResolvePathTest(unittest.TestCase):
    def test_substitutes_valid_ids(self):
        self.assertEqual(resolve_path("/v1/runs/{run_id}", run_id="run_abc123"), "/v1/runs/run_abc123")

    def test_refuses_missing_unsafe_or_unresolved(self):
        with self.assertRaises(RestError):
            resolve_path("/v1/runs/{run_id}")
        with self.assertRaises(RestError):
            resolve_path("/v1/runs/{run_id}", run_id="../../etc")
        with self.assertRaises(RestError):
            resolve_path("/v1/runs/{run_id}/{extra}", run_id="ok")


class RestSurfaceTest(unittest.TestCase):
    def test_only_contracted_surfaces_and_loopback_bases(self):
        with self.assertRaises(ValueError):
            RestSurface("other", "http://127.0.0.1:1", lambda: {})
        with self.assertRaises(ValueError):
            RestSurface("gateway", "http://example.internal", lambda: {})

    def test_request_rejects_non_allowlisted_endpoints(self):
        surface = RestSurface("gateway", "http://127.0.0.1:18643", lambda: {"Authorization": "Bearer x"})
        with self.assertRaises(RestError) as caught:
            surface.request("GET", "/v1/unknown")
        self.assertEqual(caught.exception.frank_code, "hermes.forbidden_endpoint")
        with self.assertRaises(RestError):
            surface.request("DELETE", "/v1/runs/{run_id}", path={"run_id": "r1"})

    def test_request_sends_auth_and_parses_json(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["headers"] = dict(request.header_items())
            captured["url"] = request.full_url

            class Response:
                status = 200

                def read(self, n):
                    return b'{"ok": true}'

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return False

            return Response()

        surface = RestSurface(
            "gateway", "http://127.0.0.1:18643", lambda: {"Authorization": "Bearer secret"}, urlopen=fake_urlopen,
        )
        status, payload = surface.request("GET", "/v1/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"ok": True})
        header_blob = str(captured["headers"]).lower()
        self.assertIn("bearer secret", header_blob)

    def test_error_mapping_and_redaction(self):
        import urllib.error

        def failing_urlopen(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 502, "upstream broke", {}, None)

        surface = RestSurface("gateway", "http://127.0.0.1:18643", lambda: {}, urlopen=failing_urlopen)
        with self.assertRaises(RestError) as caught:
            surface.request("GET", "/v1/health")
        self.assertEqual(caught.exception.frank_code, "hermes.http_status")
        self.assertEqual(caught.exception.status, 502)

    def test_gateway_and_serve_endpoints_are_disjoint_sets(self):
        gateway = {path for name, _method, path in ENDPOINTS if name == "gateway"}
        serve = {path for name, _method, path in ENDPOINTS if name == "serve"}
        self.assertFalse(gateway & serve)
        self.assertIn("/api/audio/transcribe", serve)
        self.assertIn("/v1/runs", gateway)


if __name__ == "__main__":
    unittest.main()
