import importlib.util
import json
from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"


def load_package(alias, tool_id):
    package_dir = TOOLS / tool_id
    spec = importlib.util.spec_from_file_location(alias, package_dir / "__init__.py", submodule_search_locations=[str(package_dir)])
    package = importlib.util.module_from_spec(spec)
    sys.modules[alias] = package
    spec.loader.exec_module(package)
    return package


TEMPLATE = load_package("snapshot_ad_template", "ad-template-generator")
AD_RADAR = load_package("snapshot_ad_radar", "ad-intelligence")
CONTENT = load_package("snapshot_content_factory", "content-factory")


class CreativeToolHomeSnapshotTests(unittest.TestCase):
    TOP_LEVEL_FIELDS = {
        "schema", "tool_id", "status", "summary", "overview", "connections",
        "current_work", "outputs", "receipts", "source_truth",
    }

    def assert_snapshot_shape(self, snapshot, tool_id):
        self.assertEqual(set(snapshot), self.TOP_LEVEL_FIELDS)
        self.assertEqual(snapshot["schema"], "schema://frank.tool-home-snapshot/v1")
        self.assertEqual(snapshot["tool_id"], tool_id)
        self.assertEqual(snapshot["source_truth"], "runtime")
        for section in ("current_work", "outputs", "receipts"):
            self.assertEqual(set(snapshot[section]), {"status", "summary", "count", "items"})

    def test_unavailable_and_connected_empty_states_are_distinct(self):
        for tool_id, package in (
            ("ad-template-generator", TEMPLATE),
            ("ad-intelligence", AD_RADAR),
            ("content-factory", CONTENT),
        ):
            with self.subTest(tool_id=tool_id):
                unavailable = package.build_home_snapshot()
                empty = package.build_home_snapshot({})
                self.assert_snapshot_shape(unavailable, tool_id)
                self.assertEqual(unavailable["status"], "unavailable")
                self.assertTrue(all(unavailable[key]["status"] == "unavailable" for key in ("current_work", "outputs", "receipts")))
                self.assertEqual(empty["status"], "empty")
                self.assertTrue(all(empty[key]["status"] == "empty" for key in ("current_work", "outputs", "receipts")))
                self.assertTrue(empty["overview"]["adjustable_settings"])

    def test_connection_coverage_comes_only_from_home_manifest(self):
        template = TEMPLATE.build_home_snapshot({})["connections"]
        radar = AD_RADAR.build_home_snapshot({})["connections"]
        content = CONTENT.build_home_snapshot({})["connections"]
        self.assertEqual(template["items"], [{"capability": "image.generate", "status": "unavailable", "connection_id": None}])
        self.assertEqual(radar["items"], [{"capability": "browser-public-read", "status": "unavailable", "connection_id": None}])
        self.assertEqual(content, {"status": "ready", "summary": "No Tool-owned connection capabilities are required.", "total": 0, "recorded": 0, "verified": 0, "attention": 0, "items": []})

    def test_in_memory_home_profiles_match_the_canonical_manifests(self):
        for tool_id, package in (
            ("ad-template-generator", TEMPLATE),
            ("ad-intelligence", AD_RADAR),
            ("content-factory", CONTENT),
        ):
            with self.subTest(tool_id=tool_id):
                canonical = json.loads((TOOLS / tool_id / "home.json").read_text(encoding="utf-8"))
                self.assertEqual(package.home_profile(), canonical)
                with self.assertRaises(TypeError):
                    package.HOME_PROFILE["name"] = "caller mutation"
                with self.assertRaises(AttributeError):
                    package.HOME_PROFILE["capabilities"].append("caller mutation")
                mutable_copy = package.home_profile()
                mutable_copy["capabilities"].append("caller mutation")
                self.assertEqual(package.home_profile(), canonical)

    def test_provider_import_and_calls_perform_no_file_io(self):
        template_trace = {
            "run_id": "run-io-check", "status": "running", "stages": list(TEMPLATE.PIPELINE_STAGES),
            "provider_attempts": [{"attempt": 1}], "hashes": {"source": "a" * 64},
            "evidence": ["evidence://run-io-check"], "receipts": [{"kind": "attempt"}],
        }
        radar_run = AD_RADAR.PipelineRun("run-io-check", AD_RADAR.AdIntelligenceManifest())
        content_event = CONTENT.build_event("stage-completed", {"run_id": "run-io-check", "stage": "draft"}, "correlation-io-check")
        module_states = (
            (sys.modules["snapshot_ad_template.home_snapshot"], {"connections": [{"capability": "image.generate", "status": "verified", "connection_id": "connection-image-1"}], "trace": template_trace}),
            (sys.modules["snapshot_ad_radar.home_snapshot"], {"connections": [{"capability": "browser-public-read", "status": "verified", "connection_id": "connection-browser-1"}], "runs": [radar_run]}),
            (sys.modules["snapshot_content_factory.home_snapshot"], {"events": [content_event]}),
        )
        with mock.patch("pathlib.Path.read_text", side_effect=AssertionError("provider read a file")), mock.patch("builtins.open", side_effect=AssertionError("provider opened a file")):
            for module, runtime_state in module_states:
                importlib.reload(module)
                self.assertEqual(module.build_home_snapshot(runtime_state)["status"], "ready")

    def test_returned_nested_data_cannot_mutate_later_snapshots(self):
        for package in (TEMPLATE, AD_RADAR, CONTENT):
            with self.subTest(package=package.__name__):
                first = package.build_home_snapshot({})
                first["overview"]["capabilities"].append("caller-mutation")
                first["overview"]["adjustable_settings"].clear()
                first["connections"]["items"].append({"capability": "caller", "status": "verified", "connection_id": "caller"})
                second = package.build_home_snapshot({})
                self.assertNotIn("caller-mutation", second["overview"]["capabilities"])
                self.assertTrue(second["overview"]["adjustable_settings"])
                self.assertFalse(any(item["capability"] == "caller" for item in second["connections"]["items"]))

    def test_mutable_public_manifests_cannot_change_captured_overviews(self):
        template_manifest = sys.modules["snapshot_ad_template.contract"].MANIFEST
        template_pipeline = template_manifest["pipelines"][0]
        template_original = deepcopy(template_manifest)
        template_before = TEMPLATE.build_home_snapshot({})
        try:
            template_manifest["id"] = "caller-mutated-tool"
            template_manifest["version"] = "99.99.99"
            template_manifest["settings"]["properties"]["caller_mutation"] = {"type": "string"}
            template_pipeline["id"] = "caller-mutated-pipeline"
            template_pipeline["version"] = "99.99.99"
            after = TEMPLATE.build_home_snapshot({})
            self.assertEqual(after["tool_id"], template_before["tool_id"])
            self.assertEqual(after["overview"], template_before["overview"])
        finally:
            template_pipeline.clear()
            template_pipeline.update(deepcopy(template_original["pipelines"][0]))
            template_manifest.clear()
            template_manifest.update(deepcopy(template_original))
            template_manifest["pipelines"][0] = template_pipeline

        content_manifest = CONTENT.CONTENT_FACTORY_MANIFEST
        content_original = deepcopy(content_manifest)
        content_before = CONTENT.build_home_snapshot({})
        try:
            content_manifest["id"] = "caller-mutated-tool"
            content_manifest["version"] = "99.99.99"
            content_manifest["settings"]["properties"]["caller_mutation"] = {"type": "string"}
            content_manifest["pipelines"][0]["id"] = "caller-mutated-pipeline"
            content_manifest["pipelines"][0]["version"] = "99.99.99"
            after = CONTENT.build_home_snapshot({})
            self.assertEqual(after["tool_id"], content_before["tool_id"])
            self.assertEqual(after["overview"], content_before["overview"])
        finally:
            content_manifest.clear()
            content_manifest.update(content_original)

        radar_pipeline = sys.modules["snapshot_ad_radar.core"]._PIPELINE_MANIFEST
        radar_original = deepcopy(radar_pipeline)
        radar_before = AD_RADAR.build_home_snapshot({})
        try:
            radar_pipeline["id"] = "caller-mutated-pipeline"
            radar_pipeline["version"] = "99.99.99"
            after = AD_RADAR.build_home_snapshot({})
            self.assertEqual(after["tool_id"], radar_before["tool_id"])
            self.assertEqual(after["overview"], radar_before["overview"])
        finally:
            radar_pipeline.clear()
            radar_pipeline.update(radar_original)

    def test_template_snapshot_projects_validated_runtime_state_only(self):
        release = json.loads((ROOT / "tests" / "fixtures" / "releases" / "ad-template-generator-v1.json").read_text(encoding="utf-8"))
        trace = {
            "run_id": "run-1", "status": "running", "stages": list(TEMPLATE.PIPELINE_STAGES),
            "provider_attempts": [{"attempt": 1}], "hashes": {"source": "a" * 64},
            "evidence": ["evidence://run-1"], "receipts": [{"kind": "attempt"}],
        }
        snapshot = TEMPLATE.build_home_snapshot({
            "connections": [{"capability": "image.generate", "status": "verified", "connection_id": "connection-image-1"}],
            "trace": trace,
            "releases": [release],
        })
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["current_work"]["items"][0]["run_id"], "run-1")
        self.assertEqual(snapshot["outputs"]["items"][0]["pack_id"], release["template_pack"]["pack_id"])
        self.assertEqual(snapshot["receipts"]["count"], 5)
        serialized = json.dumps(snapshot)
        self.assertNotIn("artifact_ref", serialized)
        self.assertNotIn("provider_attempts", serialized)
        self.assertNotIn("signature", serialized)

    def test_ad_radar_snapshot_uses_typed_runs_health_and_releases(self):
        fixture = json.loads((TOOLS / "ad-intelligence" / "fixtures" / "ad-radar-release-v1.json").read_text(encoding="utf-8"))
        release = AD_RADAR.build_release(
            fixture["release_id"], fixture["version"], fixture["released_at"], fixture["project_scope"], fixture["public_export"],
            provenance_refs=tuple(fixture["provenance_refs"]), trace_refs=tuple(fixture["trace_refs"]),
            settings_revision=fixture["settings_revision"], settings_ref=fixture["settings_ref"],
            qa_receipt=fixture["qa_receipt"], sanitization_receipts=fixture["sanitization_receipts"],
        )
        run = AD_RADAR.PipelineRun("run-1", AD_RADAR.AdIntelligenceManifest())
        run.advance("discover")
        run.succeed(receipt_refs=("receipt://discover/run-1",))
        health = AD_RADAR.HealthSnapshot("ready", "2026-08-14T00:00:01Z", "resolve", published=1)
        snapshot = AD_RADAR.build_home_snapshot({
            "connections": [{"capability": "browser-public-read", "status": "verified", "connection_id": "connection-browser-1"}],
            "runs": [run],
            "releases": [release],
            "health": health,
        })
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["outputs"]["items"][0]["creative_count"], 1)
        self.assertEqual(snapshot["receipts"]["count"], 4)
        serialized = json.dumps(snapshot)
        self.assertNotIn("public_export", serialized)
        self.assertNotIn("advertiser", serialized)
        self.assertNotIn("error", serialized)

    def test_content_snapshot_projects_events_and_public_release_metadata(self):
        fixture = json.loads((TOOLS / "content-factory" / "fixtures" / "content-release-v1.json").read_text(encoding="utf-8"))
        event = CONTENT.build_event("stage-completed", {"run_id": "run-1", "content_id": "content-1", "stage": "draft"}, "correlation-1")
        snapshot = CONTENT.build_home_snapshot({"events": [event], "releases": [fixture]})
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["current_work"]["items"][0]["stage"], "draft")
        self.assertEqual(snapshot["outputs"]["items"][0]["release_id"], fixture["release_id"])
        self.assertEqual(snapshot["receipts"]["count"], 4)
        serialized = json.dumps(snapshot)
        self.assertNotIn("Public article body", serialized)
        self.assertNotIn('"body"', serialized)
        self.assertNotIn('"seo"', serialized)

    def test_unsafe_or_unowned_runtime_fields_fail_closed(self):
        for package in (TEMPLATE, AD_RADAR, CONTENT):
            with self.subTest(package=package.__name__), self.assertRaises(ValueError):
                package.build_home_snapshot({"provider_payload": {"token": "unsafe"}})
            with self.subTest(package=package.__name__), self.assertRaises(TypeError):
                package.build_home_snapshot([])

        run = AD_RADAR.PipelineRun("run-unsafe", AD_RADAR.AdIntelligenceManifest())
        run.advance("discover")
        run.succeed(receipt_refs=("person@example.test",))
        with self.assertRaises(ValueError):
            AD_RADAR.build_home_snapshot({"runs": [run]})

    def test_recorded_failure_states_raise_attention_without_exposing_errors(self):
        trace = {
            "run_id": "run-failed", "status": "failed", "stages": list(TEMPLATE.PIPELINE_STAGES),
            "provider_attempts": [{"attempt": 1}], "hashes": {"source": "a" * 64},
            "evidence": ["evidence://run-failed"], "receipts": [{"kind": "failure"}],
        }
        self.assertEqual(TEMPLATE.build_home_snapshot({"trace": trace})["status"], "attention")

        radar_run = AD_RADAR.PipelineRun("run-quarantined", AD_RADAR.AdIntelligenceManifest())
        for _ in range(4):
            radar_run.record_failure(AD_RADAR.StageFailure("private provider detail", retryable=True))
        radar_snapshot = AD_RADAR.build_home_snapshot({"runs": [radar_run]})
        self.assertEqual(radar_snapshot["status"], "attention")
        self.assertNotIn("private provider detail", json.dumps(radar_snapshot))

        content_event = CONTENT.build_event("quarantined", {"run_id": "run-quarantined"}, "correlation-quarantined")
        content_snapshot = CONTENT.build_home_snapshot({"events": [content_event]})
        self.assertEqual(content_snapshot["status"], "attention")

    def test_approval_waiting_states_are_attention_even_with_verified_connections(self):
        template_trace = {
            "run_id": "run-awaiting", "status": "awaiting_approval", "stages": list(TEMPLATE.PIPELINE_STAGES),
            "provider_attempts": [{"attempt": 1}], "hashes": {"source": "a" * 64},
            "evidence": ["evidence://run-awaiting"], "receipts": [{"kind": "approval-request"}],
        }
        template = TEMPLATE.build_home_snapshot({
            "connections": [{"capability": "image.generate", "status": "verified", "connection_id": "connection-image-1"}],
            "trace": template_trace,
        })
        self.assertEqual(template["status"], "attention")
        self.assertEqual(template["current_work"]["status"], "attention")

        radar_run = AD_RADAR.PipelineRun("run-awaiting", AD_RADAR.AdIntelligenceManifest())
        for stage in radar_run.manifest.pipeline:
            radar_run.advance(stage)
            radar_run.succeed(receipt_refs=(f"receipt://{stage}",))
        radar = AD_RADAR.build_home_snapshot({
            "connections": [{"capability": "browser-public-read", "status": "verified", "connection_id": "connection-browser-1"}],
            "runs": [radar_run],
        })
        self.assertEqual(radar_run.status, "awaiting_approval")
        self.assertEqual(radar["status"], "attention")
        self.assertEqual(radar["current_work"]["status"], "attention")

        review = CONTENT.build_event("review-requested", {"run_id": "run-awaiting"}, "correlation-awaiting")
        content = CONTENT.build_home_snapshot({"events": [review]})
        self.assertEqual(content["current_work"]["items"][0]["status"], "awaiting_approval")
        self.assertEqual(content["status"], "attention")
        self.assertEqual(content["current_work"]["status"], "attention")

    def test_required_connection_coverage_controls_runtime_readiness(self):
        template_trace = {
            "run_id": "run-connection", "status": "running", "stages": list(TEMPLATE.PIPELINE_STAGES),
            "provider_attempts": [{"attempt": 1}], "hashes": {"source": "a" * 64},
            "evidence": ["evidence://run-connection"], "receipts": [{"kind": "attempt"}],
        }
        template_attention = TEMPLATE.build_home_snapshot({"trace": template_trace})
        self.assertEqual(template_attention["connections"]["status"], "unavailable")
        self.assertEqual(template_attention["status"], "attention")
        self.assertEqual(template_attention["current_work"]["status"], "attention")
        template_ready = TEMPLATE.build_home_snapshot({
            "connections": [{"capability": "image.generate", "status": "verified", "connection_id": "connection-image-1"}],
            "trace": template_trace,
        })
        self.assertEqual(template_ready["status"], "ready")
        self.assertEqual(template_ready["current_work"]["status"], "ready")

        radar_run = AD_RADAR.PipelineRun("run-connection", AD_RADAR.AdIntelligenceManifest())
        radar_attention = AD_RADAR.build_home_snapshot({"runs": [radar_run]})
        self.assertEqual(radar_attention["connections"]["status"], "unavailable")
        self.assertEqual(radar_attention["status"], "attention")
        self.assertEqual(radar_attention["current_work"]["status"], "attention")
        radar_ready = AD_RADAR.build_home_snapshot({
            "connections": [{"capability": "browser-public-read", "status": "verified", "connection_id": "connection-browser-1"}],
            "runs": [radar_run],
        })
        self.assertEqual(radar_ready["status"], "ready")
        self.assertEqual(radar_ready["current_work"]["status"], "ready")

        for package, capability in ((TEMPLATE, "image.generate"), (AD_RADAR, "browser-public-read")):
            with self.subTest(package=package.__name__), self.assertRaises(ValueError):
                package.build_home_snapshot({"connections": [{"capability": capability, "status": "verified", "connection_id": "openbao://private"}]})
            with self.subTest(package=package.__name__), self.assertRaises(ValueError):
                package.build_home_snapshot({"connections": [{"capability": capability, "status": "connected", "connection_id": "connection-1"}]})
            with self.subTest(package=package.__name__), self.assertRaises(ValueError):
                package.build_home_snapshot({"connections": [{"capability": "unsupported", "status": "verified", "connection_id": "connection-1"}]})
            with self.subTest(package=package.__name__), self.assertRaises(ValueError):
                package.build_home_snapshot({"connections": [{"capability": capability, "status": "verified", "connection_id": "connection-1", "extra": True}]})

    def test_outputs_without_required_connection_keep_overall_attention(self):
        template_release = json.loads((ROOT / "tests" / "fixtures" / "releases" / "ad-template-generator-v1.json").read_text(encoding="utf-8"))
        template = TEMPLATE.build_home_snapshot({"releases": [template_release]})
        self.assertEqual(template["status"], "attention")
        self.assertEqual(template["connections"]["status"], "unavailable")
        self.assertEqual(template["outputs"]["status"], "ready")

        fixture = json.loads((TOOLS / "ad-intelligence" / "fixtures" / "ad-radar-release-v1.json").read_text(encoding="utf-8"))
        radar_release = AD_RADAR.build_release(
            fixture["release_id"], fixture["version"], fixture["released_at"], fixture["project_scope"], fixture["public_export"],
            provenance_refs=tuple(fixture["provenance_refs"]), trace_refs=tuple(fixture["trace_refs"]),
            settings_revision=fixture["settings_revision"], settings_ref=fixture["settings_ref"],
            qa_receipt=fixture["qa_receipt"], sanitization_receipts=fixture["sanitization_receipts"],
        )
        radar = AD_RADAR.build_home_snapshot({"releases": [radar_release]})
        self.assertEqual(radar["status"], "attention")
        self.assertEqual(radar["connections"]["status"], "unavailable")
        self.assertEqual(radar["outputs"]["status"], "ready")

    def test_live_provider_modules_never_read_fixture_or_sample_data(self):
        for tool_id in ("ad-template-generator", "ad-intelligence", "content-factory"):
            source = (TOOLS / tool_id / "home_snapshot.py").read_text(encoding="utf-8")
            self.assertNotRegex(source, r"[\"']fixtures[\"']")
            self.assertNotRegex(source.casefold(), r"[\"']sample[\"']")


if __name__ == "__main__":
    unittest.main()
