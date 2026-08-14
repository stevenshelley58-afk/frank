import json
import re
import unittest
from pathlib import Path


TOOLS = Path(__file__).parents[1] / "tools"
TOOL_NAMES = ("prospect-discovery", "outreach", "mail")


def load_manifest(name):
    with (TOOLS / name / "manifest.json").open(encoding="utf-8") as manifest_file:
        return json.load(manifest_file)


def load_home_manifest(name):
    with (TOOLS / name / "home.json").open(encoding="utf-8") as manifest_file:
        return json.load(manifest_file)


def walk_values(value, key=""):
    yield key, value
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            yield from walk_values(child_value, child_key)
    elif isinstance(value, list):
        for child_value in value:
            yield from walk_values(child_value, key)


class ToolBoundaryContractsTest(unittest.TestCase):
    def test_each_tool_owns_an_exactly_shaped_declarative_home_manifest(self):
        expected_fields = {
            "id", "name", "kind", "blurb", "capabilities",
            "default_widget_ids", "connection_capabilities",
        }
        expected_connections = {
            "prospect-discovery": ["public-source-read"],
            "outreach": ["campaign-management", "segment-management", "outbound-delivery"],
            "mail": ["mail-read", "mail-receipts", "mail-events"],
        }
        for name in TOOL_NAMES:
            home = load_home_manifest(name)
            self.assertEqual(set(home), expected_fields)
            self.assertEqual(home["id"], name)
            self.assertEqual(home["kind"], "tool")
            self.assertEqual(home["default_widget_ids"], [])
            self.assertEqual(home["connection_capabilities"], expected_connections[name])
            for field in ("capabilities", "default_widget_ids", "connection_capabilities"):
                self.assertIsInstance(home[field], list)

    def test_three_packages_are_separate_and_complete(self):
        for name in TOOL_NAMES:
            manifest = load_manifest(name)
            self.assertEqual(manifest["schema"], "schema://frank.tool-app-manifest/v1")
            self.assertTrue(manifest["name"])
            self.assertTrue(manifest["description"])
            self.assertTrue(manifest["scopes"])
            self.assertEqual(manifest["settings"]["schema"], "schema://frank.tool-app-settings/v1")
            self.assertIsInstance(manifest["settings"]["properties"], dict)
            for collection in ("capabilities", "connectors", "schedules", "thresholds", "approval_gates"):
                self.assertIsInstance(manifest[collection], list)
            for pipeline in manifest["pipelines"]:
                self.assertEqual(pipeline["schema"], "schema://frank.tool-app-pipeline/v1")
                node_ids = {node["id"] for node in pipeline["nodes"]}
                self.assertEqual(len(node_ids), len(pipeline["nodes"]))
                self.assertTrue(all(re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", node_id) for node_id in node_ids))
                adjacency = {node_id: [] for node_id in node_ids}
                for edge in pipeline["edges"]:
                    self.assertIn(edge["from"], node_ids)
                    self.assertIn(edge["to"], node_ids)
                    self.assertNotEqual(edge["from"], edge["to"])
                    adjacency[edge["from"]].append(edge["to"])
                visiting = set()
                visited = set()

                def visit(node_id):
                    self.assertNotIn(node_id, visiting, "pipeline graph must be acyclic")
                    if node_id in visited:
                        return
                    visiting.add(node_id)
                    for child in adjacency[node_id]:
                        visit(child)
                    visiting.remove(node_id)
                    visited.add(node_id)

                for node_id in node_ids:
                    visit(node_id)
            self.assertEqual(manifest["id"], name)
            self.assertNotIn("commands", manifest["hermes"])
            self.assertNotIn("events", manifest["hermes"])
            self.assertTrue(all(re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", action) for action in manifest["hermes"]["actions"]))
            self.assertTrue(all(re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", kind) for kind in manifest["hermes"]["event_kinds"]))
            for section in ("settings", "trace", "health", "hermes"):
                self.assertIn(section, manifest)

    def test_prospect_discovery_stops_at_evidence_and_qualification(self):
        manifest = load_manifest("prospect-discovery")
        self.assertEqual(manifest["data_boundary"]["ad_intelligence"], "stable_subject_ref_only")
        self.assertIn("delivery-request", manifest["hermes"]["forbidden_actions"])
        self.assertNotIn("consent", manifest["data_boundary"]["owns"])
        qualification = manifest["settings"]["properties"]["qualification_policy"]["properties"]
        for field in ("prompt_ref", "prompt_version", "model_policy", "confidence_threshold", "evidence_threshold"):
            self.assertIn(field, qualification)

    def test_outreach_requires_immediate_policy_and_suppression_gate(self):
        manifest = load_manifest("outreach")
        policy = manifest["delivery_policy"]
        self.assertFalse(policy["scraped_availability_is_consent"])
        self.assertTrue(policy["list_unsubscribe"]["one_click"])
        self.assertEqual(policy["send_gate_timing"], "all_checks_must_run_immediately_before_outreach_delivery_request")
        for required in ("approval", "legal_basis_evidence", "policy_check", "project_suppression_check", "global_suppression_check"):
            self.assertIn(required, policy["send_gate"])
        self.assertIn("delivery-request", manifest["hermes"]["actions"])
        self.assertIn("action-receipt-ref", manifest["hermes"]["actions"])
        self.assertNotIn("ledger-record", manifest["hermes"]["actions"])
        self.assertIn("delivery-request", manifest["capabilities"])
        for gate in ("approval", "legal-basis", "project-suppression", "global-suppression", "quiet-hours", "idempotency", "connection-capability"):
            self.assertIn(gate, manifest["approval_gates"])
        self.assertIn("raw-send", manifest["hermes"]["forbidden_actions"])
        self.assertNotIn("provider-send", manifest["hermes"]["actions"])
        self.assertIn("delivery-requested", manifest["hermes"]["event_kinds"])
        self.assertNotIn("replies", manifest["data_boundary"]["owns"])
        self.assertNotIn("bounces", manifest["data_boundary"]["owns"])
        self.assertNotIn("complaints", manifest["data_boundary"]["owns"])
        self.assertNotIn("send_ledger", manifest["data_boundary"]["owns"])
        self.assertNotIn("send_ledger", manifest["data_boundary"]["never_owns"])
        self.assertIn("connection_action_receipt_refs", manifest["data_boundary"]["consumes"])
        self.assertIn("action_receipt_projection_available", manifest["health"]["checks"])
        self.assertIn("action-receipt-referenced", manifest["trace"]["event_kinds"])

    def test_mail_is_provider_neutral_and_cannot_send(self):
        manifest = load_manifest("mail")
        self.assertIn("canonical_thread_projections", manifest["data_boundary"]["owns"])
        self.assertIn("canonical_message_projections", manifest["data_boundary"]["owns"])
        for event in ("reply_events", "bounce_events", "complaint_events", "unsubscribe_events", "delivery_receipts"):
            self.assertIn(event, manifest["data_boundary"]["owns"])
        self.assertNotIn("raw-send", manifest["hermes"]["actions"])
        self.assertIn("raw-send", manifest["hermes"]["forbidden_actions"])
        self.assertIn("compose-intent", manifest["hermes"]["actions"])
        self.assertIn("reply-intent", manifest["hermes"]["actions"])
        self.assertIn("provider_raw_message_bodies", manifest["data_boundary"]["never_owns"])

    def test_ad_intelligence_never_becomes_a_pii_surface(self):
        for name in TOOL_NAMES:
            manifest = load_manifest(name)
            self.assertEqual(manifest["data_boundary"]["ad_intelligence"], "stable_subject_ref_only")
            self.assertNotIn("pii", manifest["data_boundary"]["ad_intelligence"])
            self.assertFalse(manifest["data_boundary"]["prospect_records_in_ad_evidence"])
            self.assertFalse(manifest["data_boundary"]["prospect_records_in_public_exports"])

    def test_settings_only_select_non_secret_connections_and_prompt_refs(self):
        for name in TOOL_NAMES:
            manifest = load_manifest(name)
            for key, value in walk_values(manifest["settings"]):
                self.assertNotIn(key.lower(), {"vault_ref", "provider_ref", "credentials", "api_key", "token", "password"})
                if isinstance(value, str):
                    self.assertNotIn("vault_ref", value.lower())
            if name == "outreach":
                draft = manifest["settings"]["properties"]["personalized_draft"]["properties"]
                self.assertIn("prompt_ref", draft)
                self.assertIn("prompt_version", draft)
                self.assertNotIn("prompt", draft)
                self.assertNotIn("provider_ref", draft)
            classification = manifest["settings"]["properties"].get("reply_classification", {}).get("properties", {})
            if "model_policy" in classification:
                self.assertIn("prompt_ref", classification)
                self.assertIn("prompt_version", classification)
            connection = manifest["settings"]["properties"]["connection"]["properties"] if "connection" in manifest["settings"]["properties"] else {}
            if connection:
                self.assertIn("connection_id", connection)
                self.assertIn("capability", connection)

    def test_trace_contract_uses_otel_and_has_boundary_events(self):
        for name in TOOL_NAMES:
            trace = load_manifest(name)["trace"]
            self.assertEqual(trace["schema"], "schema://frank.tool-app-trace/v1")
            self.assertEqual(trace["instrumentation"], "opentelemetry")
            self.assertIn("event_kinds", trace)
            self.assertTrue(all(re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", kind) for kind in trace["event_kinds"]))
            self.assertTrue(trace["span_prefix"].startswith("frank."))
            self.assertTrue(trace["event_kinds"])


if __name__ == "__main__":
    unittest.main()
