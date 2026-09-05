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
    PublicMedia, PublicObservation, build_release, export_public,
)
from ad_intelligence.pipeline import PipelineRun, StageFailure
from ad_intelligence.protocol import (
    ACTIONS_BY_OPERATION,
    ALLOWED_ACTIONS,
    ALLOWED_EVENTS,
    EVENTS_BY_OPERATION,
    LEGACY_ACTIONS,
    LEGACY_EVENTS,
    RECOVERY_ACTIONS,
    validate_action,
    validate_event_name,
)


class AdIntelligenceToolTest(unittest.TestCase):
    RELEASE_EVIDENCE = {
        "provenance_refs": ("source://a-1",),
        "trace_refs": ("trace://run-1",),
        "settings_revision": 1,
        "settings_ref": "settings://ad-radar/1",
        "qa_receipt": {
            "decision": "pass",
            "receipt_ref": "receipt://qa/run-1",
            "checked_at": "2026-08-14T00:00:01Z",
        },
        "sanitization_receipts": {
            "pii_scan": {"status": "passed", "receipt_id": "pii-scan-1", "scanned_at": "2026-08-14T00:00:01Z"},
            "secret_scan": {"status": "passed", "receipt_id": "secret-scan-1", "scanned_at": "2026-08-14T00:00:01Z"},
        },
    }

    @staticmethod
    def public_payload():
        return export_public(
            "blockwise",
            "2026-08-14T00:00:00Z",
            [PublicCreative(
                "a-1",
                "https://public.example/ad",
                advertiser="Example",
                copy=PublicCopy(headline="A public ad"),
                observed=PublicObservation("2026-08-13T00:00:00Z", "2026-08-14T00:00:00Z"),
                media=(PublicMedia("media://a-1", "image", 1200, 800),),
                classification=PublicClassification(
                    "listing",
                    .95,
                    receipt_refs=("receipt://classification/a-1",),
                    provenance_refs=("source://a-1",),
                ),
            )],
        )

    def release(self, *, project_scope="blockwise", evidence=None):
        return build_release(
            "release-1",
            "1.0.0",
            "2026-08-14T00:00:01Z",
            project_scope,
            self.public_payload(),
            **(evidence or self.RELEASE_EVIDENCE),
        )

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
        self.assertEqual(declarative["version"], "2.0.0")
        self.assertEqual(declarative["release_schema"], "schema://frank.ad-intelligence-release/v1")
        pipeline = declarative["pipelines"][0]
        self.assertEqual(pipeline["version"], "1.0.0")
        nodes = [node["id"] for node in pipeline["nodes"]]
        self.assertEqual(nodes, list(manifest.pipeline))
        self.assertEqual(
            [(edge["from"], edge["to"]) for edge in pipeline["edges"]],
            list(zip(nodes, nodes[1:])),
        )
        self.assertLessEqual(LEGACY_ACTIONS, ALLOWED_ACTIONS)
        self.assertLessEqual(LEGACY_EVENTS, ALLOWED_EVENTS)
        self.assertEqual(set(declarative["hermes"]["event_kinds"]), set(ALLOWED_EVENTS))
        self.assertEqual(declarative["trace"]["schema"], "schema://frank.tool-app-trace/v1")
        self.assertEqual(set(declarative["trace"]["event_kinds"]), set(ALLOWED_EVENTS))
        public_schema = json.loads((PACKAGE_DIR / "schemas" / "public-export.schema.json").read_text(encoding="utf-8"))
        release_schema = json.loads((PACKAGE_DIR / "schemas" / "release.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(public_schema["$id"], "schema://frank.ad-intelligence-public/v1")
        self.assertEqual(release_schema["$id"], declarative["release_schema"])
        self.assertFalse(public_schema["additionalProperties"])
        self.assertFalse(release_schema["additionalProperties"])

    def test_manifest_lifecycle_groups_match_protocol_allowlists(self):
        declarative = json.loads((PACKAGE_DIR / "manifest.json").read_text(encoding="utf-8"))
        hermes = declarative["hermes"]
        operations = hermes["operations"]

        self.assertEqual(set(operations), {"setup", "live", "library", "qa", "release"})
        for operation, action_names in ACTIONS_BY_OPERATION.items():
            with self.subTest(operation=operation, contract="actions"):
                self.assertEqual(set(operations[operation]["actions"]), set(action_names))
        for operation, event_names in EVENTS_BY_OPERATION.items():
            with self.subTest(operation=operation, contract="events"):
                self.assertEqual(set(operations[operation]["event_kinds"]), set(event_names))

        self.assertEqual(set(hermes["actions"]), set(ALLOWED_ACTIONS))
        self.assertEqual(set(hermes["event_kinds"]), set(ALLOWED_EVENTS))
        self.assertEqual(set(hermes["recovery_actions"]), set(RECOVERY_ACTIONS))
        self.assertLessEqual(RECOVERY_ACTIONS, ALLOWED_ACTIONS)
        self.assertLessEqual(
            {"resume", "retry-stage", "resolve-quarantine", "supersede-release"},
            RECOVERY_ACTIONS,
        )

    def test_settings_schema_is_closed_structural_and_reference_only(self):
        declarative = json.loads((PACKAGE_DIR / "manifest.json").read_text(encoding="utf-8"))
        settings = declarative["settings"]
        properties = settings["properties"]

        self.assertEqual(settings["type"], "object")
        self.assertFalse(settings["additionalProperties"])
        self.assertLessEqual(set(settings["required"]), set(properties))
        for name in (
            "taxonomy", "cadence", "model_policy", "media_policy", "thresholds",
            "retention", "approval_policy", "connection",
        ):
            with self.subTest(setting=name):
                schema = properties[name]
                self.assertEqual(schema["type"], "object")
                self.assertFalse(schema["additionalProperties"])
                self.assertLessEqual(set(schema["required"]), set(schema["properties"]))

        source_item = properties["sources"]["items"]
        self.assertFalse(source_item["additionalProperties"])
        self.assertEqual(
            set(source_item["properties"]),
            {"source_id", "label", "kind", "enabled", "markets", "connection_id"},
        )
        self.assertEqual(
            properties["connection"]["properties"]["capability"]["const"],
            declarative["connectors"][0],
        )
        self.assertTrue(properties["model_policy"]["properties"]["policy_ref"]["pattern"].startswith("^policy://"))
        self.assertTrue(properties["cadence"]["properties"]["schedule_ref"]["pattern"].startswith("^schedule://"))

        schema_property_names = set()
        queue = [settings]
        while queue:
            schema = queue.pop()
            if not isinstance(schema, dict):
                continue
            child_properties = schema.get("properties", {})
            schema_property_names.update(child_properties)
            queue.extend(child_properties.values())
            items = schema.get("items")
            if isinstance(items, dict):
                queue.append(items)
        self.assertTrue({"connection_id", "policy_ref", "schedule_ref"} <= schema_property_names)
        self.assertTrue(
            {"password", "secret", "api_key", "access_token", "cookie", "credential"}.isdisjoint(schema_property_names)
        )

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
        result = self.public_payload()
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

    def test_public_export_rejects_invalid_time_order_and_numeric_types(self):
        with self.assertRaises(ValueError): export_public("blockwise", "not-a-timestamp", [])
        with self.assertRaises(ValueError): PublicObservation("2026-08-14T01:00:00Z", "2026-08-14T00:00:00Z")
        with self.assertRaises(ValueError): PublicMedia("media://a-1", "image", True, 800)
        with self.assertRaises(ValueError): PublicClassification("listing", True)
        with self.assertRaises(ValueError):
            export_public(
                "blockwise",
                "2026-08-14T00:00:00Z",
                [PublicCreative("a-1", "https://public.example/ad", observed=PublicObservation(last_seen="2026-08-14T00:00:01Z"))],
            )

    def test_hermes_protocol_contracts(self):
        self.assertEqual(validate_action("approve-publish"), "approve-publish")
        self.assertEqual(validate_action("retry-stage"), "retry-stage")
        self.assertEqual(validate_action("supersede-release"), "supersede-release")
        self.assertEqual(validate_event_name("publish-completed"), "publish-completed")
        self.assertEqual(validate_event_name("quarantine-resolved"), "quarantine-resolved")
        self.assertEqual(validate_event_name("release-superseded"), "release-superseded")
        with self.assertRaises(ValueError): validate_action("approve_publish")
        with self.assertRaises(ValueError): validate_event_name("publish.completed")
        with self.assertRaises(ValueError): validate_action("arbitrary_execute")
        with self.assertRaises(ValueError): validate_event_name("arbitrary_event")
        with self.assertRaises(ValueError): validate_action(None)
        with self.assertRaises(ValueError): validate_event_name(["run-started"])

    def test_release_is_immutable_and_sanitized(self):
        release = self.release()
        self.assertTrue(release.immutable)
        self.assertEqual(release.to_dict()["status"], "released")
        self.assertEqual(release.to_dict()["released_at"], "2026-08-14T00:00:01Z")
        self.assertEqual(release.to_dict()["schema"], "schema://frank.ad-intelligence-release/v1")
        self.assertEqual(release.to_dict()["tool_id"], "ad-intelligence")
        self.assertEqual(release.to_dict()["pipeline_id"], "ad-radar-pipeline")
        self.assertEqual(release.to_dict()["pipeline_version"], "1.0.0")
        self.assertEqual(release.to_dict()["consumer_compatibility"], ["ad-intelligence-public-v1"])
        self.assertEqual(release.to_dict()["settings_revision"], 1)
        self.assertEqual(release.to_dict()["qa_receipt"]["decision"], "pass")
        self.assertEqual(release.to_dict()["sanitization_receipts"]["pii_scan"]["status"], "passed")
        self.assertEqual(release.to_dict()["checksum"], "84afae4e14dace7517dd135cfbe45fd513cb7b85163bd72790b16b2f6c1a6e18")
        self.assertEqual(release.to_dict()["release_hash"], "f0046362b6bd2317c30f7f16e4ee786a351982b9d89f0827feeddb93f5cf90fe")
        with self.assertRaises(ValueError):
            replace(release, project_scope="other-project")
        with self.assertRaises(ValueError):
            replace(release, consumer_compatibility=("other-v1",))
        with self.assertRaises(TypeError): release.public_export["project"] = "other"
        with self.assertRaises(TypeError): release.qa_receipt["decision"] = "fail"

        payload = self.public_payload()
        private_payload = json.loads(json.dumps(payload))
        private_payload["creatives"][0]["copy"]["prompt_ref"] = "private"
        with self.assertRaises(ValueError): build_release("release-2", "1.0.0", "2026-08-14T00:00:01Z", "blockwise", private_payload, **self.RELEASE_EVIDENCE)
        pii_payload = json.loads(json.dumps(payload))
        pii_payload["creatives"][0]["copy"]["body"] = "Call +61 400 123 456"
        with self.assertRaises(ValueError): build_release("release-3", "1.0.0", "2026-08-14T00:00:01Z", "blockwise", pii_payload, **self.RELEASE_EVIDENCE)
        private_ref_payload = json.loads(json.dumps(payload))
        private_ref_payload["creatives"][0]["source_ref"] = "openbao://private/source"
        with self.assertRaises(ValueError): build_release("release-4", "1.0.0", "2026-08-14T00:00:01Z", "blockwise", private_ref_payload, **self.RELEASE_EVIDENCE)

        with self.assertRaises(ValueError):
            build_release("release-5", "1.0.0", "2026-08-14T00:00:01Z", "blockwise", payload, **{**self.RELEASE_EVIDENCE, "trace_refs": ()})

    def test_release_matches_golden_fixture_and_strict_schema(self):
        fixture = json.loads((PACKAGE_DIR / "fixtures" / "ad-radar-release-v1.json").read_text(encoding="utf-8"))
        release = self.release().to_dict()
        release_schema = json.loads((PACKAGE_DIR / "schemas" / "release.schema.json").read_text(encoding="utf-8"))
        public_schema = json.loads((PACKAGE_DIR / "schemas" / "public-export.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(release, fixture)
        self.assertEqual(set(fixture), set(release_schema["required"]))
        self.assertEqual(set(fixture["public_export"]), set(public_schema["required"]))

    def test_release_rejects_scope_private_metadata_and_inexact_receipts(self):
        with self.assertRaises(ValueError): self.release(project_scope="other-project")
        with self.assertRaises(ValueError):
            self.release(evidence={**self.RELEASE_EVIDENCE, "trace_refs": ("trace://person@example.test",)})
        with self.assertRaises(ValueError):
            self.release(evidence={**self.RELEASE_EVIDENCE, "settings_ref": "openbao://private/settings"})
        with self.assertRaises(ValueError):
            self.release(evidence={**self.RELEASE_EVIDENCE, "settings_revision": True})
        with self.assertRaises(ValueError):
            self.release(evidence={**self.RELEASE_EVIDENCE, "qa_receipt": {**self.RELEASE_EVIDENCE["qa_receipt"], "notes": "extra"}})
        bad_scans = json.loads(json.dumps(self.RELEASE_EVIDENCE["sanitization_receipts"]))
        bad_scans["pii_scan"]["status"] = "failed"
        with self.assertRaises(ValueError):
            self.release(evidence={**self.RELEASE_EVIDENCE, "sanitization_receipts": bad_scans})
        with self.assertRaises(ValueError):
            build_release(
                "release-1", "1.0.0", "2026-08-13T23:59:59Z", "blockwise",
                self.public_payload(), **self.RELEASE_EVIDENCE,
            )


if __name__ == "__main__": unittest.main()
