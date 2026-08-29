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
