import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import server


class AdStudioMonitorTest(unittest.TestCase):
    def test_run_projection_has_durable_source_url_and_replayed_receipt(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun-example",
            "status": "completed",
            "stage": "live",
            "payload": {"sources": [{
                "name": "source-house.PNG", "size": 42,
                "media_type": "image/png", "origin": "device",
            }]},
            "output": {"import": {"template_id": "template-1", "status": "replayed"}},
        })
        self.assertEqual(
            projected["source"]["url"],
            "/api/ad-studio/runs/trun-example/artifacts/source.png",
        )
        self.assertEqual(projected["output"]["import"]["status"], "replayed")
        self.assertEqual(projected["output"]["import"]["template_id"], "template-1")
        self.assertEqual(
            projected["output"]["import"]["template_url"],
            "https://blockwise.sale/ad-studio/templates/template-1",
        )

    def test_import_projection_rejects_unsafe_or_mismatched_destinations(self):
        unsafe = server._public_ad_studio_import({
            "status": "imported",
            "template_id": "../admin",
            "template_url": "https://evil.example/ad-studio/templates/template-1",
            "internal_receipt": {"secret": "never public"},
        })
        self.assertEqual(unsafe, {"status": "imported"})

        mismatched = server._public_ad_studio_import({
            "status": "ready",
            "template_id": "template-1",
            "template_url": "https://blockwise.sale/ad-studio/templates/template-2",
        })
        self.assertEqual(mismatched, {"status": "ready"})

    def test_run_projection_exposes_frozen_models_and_truthful_usage_source(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun-model-profile",
            "model_policy_revision": 35,
            "model_policy": {
                "name": "private policy detail must not leak",
                "stages": {
                    "analyse": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-sol", "secret": "never"}},
                    "compare": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-luna"}},
                    "quality-escalation": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-sol"}},
                    "final-review-a": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-luna"}},
                    "final-review-b": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-sol"}},
                },
            },
            "output": {"usage": {"total_tokens": 1234, "estimated_cost_usd": 0.125}, "cost": {}},
        })

        self.assertEqual(projected["model_profile"]["source"], "Hermes frozen run policy")
        self.assertEqual(projected["model_profile"]["revision"], 35)
        self.assertEqual(
            [(role["role"], role["provider"], role["model"]) for role in projected["model_profile"]["roles"]],
            [
                ("builder", "openai-codex", "gpt-5.6-sol"),
                ("comparator", "openai-codex", "gpt-5.6-luna"),
                ("quality-escalation", "openai-codex", "gpt-5.6-sol"),
                ("final-review-a", "openai-codex", "gpt-5.6-luna"),
                ("final-review-b", "openai-codex", "gpt-5.6-sol"),
            ],
        )
        self.assertNotIn("secret", json.dumps(projected))
        self.assertNotIn("private policy detail", json.dumps(projected))
        self.assertEqual(projected["usage"]["source"], "Hermes run ledger")
        self.assertEqual(projected["usage"]["status"], "reported")
        self.assertEqual(projected["usage"]["billing"], "ChatGPT/Codex OAuth — not OpenAI API dashboard")
        self.assertEqual(projected["usage"]["total_tokens"], 1234)
        self.assertEqual(projected["usage"]["estimated_cost_usd"], 0.125)

    def test_missing_usage_is_reported_as_missing_not_zero(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun-no-usage",
            "model_policy": {"stages": {"compare": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-luna"}}}},
            "output": {},
        })

        self.assertEqual(projected["usage"]["status"], "not_reported")
        self.assertNotIn("total_tokens", projected["usage"])
        self.assertIsNone(projected["cost"])

    def test_archify_receipt_is_bound_to_spec_artifact_and_validator(self):
        previous = (
            server.ARCHIFY_ARTIFACT, server.ARCHIFY_SPEC,
            server.ARCHIFY_CLI, server.ARCHIFY_RECEIPT,
        )
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                files = {
                    "artifactSha256": root / "diagram.html",
                    "specSha256": root / "diagram.json",
                    "validatorSha256": root / "archify.mjs",
                }
                for index, path in enumerate(files.values(), 1):
                    path.write_bytes(f"file-{index}".encode("ascii"))
                receipt = root / "validation-receipt.json"
                receipt.write_text(json.dumps({
                    "schema": "frank.archify-build-validation.v1",
                    "validated": True,
                    **{key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in files.items()},
                }), encoding="utf-8")
                server.ARCHIFY_ARTIFACT = files["artifactSha256"]
                server.ARCHIFY_SPEC = files["specSha256"]
                server.ARCHIFY_CLI = files["validatorSha256"]
                server.ARCHIFY_RECEIPT = receipt
                self.assertTrue(server._archify_build_validated())
                server.ARCHIFY_ARTIFACT.write_bytes(b"changed")
                self.assertFalse(server._archify_build_validated())
        finally:
            (
                server.ARCHIFY_ARTIFACT, server.ARCHIFY_SPEC,
                server.ARCHIFY_CLI, server.ARCHIFY_RECEIPT,
            ) = previous

    def test_agenttrail_is_explicitly_unavailable_when_not_configured(self):
        previous = server.AGENTTRAIL_URL
        try:
            server.AGENTTRAIL_URL = ""
            response = server.app.test_client().get("/api/ad-studio/implementation-activity")
            self.assertEqual(response.status_code, 503)
            self.assertFalse(response.get_json()["available"])
            self.assertIn("not configured", response.get_json()["message"])
        finally:
            server.AGENTTRAIL_URL = previous


if __name__ == "__main__":
    unittest.main()
