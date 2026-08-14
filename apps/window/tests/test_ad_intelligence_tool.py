import json
import importlib.util
import sys
import unittest
from dataclasses import replace
from pathlib import Path

PACKAGE_DIR = Path(__file__).parents[1] / "tools" / "ad-intelligence"
PACKAGE_SPEC = importlib.util.spec_from_file_location("ad_intelligence", PACKAGE_DIR / "__init__.py", submodule_search_locations=[str(PACKAGE_DIR)])
PACKAGE = importlib.util.module_from_spec(PACKAGE_SPEC)
sys.modules["ad_intelligence"] = PACKAGE
PACKAGE_SPEC.loader.exec_module(PACKAGE)

from ad_intelligence.core import (
    AdIntelligenceManifest, PublicClassification, PublicCopy, PublicCreative,
    PublicMedia, build_release, export_public,
)
from ad_intelligence.pipeline import PipelineRun, StageFailure
from ad_intelligence.protocol import ALLOWED_ACTIONS, ALLOWED_EVENTS, validate_action, validate_event_name


class AdIntelligenceToolTest(unittest.TestCase):
    RELEASE_EVIDENCE = {
        "provenance_refs": ("source://a-1",),
        "trace_refs": ("trace://run-1",),
        "settings_refs": ("settings://ad-radar/v1",),
        "qa_receipt_ref": "receipt://qa/run-1",
        "sanitization_receipt_refs": ("receipt://pii/run-1", "receipt://secret/run-1"),
    }

    def test_home_manifest_is_declarative_and_exactly_scoped(self):
        path = Path(__file__).parents[1] / "tools" / "ad-intelligence" / "home.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(set(manifest), {"id", "name", "kind", "blurb", "capabilities", "default_widget_ids", "connection_capabilities"})
        self.assertEqual(manifest["kind"], "tool")
        self.assertEqual(manifest["default_widget_ids"], [])
        self.assertNotIn("telemetry-export", manifest["connection_capabilities"])
        self.assertTrue(all(isinstance(value, list) for key, value in manifest.items() if key.endswith("_ids") or key.endswith("_capabilities") or key == "capabilities"))

    def test_manifest_has_fixed_graph_and_adjustable_policies(self):
        manifest = AdIntelligenceManifest()
        self.assertEqual(manifest.pipeline, ("discover", "resolve", "capture", "normalize", "classify", "media-qa", "publish"))
        self.assertEqual(manifest.media.min_width, 640)
        self.assertEqual(manifest.classification.prompt_ref, "prompt://ad-intelligence/classify/v1")
        self.assertEqual(manifest.classification.prompt_version, "1")

        declarative = json.loads((Path(__file__).parents[1] / "tools" / "ad-intelligence" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(declarative["schema"], "schema://frank.tool-app-manifest/v1")
        self.assertEqual(declarative["release_schema"], "schema://frank.ad-intelligence-release/v1")
        pipeline = declarative["pipelines"][0]
        self.assertEqual(pipeline["version"], "1.0.0")
        self.assertEqual([node["id"] for node in pipeline["nodes"]][-2:], ["media-qa", "publish"])
        self.assertEqual(len(pipeline["edges"]), 6)
        self.assertIn("run", ALLOWED_ACTIONS)
        self.assertIn("stage-completed", ALLOWED_EVENTS)
        self.assertEqual(set(declarative["hermes"]["event_kinds"]), set(ALLOWED_EVENTS))
        self.assertEqual(declarative["trace"]["schema"], "schema://frank.tool-app-trace/v1")
        self.assertEqual(set(declarative["trace"]["event_kinds"]), set(ALLOWED_EVENTS))

    def test_run_advances_and_publishes_only_in_order(self):
        run = PipelineRun("run-1", AdIntelligenceManifest())
        with self.assertRaises(ValueError): run.advance("capture")
        for stage in run.manifest.pipeline:
            run.advance(stage); run.succeed(model="hermes-policy-selected", evidence_refs=(f"evidence://{stage}",), receipt_refs=(f"receipt://{stage}",))
        self.assertEqual(run.status, "awaiting_approval")
        self.assertIsNotNone(run.approval_receipt_ref)
        with self.assertRaises(ValueError): run.advance("publish")
        run.approve_publish("hermes-policy", receipt_ref="receipt://run-1/approved")
        self.assertEqual(run.status, "published")
        self.assertEqual(len(run.traces), 9)

    def test_retry_then_quarantine(self):
        run = PipelineRun("run-2", AdIntelligenceManifest())
        for _ in range(4): run.record_failure(StageFailure("provider unavailable", retryable=True, reason="transport"))
        self.assertEqual(run.status, "quarantined")
        self.assertIn("transport", run.quarantine_reason)

    def test_retry_delay_is_bounded_exponential(self):
        run = PipelineRun("run-delay", AdIntelligenceManifest())
        self.assertEqual(run.retry_delay_seconds(1), 2.0)
        self.assertEqual(run.retry_delay_seconds(2), 4.0)
        self.assertEqual(run.retry_delay_seconds(99), 60.0)
        with self.assertRaises(ValueError): run.retry_delay_seconds(0)

    def test_public_export_has_no_contact_or_outreach_shape(self):
        result = export_public("blockwise", "2026-08-14T00:00:00Z", [PublicCreative("a-1", "https://public.example/ad", advertiser="Example", copy=PublicCopy(headline="A public ad"), media=(PublicMedia("media://a-1", "image", 1200, 800),), classification=PublicClassification("listing", .95))])
        self.assertEqual(result["schema"], "schema://frank.ad-intelligence-public/v1")
        self.assertEqual(set(result["creatives"][0]), {"id", "source_ref", "advertiser", "market", "category", "copy", "destination_ref", "observed", "media", "classification"})
        self.assertEqual(set(result["creatives"][0]["classification"]), {"label", "confidence", "receipt_refs", "provenance_refs"})
        self.assertNotIn("prompt_ref", str(result))
        self.assertNotIn("model", str(result))
        self.assertNotIn("rationale", str(result))

    def test_public_export_rejects_nested_variants_html_and_raw_payload(self):
        bad_dicts = [
            {"contactEmail": "person@example.test"}, {"prospect_id": "p-1"},
            {"phoneNumber": "+61000000000"}, {"recipient": "person"},
            {"lead_email": "person@example.test"}, {"outreachSequence": ["send"]},
        ]
        for bad in bad_dicts:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                PublicCreative("bad", "https://public.example/ad", copy=bad)
        with self.assertRaises(ValueError): PublicCopy(body="<script>raw payload</script>")
        with self.assertRaises(ValueError): PublicCreative("bad", "https://public.example/ad", classification={"raw_payload": "secret"})
        with self.assertRaises(TypeError): PublicClassification("listing", .9, rationale={"recipient": "person"})

    def test_hermes_protocol_contracts(self):
        self.assertEqual(validate_action("approve-publish"), "approve-publish")
        self.assertEqual(validate_event_name("publish-completed"), "publish-completed")
        with self.assertRaises(ValueError): validate_action("approve_publish")
        with self.assertRaises(ValueError): validate_event_name("publish.completed")
        with self.assertRaises(ValueError): validate_action("arbitrary_execute")
        with self.assertRaises(ValueError): validate_event_name("arbitrary_event")

    def test_release_is_immutable_and_sanitized(self):
        payload = export_public("blockwise", "2026-08-14T00:00:00Z", [PublicCreative("a-1", "https://public.example/ad", classification=PublicClassification("listing", .95, receipt_refs=("receipt://a-1",), provenance_refs=("source://a-1",)))])
        release = build_release("release-1", "1.0.0", "blockwise", payload, **self.RELEASE_EVIDENCE)
        self.assertTrue(release.immutable)
        self.assertTrue(release.pii_sanitized and release.secret_sanitized and release.qa_approved)
        self.assertEqual(release.to_dict()["status"], "released")
        self.assertEqual(release.to_dict()["schema"], "schema://frank.ad-intelligence-release/v1")
        self.assertEqual(release.to_dict()["tool_id"], "ad-intelligence")
        self.assertEqual(release.to_dict()["pipeline_id"], "ad-radar-pipeline")
        self.assertEqual(release.to_dict()["pipeline_version"], "1.0.0")
        self.assertEqual(release.to_dict()["consumer_compatibility"], ["ad-intelligence-public-v1"])
        self.assertEqual(release.to_dict()["qa_receipt_ref"], "receipt://qa/run-1")
        self.assertEqual(len(release.to_dict()["sanitization_receipt_refs"]), 2)
        self.assertEqual(len(release.to_dict()["release_hash"]), 64)
        with self.assertRaises(ValueError):
            replace(release, project_scope="other-project")
        with self.assertRaises(TypeError): release.public_export["project"] = "other"

        private_payload = json.loads(json.dumps(payload))
        private_payload["creatives"][0]["copy"]["prompt_ref"] = "private"
        with self.assertRaises(ValueError): build_release("release-2", "1.0.0", "blockwise", private_payload, **self.RELEASE_EVIDENCE)
        pii_payload = json.loads(json.dumps(payload))
        pii_payload["creatives"][0]["copy"]["body"] = "Call +61 400 123 456"
        with self.assertRaises(ValueError): build_release("release-3", "1.0.0", "blockwise", pii_payload, **self.RELEASE_EVIDENCE)
        private_ref_payload = json.loads(json.dumps(payload))
        private_ref_payload["creatives"][0]["source_ref"] = "openbao://private/source"
        with self.assertRaises(ValueError): build_release("release-4", "1.0.0", "blockwise", private_ref_payload, **self.RELEASE_EVIDENCE)

        with self.assertRaises(ValueError):
            build_release("release-5", "1.0.0", "blockwise", payload, **{**self.RELEASE_EVIDENCE, "trace_refs": ()})


if __name__ == "__main__": unittest.main()
