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
        return {
            "release_id": "release-1", "content_id": "content-1", "version": 1, "immutable": True,
            "schema": "schema://frank.content-factory-release/v1", "tool_id": "content-factory",
            "project_id": "blockwise", "workspace_id": "workspace-1", "settings_revision": 3,
            "pipeline_id": "content-factory-pipeline", "pipeline_version": "1.0.0", "consumer_compatibility": ["article-release-v1"],
            "status": "published", "channel": "web", "title": "A public article",
            "body": {"format": "markdown", "content": "# Article\n\nPublic content."},
            "media": [{"id": "hero-1", "url": "https://cdn.example/hero.png", "alt_text": "Article hero", "checksum": checksum}],
            "seo": {"title": "A public article", "description": "A public description.", "canonical_url": "https://example/article"},
            "qa_receipt": {"decision": "pass", "receipt_ref": "qa-1", "checked_at": "2026-08-14T00:00:00Z"},
            "approval_receipt": {"decision": "approve", "receipt_ref": "approval-1", "decided_at": "2026-08-14T00:00:00Z"},
            "provenance": {"trace_id": "trace-1", "artifact_checksums": {"article": checksum}},
            "sanitization_receipts": {"pii_scan": {"status": "passed", "receipt_id": "pii-scan-1", "scanned_at": "2026-08-14T00:00:00Z"}, "secret_scan": {"status": "passed", "receipt_id": "secret-scan-1", "scanned_at": "2026-08-14T00:00:00Z"}},
            "published_at": "2026-08-14T00:00:00Z",
        }

    def test_home_manifest_is_exactly_seven_declarative_fields(self):
        manifest = self.load_json("home.json")
        self.assertEqual(set(manifest), {"id", "name", "kind", "blurb", "capabilities", "default_widget_ids", "connection_capabilities"})
        self.assertEqual(manifest["kind"], "tool")
        self.assertEqual(manifest["default_widget_ids"], [])
        self.assertEqual(manifest["connection_capabilities"], [])

    def test_tool_manifest_uses_shared_contract_and_fixed_acyclic_graph(self):
        manifest = self.load_json("manifest.json")
        self.assertEqual(manifest["schema"], content_factory.MANIFEST_SCHEMA)
        self.assertEqual(manifest, content_factory.CONTENT_FACTORY_MANIFEST)
        self.assertEqual(manifest["pipelines"][0]["id"], "content-factory-pipeline")
        self.assertEqual(manifest["pipelines"][0], content_factory.PROCESS_GRAPH)
        self.assertEqual(content_factory.validate_process_graph(manifest["pipelines"][0]), [])
        self.assertEqual(content_factory.validate_process_graph({**content_factory.PROCESS_GRAPH, "edges": content_factory.PROCESS_GRAPH["edges"] + [{"from": "immutable-release", "to": "source"}]}), ["graph:cycle", "graph:must-match-fixed-process-graph"])

    def test_pack_uses_connections_ids_and_contains_full_migration_map(self):
        pack = self.load_json("blockwise-pack.json")
        self.assertEqual(content_factory.validate_pack(pack), [])
        self.assertTrue(all("connection_id" in target and "target_id" in target for target in pack["publication_targets"]))
        self.assertNotIn("secret-ref", json.dumps(pack["publication_targets"]))
        migration = pack["migration_map"]
        for key in ("operator_ui", "operator_api", "operator_lib", "tests", "hermes_runtime", "skill_groups", "public_content_tables", "data_policy"):
            self.assertIn(key, migration)
        self.assertEqual(migration["public_content_tables"], ["prompt_sets", "prompt_templates", "prompt_set_items", "content_runs", "content_artifacts", "prompt_runs", "content_reviews", "operator_approvals"])
        self.assertTrue(migration["data_policy"]["adopt_only_after_row_count_match"])

    def test_run_request_requires_versioned_stage_prompts(self):
        request = {"project_id": "blockwise", "content_id": "content-1", "pack_ref": "blockwise-content-factory-pack", "channels": ["web"], "model_policy": {}, "thresholds": {}, "prompt_refs": {"draft": {"ref": "writer"}}}
        self.assertIn("prompt_refs:each-stage-needs-ref-and-version", content_factory.validate_run_request(request))

    def test_commands_and_events_are_allowlisted_and_safe(self):
        command = content_factory.build_command("run", {"run_id": "run-1"}, "correlation-1")
        event = content_factory.build_event("stage-completed", {"stage": "draft"}, "correlation-1")
        self.assertEqual(command["kind"], "command")
        self.assertEqual(event["kind"], "event")
        self.assertEqual(command["action"], "run")
        self.assertEqual(event["event_kind"], "stage-completed")
        with self.assertRaises(ValueError):
            content_factory.build_command("arbitrary-execute", {}, "correlation-1")
        with self.assertRaises(ValueError):
            content_factory.build_event("stage-completed", {"html": "<script>"}, "correlation-1")

    def test_public_release_requires_approval_and_provenance(self):
        release = content_factory.public_release(self.valid_release())
        self.assertTrue(release["immutable"])
        self.assertEqual(len(release["release_hash"]), 64)
        missing_approval = self.valid_release()
        del missing_approval["approval_receipt"]
        with self.assertRaises(ValueError):
            content_factory.public_release(missing_approval)
        missing_qa = self.valid_release()
        del missing_qa["qa_receipt"]
        with self.assertRaises(ValueError):
            content_factory.public_release(missing_qa)

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
