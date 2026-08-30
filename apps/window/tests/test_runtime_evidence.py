import unittest
from datetime import datetime, timezone

from runtime_evidence import BeszelProvider, RuntimeEvidenceAdapter, RuntimeEvidenceError, normalize_observation


class Provider:
    name = "beszel"

    def __init__(self, value):
        self.value = value

    def observe(self, system_id):
        return self.value


class RuntimeEvidenceTests(unittest.TestCase):
    NOW = datetime(2026, 8, 30, tzinfo=timezone.utc)

    def test_success_is_compact_and_redacts_secret_like_text(self):
        result = normalize_observation("frank", {
            "authority": "monitoring", "health": "healthy", "freshness": "fresh",
            "deployed_revision": "abc123", "route": "https://monitoring.internal/frank",
            "errors": 0, "error_summary": "none token=do-not-leak",
            "evidence_url": "https://monitoring.internal/frank-evidence",
            "evidence_receipt_id": "receipt:release/frank-1",
            "raw_log_body": "must not appear",
        }, provider="beszel", now=self.NOW)
        payload = result.to_dict()
        self.assertEqual(payload["health"], "healthy")
        self.assertNotIn("raw_log_body", payload)
        self.assertIn("[REDACTED]", payload["error_summary"])
        self.assertEqual(payload["evidence_url"], "https://monitoring.internal/frank-evidence")

    def test_stale_deadline_and_bad_link_are_honest(self):
        result = normalize_observation("blockwise", {
            "health": "healthy", "fresh_until": "2026-08-29T00:00:00Z",
            "evidence_url": "https://evil.example/logs?token=secret",
        }, now=self.NOW)
        self.assertEqual(result.freshness, "stale")
        self.assertIsNone(result.evidence_url)

    def test_expired_deadline_overrides_contradictory_fresh_label(self):
        result = normalize_observation("frank", {
            "freshness": "fresh", "fresh_until": "2026-08-29T00:00:00Z",
        }, now=self.NOW)
        self.assertEqual(result.freshness, "stale")

    def test_foreign_authority_is_rejected(self):
        with self.assertRaises(RuntimeEvidenceError):
            normalize_observation("frank", {"authority": "agenttrail", "health": "healthy"})

    def test_foreign_provider_is_rejected_even_without_authority_field(self):
        with self.assertRaises(RuntimeEvidenceError):
            normalize_observation("frank", {"health": "healthy"}, provider="agenttrail")

    def test_json_secret_shapes_are_redacted(self):
        result = normalize_observation("frank", {
            "error_summary": '{"token":"do-not-leak", "message":"failed"}',
        })
        self.assertNotIn("do-not-leak", result.error_summary)
        self.assertIn("[REDACTED]", result.error_summary)

    def test_provider_error_becomes_unavailable(self):
        class Broken:
            name = "beszel"
            def observe(self, system_id):
                raise OSError("network")
        result = RuntimeEvidenceAdapter(Broken()).summary("frank")
        self.assertEqual(result.health, "unavailable")
        self.assertEqual(result.freshness, "unavailable")
        self.assertIsNone(result.error_summary)

    def test_release_mismatch_degrades_health(self):
        result = RuntimeEvidenceAdapter(Provider({
            "health": "healthy", "freshness": "fresh", "deployed_revision": "old",
        }), release_revisions={"blockwise": "new"}).summary("blockwise")
        self.assertEqual(result.health, "degraded")
        self.assertIn("release receipt", result.reason)

    def test_missing_deployed_revision_does_not_pass_release_check(self):
        result = RuntimeEvidenceAdapter(Provider({
            "health": "healthy", "freshness": "fresh",
        }), release_revisions={"frank": "expected"}).summary("frank")
        self.assertEqual(result.health, "degraded")
        self.assertIsNone(result.deployed_revision)

    def test_provider_rejects_path_injection_before_fetch(self):
        calls = []
        provider = BeszelProvider("http://beszel:8090", lambda url: calls.append(url) or {})
        with self.assertRaises(RuntimeEvidenceError):
            provider.observe("frank/../../etc/passwd")
        self.assertEqual(calls, [])

    def test_only_supported_systems_are_exposed(self):
        with self.assertRaises(RuntimeEvidenceError):
            RuntimeEvidenceAdapter(Provider({})).summary("hermes")

    def test_beszel_transport_and_authenticated_deep_link_seam(self):
        calls = []
        provider = BeszelProvider("http://beszel:8090", lambda url: calls.append(url) or {"health": "healthy"})
        adapter = RuntimeEvidenceAdapter(provider, evidence_base_url="http://beszel:8090")
        result = adapter.summary("frank")
        self.assertEqual(calls, ["http://beszel:8090/api/runtime/frank"])
        self.assertEqual(result.evidence_url, "http://beszel:8090/systems/frank")
        self.assertEqual(adapter.deep_link("blockwise"), "http://beszel:8090/systems/blockwise")


if __name__ == "__main__":
    unittest.main()
