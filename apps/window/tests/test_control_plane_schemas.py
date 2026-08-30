import copy
import hashlib
import json
import unittest
from pathlib import Path

import rfc8785
import yaml
from jsonschema import Draft202012Validator, FormatChecker

from graph.control_plane import STABLE_ID


REPO_ROOT = Path(__file__).resolve().parents[3]
CONTROL_ROOT = REPO_ROOT / "governance" / "control-plane"
SCHEMA_ROOT = CONTROL_ROOT / "schema"
FIXTURES = json.loads(
    (CONTROL_ROOT / "fixtures" / "schema-fixtures.json").read_text(encoding="utf-8")
)
SCHEMA_NAMES = {
    "catalog.schema.json",
    "graph.schema.json",
    "projection.schema.json",
    "receipt.schema.json",
    "mapping.schema.json",
    "finding.schema.json",
    "proposal.schema.json",
    "action.schema.json",
    "action-receipt.schema.json",
    "oss-decision.schema.json",
}


def load_yaml(relative: str):
    return yaml.safe_load((CONTROL_ROOT / relative).read_text(encoding="utf-8"))


def validator(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_ROOT / name).read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def valid_instances():
    state = {
        "lifecycle": "approved",
        "trust": "reviewed",
        "installation": "installed",
        "enablement": "enabled",
        "production_authority": "read_only",
    }
    receipt = {
        "id": "receipt:test/run",
        "kind": "validation",
        "subject_ids": ["project:frank"],
        "producer": "control-contract-tests",
        "source_revision_set": {"project:frank": "a" * 40},
        "deployed_revision_set": {},
        "captured_at": "2026-08-30T00:00:00Z",
        "fresh_until": None,
        "outcome": "pass",
        "evidence_uris": ["fixture:test/evidence"],
        "redaction": "secret_filtered",
    }
    action = load_yaml("actions.yaml")["actions"][0]
    return {
        "catalog.schema.json": load_yaml("catalog.yaml"),
        "graph.schema.json": {
            "schema_version": 1,
            "graph_revision": "g_" + "a" * 64,
            "nodes": [
                {
                    "id": "project:frank",
                    "kind": "project",
                    "state_axes": state,
                    "layer": "declared",
                    "evidence_receipt_ids": ["receipt:test/evidence"],
                }
            ],
            "edges": [],
            "assertions": [
                {
                    "subject_id": "project:frank",
                    "predicate": "lifecycle",
                    "scope_id": "project:frank",
                    "layer": "declared",
                    "value": "approved",
                    "evidence_receipt_ids": ["receipt:test/evidence"],
                }
            ],
        },
        "projection.schema.json": load_yaml("projections.yaml")["projections"][0],
        "receipt.schema.json": receipt,
        "mapping.schema.json": load_yaml("aliases.yaml")["external_mappings"][0],
        "finding.schema.json": {
            "id": "finding:test/drift",
            "kind": "drift",
            "subject_ids": ["project:frank"],
            "severity": "low",
            "status": "open",
            "summary": "Fixture finding",
            "reconciliation_result": "match",
            "confidence": "high",
            "evidence_receipt_ids": ["receipt:test/evidence"],
        },
        "proposal.schema.json": {
            "id": "proposal:test/change",
            "kind": "change",
            "status": "draft",
            "target_id": "project:frank",
            "expected_base_revision": "a" * 40,
            "summary": "Fixture proposal",
            "evidence_receipt_ids": ["receipt:test/evidence"],
        },
        "action.schema.json": action,
        "action-receipt.schema.json": {
            **receipt,
            "kind": "action",
            "action_id": action["id"],
            "adapter_id": action["adapter_id"],
            "adapter_version": "1.0.0",
            "adapter_hash": "sha256:" + "a" * 64,
            "target_id": "project:frank",
            "target_revision_before": None,
            "target_revision_requested": None,
            "idempotency_key": "fixture-key-1234",
            "lock_key": "control-plane",
            "started_at": receipt["captured_at"],
            "completed_at": receipt["captured_at"],
            "before_state_receipt_id": None,
            "after_state_receipt_id": "receipt:test/after",
            "preconditions": [{"name": "target_declared", "outcome": "pass"}],
            "postconditions": [{"name": "receipt_written", "outcome": "pass"}],
            "rollback_action_id": None,
            "rollback_outcome": "not_needed",
        },
        "oss-decision.schema.json": FIXTURES["valid_oss_decision"],
    }


class ControlPlaneSchemasTest(unittest.TestCase):
    def test_all_ten_are_draft_2020_12_and_meta_valid(self):
        self.assertEqual({path.name for path in SCHEMA_ROOT.glob("*.schema.json")}, SCHEMA_NAMES)
        for name in sorted(SCHEMA_NAMES):
            schema = json.loads((SCHEMA_ROOT / name).read_text(encoding="utf-8"))
            self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
            Draft202012Validator.check_schema(schema)

    def test_each_schema_accepts_a_real_valid_instance(self):
        for name, instance in valid_instances().items():
            with self.subTest(schema=name):
                self.assertEqual(list(validator(name).iter_errors(instance)), [])

    def test_each_schema_rejects_a_missing_required_field(self):
        removals = {
            "catalog.schema.json": "nodes",
            "graph.schema.json": "assertions",
            "projection.schema.json": "id",
            "receipt.schema.json": "evidence_uris",
            "mapping.schema.json": "evidence_receipt_id",
            "finding.schema.json": "evidence_receipt_ids",
            "proposal.schema.json": "expected_base_revision",
            "action.schema.json": "oss_decision_id",
            "action-receipt.schema.json": "idempotency_key",
            "oss-decision.schema.json": "search_evidence",
        }
        for name, instance in valid_instances().items():
            invalid = copy.deepcopy(instance)
            invalid.pop(removals[name])
            with self.subTest(schema=name):
                self.assertTrue(list(validator(name).iter_errors(invalid)))

    def test_frozen_ids_and_independent_state_axes_reject_drift(self):
        self.assertTrue(all(STABLE_ID.fullmatch(value) for value in FIXTURES["valid_ids"]))
        self.assertTrue(all(not STABLE_ID.fullmatch(value) for value in FIXTURES["invalid_ids"]))
        catalog_validator = validator("catalog.schema.json")
        for state in FIXTURES["invalid_states"]:
            catalog = copy.deepcopy(valid_instances()["catalog.schema.json"])
            catalog["nodes"][0]["state_axes"] = state
            self.assertTrue(list(catalog_validator.iter_errors(catalog)))

    def test_missing_evidence_and_fabricated_connection_fail(self):
        self.assertTrue(
            list(
                validator("receipt.schema.json").iter_errors(
                    FIXTURES["missing_evidence_receipt"]
                )
            )
        )
        graph = copy.deepcopy(valid_instances()["graph.schema.json"])
        graph["nodes"].append(
            {
                "id": "project:blockwise",
                "kind": "project",
                "state_axes": graph["nodes"][0]["state_axes"],
                "layer": "declared",
                "evidence_receipt_ids": ["receipt:test/evidence"],
            }
        )
        graph["nodes"].append(
            {
                "id": "capability:frank/ad-template-builder",
                "kind": "capability",
                "state_axes": graph["nodes"][0]["state_axes"],
                "layer": "declared",
                "evidence_receipt_ids": ["receipt:test/evidence"],
            }
        )
        graph["edges"].append(FIXTURES["fabricated_connection"])
        self.assertTrue(list(validator("graph.schema.json").iter_errors(graph)))

    def test_unsafe_mapping_paths_and_conditional_projection_fail(self):
        mapping_validator = validator("mapping.schema.json")
        for unsafe in (
            value
            for value in FIXTURES["unsafe_paths"]
            if "%" in value or ".." in value or "\\" in value
        ):
            mapping = copy.deepcopy(valid_instances()["mapping.schema.json"])
            mapping["destination_id_or_path"] = unsafe
            self.assertTrue(list(mapping_validator.iter_errors(mapping)), unsafe)
        self.assertTrue(
            list(
                validator("projection.schema.json").iter_errors(
                    FIXTURES["invalid_projection"]
                )
            )
        )

    def test_action_rejects_passthrough_hash_and_allowlist_failures(self):
        action_validator = validator("action.schema.json")
        base = valid_instances()["action.schema.json"]
        mutations = []
        invalid_id = copy.deepcopy(base)
        invalid_id["id"] = "action:undeclared-prefix"
        mutations.append(invalid_id)
        command = copy.deepcopy(base)
        command["arguments"]["command"] = {"type": "idempotency_key"}
        mutations.append(command)
        enabled_without_hash = copy.deepcopy(base)
        enabled_without_hash["enabled"] = True
        enabled_without_hash["adapter_hash"] = None
        mutations.append(enabled_without_hash)
        empty_allowlist = copy.deepcopy(base)
        empty_allowlist["target_allowlist"] = []
        mutations.append(empty_allowlist)
        for invalid in mutations:
            self.assertTrue(list(action_validator.iter_errors(invalid)))

    def test_oss_decision_invalid_fixtures_fail_for_named_reason(self):
        oss_validator = validator("oss-decision.schema.json")
        for mutation in FIXTURES["invalid_oss_decisions"]:
            invalid = copy.deepcopy(FIXTURES["valid_oss_decision"])
            invalid.update(mutation["override"])
            invalid["candidates"][0].update(mutation.get("candidate_override", {}))
            remove = mutation["remove"]
            if remove:
                _, index, field = remove.split(".")
                invalid["candidates"][int(index)].pop(field)
            with self.subTest(reason=mutation["name"]):
                self.assertTrue(list(oss_validator.iter_errors(invalid)))

    def test_rfc8785_serialization_is_byte_identical_across_runs(self):
        instances = valid_instances()
        first = rfc8785.dumps(instances)
        second = rfc8785.dumps(valid_instances())
        self.assertEqual(first, second)
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())


if __name__ == "__main__":
    unittest.main()
