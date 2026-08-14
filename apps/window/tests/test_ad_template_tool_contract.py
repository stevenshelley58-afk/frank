import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "ad-template-generator"
GOLDEN_RELEASE = ROOT / "tests" / "fixtures" / "releases" / "ad-template-generator-v1.json"


def load_contract():
    spec = importlib.util.spec_from_file_location("ad_template_contract", TOOL / "contract.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class AdTemplateToolContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = load_contract()
        cls.manifest = json.loads((TOOL / "manifest.json").read_text(encoding="utf-8"))
        cls.home = json.loads((TOOL / "home.json").read_text(encoding="utf-8"))

    def test_package_is_provider_neutral_and_preserves_pipeline(self):
        package = self.contract.build_request(
            project_pack_ref="blockwise-real-estate-v1",
            source_ref="hermes://source/creative-1",
            source_hash="a" * 64,
            prompt_ref="ad-clone-v1",
            prompt_version="2026-08-14",
            model_policy="best_image_generation",
            placements=["meta_feed_4x5", "meta_story_9x16"],
            export_targets=["meta_lead_ad"],
        )
        self.assertEqual(self.contract.validate_package(package), [])
        self.assertEqual(package["pipeline"], list(self.contract.PIPELINE_STAGES))
        self.assertNotIn("provider", package)
        self.assertNotIn("engine", package)

    def test_package_rejects_bad_hash_refs_and_unbounded_qa(self):
        package = {
            "contract_version": "frank.ad-template-generator.v1",
            "project_pack_ref": "blockwise-real-estate-v1",
            "source": {"ref": "hermes://source/creative-1", "source_hash": "not-a-hash"},
            "prompt": {"ref": "secret-token", "version": "2026-08-14"},
            "style_pack_ref": "style/default-v1",
            "model_policy": "best_image_generation",
            "qa_thresholds": {"visual_defects": 2},
            "retry_budget": 1,
            "placements": ["meta_feed_4x5"],
            "export_targets": ["meta_lead_ad"],
            "approval_policy": "human_native_pixel",
            "pipeline": list(self.contract.PIPELINE_STAGES),
        }
        errors = self.contract.validate_package(package)
        self.assertTrue(any("64 hexadecimal" in error for error in errors))
        self.assertTrue(any("safe non-secret" in error for error in errors))
        self.assertTrue(any("bounded" in error for error in errors))

    def test_trace_requires_cost_hashes_evidence_and_receipts(self):
        trace = {
            "run_id": "run-1",
            "status": "approved",
            "stages": list(self.contract.PIPELINE_STAGES),
            "provider_attempts": [{"provider": "hermes", "model": "image-model", "cost_usd": 0.12}],
            "cost_usd": 0.12,
            "hashes": {"source": "a" * 64, "output": "b" * 64, "request": "c" * 64},
            "evidence": [{"kind": "native_pixel_qa", "uri": "hermes://evidence/run-1"}],
            "receipts": [{"kind": "provider", "provider": "hermes", "attempt": 1}],
        }
        self.assertEqual(self.contract.validate_trace(trace), [])
        self.assertNotIn("widget_contract", self.manifest["metadata"])

    def test_blockwise_specifics_live_in_project_pack(self):
        pack = json.loads((TOOL / "packs" / "blockwise-real-estate.json").read_text(encoding="utf-8"))
        self.assertIn("real_estate_seller_leads", pack["goals"])
        self.assertEqual(pack["lead_form"]["provider"], "meta")
        self.assertNotIn("Blockwise", self.contract.__doc__)

    def test_release_stage_is_after_human_native_pixel_approval(self):
        self.assertEqual(self.manifest["schema"], "schema://frank.tool-app-manifest/v1")
        self.assertEqual(self.manifest["release_schema"], "schema://frank.ad-template-generator-release/v1")
        self.assertEqual(self.manifest["scopes"], ["project", "workspace"])
        self.assertEqual(self.manifest["settings"]["schema"], "schema://frank.tool-app-settings/v1")
        for field in ("name", "description", "version", "scopes", "settings", "pipelines", "capabilities", "connectors", "schedules", "thresholds", "approval_gates", "hermes", "trace"):
            self.assertIn(field, self.manifest)
        self.assertIsInstance(self.manifest["thresholds"], list)
        pipeline = self.manifest["pipelines"][0]
        self.assertEqual(pipeline["schema"], "schema://frank.tool-app-pipeline/v1")
        self.assertEqual(pipeline["version"], "1.0.0")
        self.assertTrue(all(set(node) == {"id", "kind"} for node in pipeline["nodes"]))
        self.assertTrue(all(set(edge) == {"from", "to"} for edge in pipeline["edges"]))
        self.assertTrue(all("_" not in node["id"] for node in pipeline["nodes"]))
        self.assertTrue(all("_" not in gate for gate in self.manifest["approval_gates"]))
        stages = self.contract.PIPELINE_GRAPH["nodes"]
        self.assertEqual(tuple(node["id"] for node in pipeline["nodes"]), stages)
        self.assertLess(stages.index("native-pixel-human-approval"), stages.index("immutable-source-free-release"))
        self.assertIn("approve-native-pixels", self.manifest["hermes"]["actions"])
        self.assertIn("release-issued", self.manifest["hermes"]["event_kinds"])
        self.assertTrue(all("." not in value for value in self.manifest["hermes"]["actions"] + self.manifest["hermes"]["event_kinds"]))
        self.assertEqual(self.manifest["trace"]["schema"], "schema://frank.tool-app-trace/v1")
        self.assertEqual(self.manifest["trace"]["style"], "otel-genai")
        self.assertEqual(self.manifest["trace"]["event_kinds"], self.manifest["hermes"]["event_kinds"])
        self.assertEqual(set(self.manifest["metadata"]), {"lineage", "health"})

    def test_home_manifest_is_exactly_declarative_and_closed(self):
        self.assertEqual(
            set(self.home),
            {"id", "name", "kind", "blurb", "capabilities", "default_widget_ids", "connection_capabilities"},
        )
        self.assertEqual(self.home["kind"], "tool")
        self.assertIsInstance(self.home["capabilities"], list)
        self.assertIsInstance(self.home["default_widget_ids"], list)
        self.assertIsInstance(self.home["connection_capabilities"], list)
        self.assertEqual(self.home["default_widget_ids"], [])
        self.assertEqual(self.home["connection_capabilities"], ["image.generate"])

    def test_immutable_release_requires_approval_and_is_source_free(self):
        valid = {
            "tool_id": "ad-template-generator",
            "scope": {"kind": "project", "id": "blockwise"},
            "release_version": "1.0.0",
            "release_id": "release-1",
            "settings_revision": 1,
            "settings_ref": "hermes://settings/revision-1",
            "pipeline_id": "reference-clone-release",
            "pipeline_version": "1.0.0",
            "consumer_compatibility": ("blockwise-template-pack-v1",),
            "template_pack": {
                "schema": "blockwise.template-pack/v1",
                "pack_id": "pack-golden-001-v1",
                "artifact_ref": "https://frank.fail/releases/pack-golden-001-v1.json",
                "sha256": "b" * 64,
                "signature_algorithm": "ed25519",
                "signature": "base64-ed25519-signature-placeholder",
            },
            "provenance": {
                "artifact_ref": "https://frank.fail/releases/pack-golden-001-v1.json",
                "artifact_receipt_ref": "hermes://receipts/artifact-1",
            },
            "trace_ref": "hermes://traces/run-1",
            "qa_receipt": {"decision": "pass", "receipt_ref": "hermes://receipts/qa-1", "checked_at": "2026-08-14T00:00:00Z"},
            "approval_receipt": {"decision": "approved", "gate": "native-pixel-human-approval", "receipt_ref": "hermes://receipts/approval-1", "decided_at": "2026-08-14T00:01:00Z"},
            "sanitization_receipt": {"decision": "pass", "receipt_ref": "hermes://receipts/sanitization-1", "checked_at": "2026-08-14T00:02:00Z"},
            "released_at": "2026-08-14T00:03:00Z",
        }
        release = self.contract.build_immutable_release(**valid)
        self.assertEqual(self.contract.validate_release(release), [])
        self.assertEqual(release.release_hash, "793f20dee498be21c417a55e6a8822368359985e13b55abb06f6da82b8c9100f")
        public = release.as_dict()
        self.assertEqual(public, json.loads(GOLDEN_RELEASE.read_text(encoding="utf-8")))
        self.assertEqual(public["schema"], "schema://frank.ad-template-generator-release/v1")
        self.assertEqual(public["template_pack"]["schema"], "blockwise.template-pack/v1")
        self.assertNotIn("prompt_receipt", public)
        self.assertNotIn("model_receipt", public)
        self.assertNotIn("reviewer_ref", str(public))
        leaked = release.as_dict()
        leaked["source_ref"] = "hermes://private/source"
        self.assertTrue(any("forbidden" in error for error in self.contract.validate_release(leaked)))
        missing_approval = dict(valid)
        missing_approval["approval_receipt"] = {}
        with self.assertRaises(ValueError):
            self.contract.build_immutable_release(**missing_approval)
        missing_sanitization = dict(valid)
        missing_sanitization["sanitization_receipt"] = {}
        with self.assertRaises(ValueError):
            self.contract.build_immutable_release(**missing_sanitization)
        mismatched = release.as_dict()
        mismatched["provenance"]["artifact_ref"] = "https://frank.fail/releases/other.json"
        mismatched["release_hash"] = self.contract._canonical_release_hash(mismatched)
        self.assertTrue(any("must match" in error for error in self.contract.validate_release(mismatched)))
        bad_timestamp = dict(valid)
        bad_timestamp["qa_receipt"] = dict(valid["qa_receipt"], checked_at="not-a-timestamp")
        self.assertTrue(any("ISO-8601" in error for error in self.contract.validate_release(bad_timestamp)))

        unknown = release.as_dict()
        unknown["notes"] = "public-looking but undeclared"
        unknown["release_hash"] = self.contract._canonical_release_hash(unknown)
        self.assertTrue(any("must contain exactly" in error for error in self.contract.validate_release(unknown)))

        pii = release.as_dict()
        pii["provenance"]["artifact_receipt_ref"] = "person@example.com"
        pii["release_hash"] = self.contract._canonical_release_hash(pii)
        self.assertTrue(any("PII-like" in error for error in self.contract.validate_release(pii)))

        wrong_compatibility = dict(valid, consumer_compatibility=("some-other-consumer-v1",))
        with self.assertRaises(ValueError):
            self.contract.build_immutable_release(**wrong_compatibility)

    def test_release_schema_is_strict_and_matches_golden_fixture(self):
        schema = json.loads((TOOL / "release.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["$id"], "schema://frank.ad-template-generator-release/v1")
        self.assertFalse(schema["additionalProperties"])
        for definition in schema["$defs"].values():
            self.assertFalse(definition["additionalProperties"])
        fixture = json.loads(GOLDEN_RELEASE.read_text(encoding="utf-8"))
        self.assertEqual(self.contract.validate_release(fixture), [])


if __name__ == "__main__":
    unittest.main()
