import unittest, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_evidence import HealthProvider, RuntimeEvidenceError, RuntimeEvidenceAdapter
from control_plane_view import _fetch_runtime

class FakeResponse:
    def __init__(self, body, *, status=200, url="http://127.0.0.1/health", content_type="application/json"):
        self.body = body; self.status = status; self._url = url
        self.headers = {"Content-Type": content_type}
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def geturl(self): return self._url
    def read(self, limit=-1): return self.body if limit < 0 else self.body[:limit]

class HealthProviderTests(unittest.TestCase):
    def endpoints(self): return {"frank":"https://monitoring.internal/frank", "blockwise":"http://127.0.0.1:8081/health"}
    def test_requires_exact_internal_endpoints(self):
        with self.assertRaises(RuntimeEvidenceError): HealthProvider({"frank":"http://localhost"}, lambda u: {})
        with self.assertRaises(RuntimeEvidenceError): HealthProvider({**self.endpoints(), "other":"http://localhost"}, lambda u: {})
        for url in ("https://example.com", "https://user:pass@localhost", "http://localhost/?token=secret", "http://localhost/#x"):
            with self.assertRaises(RuntimeEvidenceError): HealthProvider({"frank":url,"blockwise":"http://localhost:2"}, lambda u: {})
    def test_health_revision_and_evidence_link(self):
        p=HealthProvider(self.endpoints(), lambda u: {"health":"healthy","revision":"abc","password":"secret"})
        s=RuntimeEvidenceAdapter(p, release_revisions={"frank":"expected"}, evidence_base_url="https://monitoring.internal").summary("frank")
        self.assertEqual(s.health,"degraded"); self.assertIn("revision",s.reason); self.assertEqual(s.evidence_url,self.endpoints()["frank"]); self.assertNotIn("secret",str(s))
    def test_transport_failure_is_unavailable(self):
        p=HealthProvider(self.endpoints(), lambda u: (_ for _ in ()).throw(TimeoutError()))
        s=RuntimeEvidenceAdapter(p).summary("blockwise")
        self.assertEqual((s.health,s.freshness),("unavailable","unavailable"))

    def test_health_rejects_invalid_signal(self):
        p = HealthProvider(self.endpoints(), lambda u: {"health": "maybe"})
        with self.assertRaises(RuntimeEvidenceError): p.observe("frank")

    def test_blockwise_verified_status_shape_normalizes_and_binds_revision(self):
        p = HealthProvider(self.endpoints(), lambda u: {"app": "blockwise", "status": "ready"}, {"blockwise": "c" * 40})
        observed = p.observe("blockwise")
        self.assertEqual(observed["health"], "healthy")
        self.assertEqual(observed["deployed_revision"], "c" * 40)
        summary = RuntimeEvidenceAdapter(p).summary("blockwise")
        self.assertEqual(summary.health, "healthy")

    def test_blockwise_status_requires_verified_shape_and_value(self):
        for body in ({"status": "ready"}, {"app": "blockwise"}, {"app": "other", "status": "ready"}, {"app": "blockwise", "status": "running"}, {"app": "blockwise", "status": 200}):
            with self.subTest(body=body):
                with self.assertRaises(RuntimeEvidenceError):
                    HealthProvider(self.endpoints(), lambda u, body=body: body).observe("blockwise")
        p = HealthProvider(self.endpoints(), lambda u: {"message": "ok"})
        with self.assertRaises(RuntimeEvidenceError): p.observe("frank")

    def test_fetch_boundary_rejects_redirect_non_json_non_200_and_oversize(self):
        import urllib.request
        cases = [
            FakeResponse(b'{"ok":true}', url="http://127.0.0.1/other"),
            FakeResponse(b'{"ok":true}', status=503),
            FakeResponse(b'{"ok":true}', content_type="text/html"),
            FakeResponse(b'{' + b'"x":' + b'"a"' * (256 * 1024)),
        ]
        original = urllib.request.urlopen
        try:
            for response in cases:
                urllib.request.urlopen = lambda *a, response=response, **k: response
                with self.assertRaises(OSError): _fetch_runtime("http://127.0.0.1/health")
        finally:
            urllib.request.urlopen = original

    def test_fetch_boundary_accepts_json_with_trailing_whitespace_only(self):
        import urllib.request
        original = urllib.request.urlopen
        try:
            urllib.request.urlopen = lambda *a, **k: FakeResponse(b'{"ok":true}\n  ')
            self.assertEqual(_fetch_runtime("http://127.0.0.1/health"), {"ok": True})
        finally:
            urllib.request.urlopen = original
