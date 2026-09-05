import json
from pathlib import Path
import sys
import unittest


TOOL_DIR = Path(__file__).parents[1] / "tools" / "content-factory"
sys.path.insert(0, str(TOOL_DIR))
import content_factory  # noqa: E402


class ContentFactoryToolTests(unittest.TestCase):
    def load_json(self, name):
        return json.loads((TOOL_DIR / name).read_text(encoding="utf-8"))

    def valid_release(self):
        checksum = "a" * 64
        body = {"format": "markdown", "content": "# Article\n\nPublic content."}
        seo = {"title": "A public article", "description": "A public description.", "canonical_url": "https://example/article"}
        return {
            "release_id": "release-1", "content_id": "content-1", "version": 1, "immutable": True,
            "schema": "schema://frank.content-factory-release/v1", "tool_id": "content-factory",
            "project_id": "blockwise", "workspace_id": "123e4567-e89b-42d3-a456-426614174000", "settings_revision": 3,
            "pipeline_id": "blog-studio-v2", "pipeline_version": "2.0.0", "consumer_compatibility": ["article-release-v1"],
            "status": "published", "channel": "web", "title": "A public article",
            "body": body,
            "media": [{"id": "hero-1", "url": "https://cdn.example/hero.png", "alt_text": "Article hero", "checksum": checksum}],
            "seo": seo,
            "qa_receipt": {"decision": "pass", "receipt_ref": "qa-1", "checked_at": "2026-08-14T00:00:00Z"},
            "approval_receipt": {"decision": "approve", "receipt_ref": "approval-1", "decided_at": "2026-08-14T00:00:00Z"},
            "provenance": {"trace_id": "trace-1", "artifact_checksums": {"body": content_factory.canonical_sha256(body), "seo": content_factory.canonical_sha256(seo), "media:hero-1": checksum}},
            "sanitization_receipts": {"pii_scan": {"status": "passed", "receipt_id": "pii-scan-1", "scanned_at": "2026-08-14T00:00:00Z"}, "secret_scan": {"status": "passed", "receipt_id": "secret-scan-1", "scanned_at": "2026-08-14T00:00:00Z"}},
            "published_at": "2026-08-14T00:00:00Z",
        }

    def valid_run_request(self):
        return {
            "project_id": "blockwise",
            "content_id": "content-1",
            "job_name": "A useful field guide",
            "topic": "Why local evidence creates a better seller conversation",
            "source_bundle": {
                "text": "Source material",
                "text_length": 15,
                "urls": [{"url": "https://example.com/source", "title": "Source"}],
                "attachments": [],
            },
            "direction": {
                "audience": "Australian real-estate operators",
                "outcome": "Understand the decision",
                "cta": "Create three ads free",
                "locale": "en-AU",
                "must_include": "Evidence",
                "must_avoid": "Unsupported certainty",
                "slug": "local-evidence",
            },
            "outputs": {
                "length": "deep",
                "research_mode": "verify-enrich",
                "media": "briefs",
                "companions": ["email", "social"],
                "publication_target_id": "blockwise-guides",
            },
            "project_context": "Resolved project context",
        }

    def test_home_manifest_is_exactly_seven_declarative_fields(self):
        manifest = self.load_json("home.json")
        self.assertEqual(set(manifest), {"id", "name", "kind", "blurb", "capabilities", "default_widget_ids", "connection_capabilities"})
        self.assertEqual(manifest["kind"], "tool")
        self.assertEqual(manifest["id"], "content-factory")
        self.assertEqual(manifest["name"], "Blog Studio")
        self.assertEqual(manifest["default_widget_ids"], [])
        self.assertEqual(manifest["connection_capabilities"], [])

    def test_tool_manifest_uses_shared_contract_and_fixed_acyclic_graph(self):
        manifest = self.load_json("manifest.json")
        self.assertEqual(manifest["schema"], content_factory.MANIFEST_SCHEMA)
        self.assertEqual(manifest, content_factory.CONTENT_FACTORY_MANIFEST)
        self.assertEqual(manifest["version"], "2.0.0")
        self.assertEqual(manifest["pipelines"][0]["id"], "blog-studio-v2")
        self.assertEqual(
            [node["id"] for node in manifest["pipelines"][0]["nodes"]],
            ["source", "research", "brief", "draft", "edit", "package", "qa", "human-approval", "immutable-release"],
        )
        self.assertEqual(manifest["pipelines"][0], content_factory.PROCESS_GRAPH)
        self.assertEqual(content_factory.validate_process_graph(manifest["pipelines"][0]), [])
        self.assertEqual(content_factory.validate_process_graph({**content_factory.PROCESS_GRAPH, "edges": content_factory.PROCESS_GRAPH["edges"] + [{"from": "immutable-release", "to": "source"}]}), ["graph:cycle", "graph:must-match-fixed-process-graph"])

    def test_taxonomy_and_gates_match_blog_studio_v2(self):
        manifest = self.load_json("manifest.json")
        self.assertEqual(set(content_factory.ARTIFACT_TAXONOMY), {
            "source", "research", "brief", "draft", "edit", "package", "qa",
            "human-approval", "immutable-release",
        })
        self.assertIn("qa_report", content_factory.ARTIFACT_TAXONOMY["qa"])
        self.assertIn("approval_receipt", content_factory.ARTIFACT_TAXONOMY["human-approval"])
        self.assertIn("article_release", content_factory.ARTIFACT_TAXONOMY["immutable-release"])
        gates = {gate["id"]: gate for gate in manifest["approval_gates"]}
        self.assertEqual(set(gates), {"qa", "human-approval", "immutable-release"})
        self.assertEqual(set(gates["immutable-release"]["requires"]), {"qa", "human-approval"})
        self.assertEqual(set(gates["human-approval"]["actions"]), {"approve", "request_changes", "reject", "quarantine"})
        self.assertEqual(
            set(manifest["hermes"]["event_kinds"]),
            {
                "command.accepted", "command.queued", "run.started", "run.recovered",
                "run.interrupted", "run.resumed", "run.rerun", "run.completed",
                "run.failed", "run.cancelled", "run.quarantined", "stage.started",
                "stage.completed", "artifact.created", "review.requested",
                "review.recorded", "review.approved", "review.changes-requested",
                "review.rejected", "provider.attempt", "provider.fallback",
                "tool.started", "tool.completed", "subagent.start", "subagent.complete",
                "release.created", "release.published", "release.withdrawn",
            },
        )
        encoded = json.dumps(manifest).lower()
        self.assertNotIn('"prompt_refs"', encoded)
        self.assertNotIn('"model_policy"', encoded)

    def test_pack_uses_connections_ids_and_revision_pinned_legacy_adoption(self):
        pack = self.load_json("blockwise-pack.json")
        self.assertEqual(content_factory.validate_pack(pack), [])
        self.assertTrue(all("connection_id" in target and "target_id" in target for target in pack["publication_targets"]))
        self.assertNotIn("secret-ref", json.dumps(pack["publication_targets"]))
        self.assertEqual(pack["process_graph_ref"], "blog-studio-v2")
        self.assertEqual(pack["legacy_source"]["last_complete_revision"], "8cf9215add735f5bac1d14eece3b38de2ff93e37")
        self.assertTrue(pack["adoption"]["data_policy"]["adopt_only_after_row_count_match"])
        encoded = json.dumps(pack).lower()
        self.assertNotIn('"prompt_refs"', encoded)
        self.assertNotIn('"model_policy"', encoded)

    def test_run_request_is_closed_and_leaves_orchestration_to_hermes(self):
        request = self.valid_run_request()
        self.assertEqual(content_factory.validate_run_request(request), [])

        legacy = {**request, "pack_ref": "legacy", "prompt_refs": {}, "model_policy": {}}
        errors = content_factory.validate_run_request(legacy)
        self.assertIn("unsupported:pack_ref", errors)
        self.assertIn("unsupported:prompt_refs", errors)
        self.assertIn("unsupported:model_policy", errors)
        self.assertIn("orchestration:hermes-owned", errors)

        hidden = self.valid_run_request()
        hidden["direction"]["model"] = "private-router"
        self.assertIn("orchestration:hermes-owned", content_factory.validate_run_request(hidden))

        topic_only = self.valid_run_request()
        topic_only["source_bundle"] = {}
        self.assertEqual(content_factory.validate_run_request(topic_only), [])

    def test_run_request_validates_structured_outputs_and_source_bundle(self):
        bad = self.valid_run_request()
        bad["outputs"] = {"length": "novel", "companions": ["ads"]}
        bad["source_bundle"] = {"urls": ["https://example.com/source?access_token=secret"]}
        errors = content_factory.validate_run_request(bad)
        self.assertIn("outputs:length-unsupported", errors)
        self.assertIn("outputs:companions-unsupported", errors)
        self.assertTrue(any("token-like query" in error for error in errors))

    def test_commands_and_events_are_allowlisted_and_safe(self):
        command = content_factory.build_command("run", self.valid_run_request(), "correlation-1")
        event = content_factory.build_event("stage.completed", {"stage": "draft"}, "correlation-1")
        self.assertEqual(command["kind"], "command")
        self.assertEqual(event["kind"], "event")
        self.assertEqual(command["action"], "run")
        self.assertEqual(event["event_kind"], "stage.completed")
        review_command = content_factory.build_command("request_changes", {"run_id": "run-1"}, "correlation-1")
        self.assertEqual(review_command["action"], "request_changes")
        with self.assertRaises(ValueError):
            content_factory.build_command("arbitrary-execute", {}, "correlation-1")
        with self.assertRaises(ValueError):
            content_factory.build_command("run", {"project_id": "blockwise"}, "correlation-1")
        with self.assertRaises(ValueError):
            content_factory.build_event("stage.completed", {"html": "<script>"}, "correlation-1")

    def test_public_release_requires_approval_and_provenance(self):
        release = content_factory.public_release(self.valid_release())
        self.assertTrue(release["immutable"])
        self.assertEqual(release["provenance"]["artifact_checksums"]["body"], "e3c8a183c1ea4ac90727ae984b3ff7d97f0e3bd386523970adbc3f6a30874d7f")
        self.assertEqual(release["provenance"]["artifact_checksums"]["seo"], "26fa6a3578413037c4f44f88247ed69dedc71e3c0727ea589aa3e0c318486791")
        self.assertEqual(release["release_hash"], "aa3f56db298d16fac0f4e2d9d00d9c9c88de20d53c3dce457b7bc8b12c47309a")
        fixture = self.load_json("fixtures/content-release-v1.json")
        self.assertEqual(release, fixture)
        missing_approval = self.valid_release()
        del missing_approval["approval_receipt"]
        with self.assertRaises(ValueError):
            content_factory.public_release(missing_approval)
        missing_qa = self.valid_release()
        del missing_qa["qa_receipt"]
        with self.assertRaises(ValueError):
            content_factory.public_release(missing_qa)
        bad_artifact_hash = self.valid_release()
        bad_artifact_hash["provenance"]["artifact_checksums"]["body"] = "b" * 64
        with self.assertRaises(ValueError):
            content_factory.public_release(bad_artifact_hash)
        missing_compatibility = self.valid_release()
        missing_compatibility["consumer_compatibility"] = ["some-other-consumer-v1"]
        with self.assertRaises(ValueError):
            content_factory.public_release(missing_compatibility)

    def test_public_release_schema_is_closed_and_matches_manifest(self):
        schema = self.load_json("release.schema.json")
        manifest = self.load_json("manifest.json")
        self.assertEqual(schema["$id"], manifest["release_schema"])
        self.assertFalse(schema["additionalProperties"])
        for definition in schema["$defs"].values():
            self.assertFalse(definition["additionalProperties"])

    def test_public_release_rejects_extra_nested_contract_fields(self):
        cases = (
            ("body", "draft_notes"),
            ("seo", "keywords"),
            ("qa_receipt", "operator"),
            ("approval_receipt", "reason"),
            ("provenance", "source"),
        )
        for section, field in cases:
            with self.subTest(section=section, field=field):
                invalid = self.valid_release()
                invalid[section][field] = "not-public"
                with self.assertRaises(ValueError):
                    content_factory.public_release(invalid)

    def test_public_release_rejects_type_time_and_identity_ambiguity(self):
        cases = (
            ("settings_revision", True),
            ("version", True),
            ("published_at", "yesterday"),
        )
        for field, value in cases:
            with self.subTest(field=field):
                invalid = self.valid_release()
                invalid[field] = value
                with self.assertRaises(ValueError):
                    content_factory.public_release(invalid)

        invalid_trace = self.valid_release()
        invalid_trace["provenance"]["trace_id"] = 123
        with self.assertRaises(ValueError):
            content_factory.public_release(invalid_trace)

        invalid_alt = self.valid_release()
        invalid_alt["media"][0]["alt_text"] = 123
        with self.assertRaises(ValueError):
            content_factory.public_release(invalid_alt)

        invalid_summary = self.valid_release()
        invalid_summary["summary"] = {"text": "not-a-string"}
        with self.assertRaises(ValueError):
            content_factory.public_release(invalid_summary)

        duplicate_media = self.valid_release()
        duplicate_media["media"].append(dict(duplicate_media["media"][0]))
        with self.assertRaises(ValueError):
            content_factory.public_release(duplicate_media)

        invalid_receipt_time = self.valid_release()
        invalid_receipt_time["approval_receipt"]["decided_at"] = "2026-08-14"
        with self.assertRaises(ValueError):
            content_factory.public_release(invalid_receipt_time)

    def test_public_release_rejects_nested_leakage(self):
        leaked = self.valid_release()
        leaked["body"]["sections"] = [{"private_notes": "do not publish"}]
        with self.assertRaises(ValueError):
            content_factory.public_release(leaked)
        leaked = self.valid_release()
        leaked["media"][0]["model_input"] = {"prompt": "private"}
        with self.assertRaises(ValueError):
            content_factory.public_release(leaked)
        leaked = self.valid_release()
        leaked["body"]["metadata"] = {"customer_email": "person@example.com"}
        with self.assertRaises(ValueError):
            content_factory.public_release(leaked)
        leaked = self.valid_release()
        leaked["body"]["metadata"] = {"model_ref": "private-model"}
        with self.assertRaises(ValueError):
            content_factory.public_release(leaked)
        leaked = self.valid_release()
        leaked["body"]["metadata"] = {"contactEmail": "person@example.com"}
        with self.assertRaises(ValueError):
            content_factory.public_release(leaked)

    def test_public_release_rejects_bad_producer_status_and_urls(self):
        for field, value in (("schema", "schema://wrong"), ("tool_id", "other-tool"), ("status", "approved"), ("pipeline_id", "other-pipeline")):
            invalid = self.valid_release()
            invalid[field] = value
            with self.assertRaises(ValueError):
                content_factory.public_release(invalid)
        invalid = self.valid_release()
        invalid["media"][0]["url"] = "https://user:pass@example.invalid/image.png"
        with self.assertRaises(ValueError):
            content_factory.public_release(invalid)
        invalid = self.valid_release()
        invalid["seo"]["canonical_url"] = "https://example.invalid/article?access_token=secret"
        with self.assertRaises(ValueError):
            content_factory.public_release(invalid)

    def test_approval_receipt_does_not_publish_reviewer_identity(self):
        invalid = self.valid_release()
        invalid["approval_receipt"]["reviewer_ref"] = "operator-1"
        with self.assertRaises(ValueError):
            content_factory.public_release(invalid)

    def test_withdrawal_is_a_separate_signed_tombstone(self):
        release = content_factory.public_release(self.valid_release())
        tombstone = content_factory.build_withdrawal_tombstone(tombstone_id="tombstone-1", release_id=release["release_id"], release_hash=release["release_hash"], signed_by="operator-1", signature="signature-ref-1", withdrawn_at="2026-08-14T01:00:00Z")
        self.assertEqual(tombstone["release_hash"], release["release_hash"])
        self.assertNotIn("withdrawn_at", release)


if __name__ == "__main__":
    unittest.main()
