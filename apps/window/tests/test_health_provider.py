import unittest, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_evidence import HealthProvider, RuntimeEvidenceError, RuntimeEvidenceAdapter

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
