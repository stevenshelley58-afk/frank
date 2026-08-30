import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from graph.control_pipeline import _merge_facts, materialize
from graph.control_contract import ControlContractError, materialize_control_graph
from scripts.control_reconcile import atomic_json


class ControlPipelineTests(unittest.TestCase):
    def test_missing_full_is_typed_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(materialize(tmp), {"status": "empty", "scope": "full"})

    def test_fast_replaces_only_runtime_facts(self):
        full = {"identity": {"v": 1}, "compose": {"old": 1}, "capabilities": {"keep": 1}}
        fast = {"compose": {"new": 2}, "capabilities": {"must_not": 2}}
        self.assertEqual(_merge_facts(full, fast), {
            "identity": {"v": 1}, "compose": {"new": 2}, "capabilities": {"keep": 1}
        })

    def test_pointer_tamper_and_traversal_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "reconciliations"
            root.mkdir()
            outside = Path(tmp) / "outside"
            outside.mkdir()
            atomic_json(outside / "receipt.json", {})
            atomic_json(root / "latest-full.json", {"receipt": "../outside/receipt.json", "receipt_hash": "x"})
            with self.assertRaises(Exception):
                materialize(tmp)

    def test_materialization_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "reconciliations"
            run = root / "full-run"
            run.mkdir(parents=True)
            catalog = {"nodes": [{"id": "project:frank", "kind": "project", "state_axes": {}}], "relationships": []}
            facts = {"identity": {}}
            for name, value in (("declared.json", {"catalog": catalog}), ("observed.json", {"facts": facts}), ("findings.json", {"findings": []})):
                atomic_json(run / name, value)
            receipt = {"id": "receipt:reconciliation/full-run", "kind": "reconciliation",
                       "subject_ids": ["vps:dedicated"], "producer": "fixture",
                       "source_revision_set": {"project:frank": "fixture"},
                       "deployed_revision_set": {"project:frank": "fixture"},
                       "captured_at": "2099-01-01T00:00:00Z", "fresh_until": "2099-01-02T00:00:00Z",
                       "outcome": "pass", "evidence_uris": ["fixture://full-run"],
                       "redaction": "secret_filtered", "status": "success", "scope": "full",
                       "receipt_id": "receipt:reconciliation/full-run", "facts": facts,
                       "artifact_hashes": {name: hashlib.sha256((run / name).read_bytes()).hexdigest() for name in ("declared.json", "observed.json", "findings.json")}}
            atomic_json(run / "receipt.json", receipt)
            atomic_json(root / "latest-full.json", {"receipt": "full-run/receipt.json", "receipt_hash": hashlib.sha256((run / "receipt.json").read_bytes()).hexdigest()})
            generated = materialize_control_graph({"nodes": [], "relationships": []})
            with patch("graph.control_pipeline.graph_from_collector_receipt", return_value=generated):
                first = materialize(tmp)
                second = materialize(tmp)
            self.assertEqual(first["graph_revision"], second["graph_revision"])

    def test_expired_full_receipt_is_rejected_before_materialization(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "reconciliations"
            run = root / "full-run"
            run.mkdir(parents=True)
            catalog = {"nodes": [{"id": "project:frank", "kind": "project", "state_axes": {}}], "relationships": []}
            facts = {"identity": {}}
            for name, value in (("declared.json", {"catalog": catalog}), ("observed.json", {"facts": facts}), ("findings.json", {"findings": []})):
                atomic_json(run / name, value)
            receipt = {
                "id": "receipt:reconciliation/full-run", "kind": "reconciliation",
                "subject_ids": ["vps:dedicated"], "producer": "fixture",
                "source_revision_set": {"project:frank": "fixture"},
                "deployed_revision_set": {"project:frank": "fixture"},
                "captured_at": "2020-01-01T00:00:00Z", "fresh_until": "2020-01-02T00:00:00Z",
                "outcome": "pass", "evidence_uris": ["fixture://full-run"],
                "redaction": "secret_filtered", "status": "success", "scope": "full",
                "receipt_id": "receipt:reconciliation/full-run", "facts": facts,
                "artifact_hashes": {name: hashlib.sha256((run / name).read_bytes()).hexdigest() for name in ("declared.json", "observed.json", "findings.json")},
            }
            atomic_json(run / "receipt.json", receipt)
            atomic_json(root / "latest-full.json", {"receipt": "full-run/receipt.json", "receipt_hash": hashlib.sha256((run / "receipt.json").read_bytes()).hexdigest()})
            with self.assertRaises(ControlContractError):
                materialize(tmp)


if __name__ == "__main__":
    unittest.main()
