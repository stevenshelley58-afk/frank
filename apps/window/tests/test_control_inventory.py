import tempfile
import unittest
from pathlib import Path
import sys
import yaml
import json
from unittest.mock import patch

from jsonschema import Draft202012Validator

WINDOW = Path(__file__).resolve().parents[1]
if str(WINDOW) not in sys.path:
    sys.path.insert(0, str(WINDOW))

from graph.control_inventory import (
    AllowlistedSourceMatrix,
    InventoryError,
    SourceAdapter,
    canonical_inventory,
    extract_record,
    inventory,
    load_exclusions,
    _git_head,
)


class ControlInventoryTests(unittest.TestCase):
    def test_inaccessible_git_marker_is_an_unavailable_revision(self):
        with patch.object(Path, "exists", side_effect=PermissionError("denied")):
            self.assertIsNone(_git_head(Path("/root/.claude")))

    def test_all_required_kinds_and_metadata_are_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "sources"
            root.mkdir()
            adapters = []
            kinds = ("rule", "skill", "plugin", "cli", "mcp", "app", "template", "library", "hook", "ci_gate", "runtime_policy", "runbook")
            for kind in kinds:
                path = root / f"{kind}.md"
                path.write_text(f"# {kind.title()}\nsecret=do-not-persist\n", encoding="utf-8")
                adapters.append(SourceAdapter(f"adapter-{kind.replace('_', '-')}", root, kind, (path.name,), "repo", "receipt:test/inventory", oss_decision_id="receipt:oss-decision/custom-adapters"))
            # Each fixture has a unique adapter, so overlapping roots remain closed.
            result = inventory(AllowlistedSourceMatrix(adapters), source_revision="a" * 40, prior_audit_counts={"rule": 51})
            self.assertEqual(result["record_count"], len(kinds))
            self.assertEqual(result["prior_audit_counts_candidates"]["rule"], 51)
            self.assertEqual(result["aliases"]["grilling"], "unknown_after_bounded_search")
            self.assertEqual(canonical_inventory(result), canonical_inventory(result))
            for record in result["records"]:
                self.assertIn("content_hash", record)
                self.assertNotIn("do-not-persist", str(record))
                self.assertEqual(record["oss_decision_id"], "receipt:oss-decision/custom-adapters")

    def test_rejects_unknown_parent_symlink_and_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "allow"; root.mkdir()
            (root / "ok.md").write_text("# OK", encoding="utf-8")
            (root / "cache").mkdir(); (root / "cache" / "bad.md").write_text("# bad", encoding="utf-8")
            outside = base / "outside.md"; outside.write_text("# outside", encoding="utf-8")
            try:
                (root / "escape.md").symlink_to(outside)
            except OSError:
                # Windows test runners without symlink privilege still cover
                # the same rejection through the out-of-root path assertion.
                pass
            matrix = AllowlistedSourceMatrix((SourceAdapter("r", root, "rule", ("*.md",), oss_decision_id="receipt:oss-decision/custom-adapters"),))
            self.assertEqual(len(matrix.files()), 1)
            with self.assertRaises(InventoryError):
                matrix.adapter_for(base / "unknown.md")
            with self.assertRaises(InventoryError):
                matrix.adapter_for(root / ".." / "outside.md")

    def test_extract_has_no_body_and_has_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rule.md"; path.write_text("# Rule\nInstructions: never store this body", encoding="utf-8")
            adapter = SourceAdapter("rule", Path(tmp), "rule", ("rule.md",), evidence_receipt_id="receipt:test/source", oss_decision_id="receipt:oss-decision/custom-adapters")
            record = extract_record(path, adapter, source_revision="a" * 40)
            self.assertEqual(record["content_hash"], "sha256:" + __import__("hashlib").sha256(path.read_bytes()).hexdigest())
            self.assertNotIn("never store this body", record["eli5"])
            self.assertEqual(record["evidence_receipt_ids"], ["receipt:test/source"])

    def test_path_qualified_ids_and_overlap_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "a").mkdir(); (root / "b").mkdir()
            left = root / "a" / "same.md"; right = root / "b" / "same.md"
            left.write_text("# Alpha", encoding="utf-8"); right.write_text("# Beta", encoding="utf-8")
            matrix = AllowlistedSourceMatrix((SourceAdapter("specific", root, "rule", ("a/same.md",), oss_decision_id="receipt:oss-decision/custom-adapters"), SourceAdapter("broad", root, "rule", ("**/*.md",), oss_decision_id="receipt:oss-decision/custom-adapters")))
            self.assertNotEqual(extract_record(left, matrix.adapter_for(left), source_revision="a" * 40)["id"], extract_record(right, matrix.adapter_for(right), source_revision="a" * 40)["id"])
            self.assertEqual(matrix.adapter_for(left).adapter_id, "specific")

    def test_declared_matrix_does_not_trust_caller_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            declaration = Path(tmp) / "source-adapters.yaml"
            declaration.write_text("closed_world: true\nadapters:\n  - id: bad\n    root: relative\n    classes: [rule]\n    patterns: ['**/*.md']\n", encoding="utf-8")
            with self.assertRaises(InventoryError):
                from graph.control_inventory import matrix_from_declarations
                matrix_from_declarations(declaration, Path(tmp))

    def test_repository_matrix_is_deterministic_and_canonical(self):
        from graph.control_inventory import matrix_from_declarations
        repo = Path(__file__).resolve().parents[3]
        declaration = repo / "governance" / "control-plane" / "source-adapters.yaml"
        matrix = matrix_from_declarations(declaration, repo)
        first = inventory(matrix)
        second = inventory(matrix)
        self.assertGreater(first["record_count"], 0)
        self.assertEqual(canonical_inventory(first), canonical_inventory(second))
        self.assertTrue(all(r["source_locator"].startswith("/projects/frank/") for r in first["records"]))

    def test_records_are_catalog_capabilities(self):
        from graph.control_inventory import matrix_from_declarations
        repo = Path(__file__).resolve().parents[3]
        matrix = matrix_from_declarations(repo / "governance" / "control-plane" / "source-adapters.yaml", repo)
        records = inventory(matrix)["records"]
        schema = json.loads((repo / "governance" / "control-plane" / "schema" / "catalog.schema.json").read_text(encoding="utf-8"))
        capability_schema = dict(schema["$defs"]["capability"])
        capability_schema["$defs"] = schema["$defs"]
        validator = Draft202012Validator(capability_schema)
        for record in records:
            validator.validate(record)

    def test_external_root_fixture_uses_fixed_mapping_and_revision(self):
        from graph.control_inventory import matrix_from_declarations
        repo = Path(__file__).resolve().parents[3]
        declaration = repo / "governance" / "control-plane" / "source-adapters.yaml"
        with tempfile.TemporaryDirectory() as tmp:
            claude = Path(tmp) / "claude"; (claude / "rules").mkdir(parents=True)
            (claude / "CLAUDE.md").write_text("# Rule\nAuthorization: Bearer hidden", encoding="utf-8")
            matrix = matrix_from_declarations(declaration, repo, {"/root/.claude": claude})
            result = inventory(matrix)
            self.assertTrue(any(r["source_locator"].startswith("/root/.claude/") for r in result["records"]))
            self.assertTrue(all(r["source_revision"] for r in result["records"]))

    def test_unverified_external_pin_is_visible_but_not_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "x.md"
            path.write_text("# X", encoding="utf-8")
            matrix = AllowlistedSourceMatrix((SourceAdapter(
                "external", root, "rule", ("x.md",), source_revision="b" * 40,
                revision_source="external_pin", oss_decision_id="receipt:oss-decision/custom-adapters"),))
            output = inventory(matrix)
            self.assertEqual(len(output["records"]), 1)
            self.assertEqual(output["accepted_records"], [])
            self.assertEqual(output["accepted_counts"]["rule"], 0)
            self.assertEqual(output["candidate_counts"]["rule"], 1)
            self.assertEqual(output["records"][0]["state_axes"]["lifecycle"], "draft")
            self.assertEqual(output["records"][0]["state_axes"]["trust"], "unreviewed")

    def test_vendored_gitlink_proves_exact_external_pin(self):
        from graph.control_inventory import _external_pin_verified, matrix_from_declarations
        repo = Path(__file__).resolve().parents[3]
        matrix = matrix_from_declarations(
            repo / "governance" / "control-plane" / "source-adapters.yaml", repo,
        )
        pinned = {
            adapter.adapter_id: adapter for adapter in matrix.adapters
            if adapter.adapter_id in {"frank-archify-cli", "frank-archify-skill", "frank-agenttrail"}
        }
        self.assertEqual(set(pinned), {"frank-archify-cli", "frank-archify-skill", "frank-agenttrail"})
        self.assertTrue(all(_external_pin_verified(adapter) for adapter in pinned.values()))

    def test_oss_decision_is_required_without_a_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(InventoryError):
                SourceAdapter("missing-decision", Path(tmp), "rule", ("x.md",), source_revision="a" * 40)
            declaration = Path(tmp) / "source-adapters.yaml"
            declaration.write_text(
                "closed_world: true\nadapters:\n"
                "  - {id: missing-decision, root: /projects/frank, classes: [rule], patterns: [x.md], "
                "authority_tier: repo, enforcement: documentation, scope_ids: [project:frank], "
                "source_revision: git_head, evidence_receipt_id: receipt:test/source}\n",
                encoding="utf-8",
            )
            with self.assertRaises(InventoryError):
                from graph.control_inventory import matrix_from_declarations
                matrix_from_declarations(declaration, Path(tmp))

    def test_git_head_selector_uses_actual_checkout_not_declaration_pin(self):
        from graph.control_inventory import matrix_from_declarations
        repo = Path(__file__).resolve().parents[3]
        declaration = repo / "governance" / "control-plane" / "source-adapters.yaml"
        matrix = matrix_from_declarations(declaration, repo)
        result = inventory(matrix)
        head = __import__("subprocess").check_output(("git", "rev-parse", "HEAD"), text=True).strip()
        repo_records = [r for r in result["records"] if r["source_locator"].startswith("/projects/frank/")]
        self.assertTrue(repo_records)
        self.assertIn(head, {
            details["source_revision"] for details in result["revision_provenance"].values()
            if details["revision_source"] == "git_head"
        })
        self.assertTrue(any(r["source_revision"] == head for r in repo_records))

    def test_missing_root_and_external_pin_are_typed_findings(self):
        missing = Path("/definitely-missing-inventory-root")
        matrix = AllowlistedSourceMatrix((SourceAdapter(
            "missing", missing, "rule", ("*.md",), source_revision="a" * 40, oss_decision_id="receipt:oss-decision/custom-adapters"),))
        result = inventory(matrix)
        self.assertEqual(result["status"], "candidate_only")
        self.assertIn("missing_root", {finding["type"] for finding in result["findings"]})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "x.md"
            path.write_text("# X", encoding="utf-8")
            external = AllowlistedSourceMatrix((SourceAdapter(
                "external", root, "rule", ("x.md",), source_revision="b" * 40,
                revision_source="external_pin", oss_decision_id="receipt:oss-decision/custom-adapters"),))
            output = inventory(external)
            self.assertIn("unverified_external_pin", {finding["type"] for finding in output["findings"]})
            self.assertEqual(output["records"][0]["source_revision"], "b" * 40)
            self.assertEqual(output["accepted_record_count"], 0)

    def test_scan_limits_are_deterministic_and_exclusions_are_validated(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for index in range(4):
                (root / f"{index}.md").write_text(f"# {index}", encoding="utf-8")
            matrix = AllowlistedSourceMatrix((SourceAdapter("bounded", root, "rule", ("*.md",), source_revision="a" * 40, oss_decision_id="receipt:oss-decision/custom-adapters"),))
            files = matrix.files(max_files=2, max_bytes=1024, deadline_seconds=30)
            self.assertEqual(len(files), 2)
            output = inventory(matrix)
            self.assertTrue(output["findings"] == sorted(output["findings"], key=lambda item: item["id"]))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.yaml"
            path.write_text("schema_version: 1\nexcluded:\n  - {class: x, disposition: nonsense}\n", encoding="utf-8")
            with self.assertRaises(InventoryError):
                load_exclusions(path)

    def test_directory_expansion_is_bounded_and_typed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for index in range(4):
                (root / f"{index}.md").write_text(f"# {index}", encoding="utf-8")
            matrix = AllowlistedSourceMatrix((SourceAdapter(
                "bounded-directory", root, "rule", ("**/*.md",), source_revision="a" * 40, oss_decision_id="receipt:oss-decision/custom-adapters"),))
            with patch("graph.control_inventory._MAX_DIRECTORY_ENTRIES", 2):
                _files, findings = matrix.scan()
            self.assertIn("scan_directory_limit_exceeded", {finding["type"] for finding in findings})

    def test_metadata_read_rejects_oversized_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "oversized.md"
            path.write_bytes(b"# too large\n" + b"x" * (256 * 1024))
            adapter = SourceAdapter("oversized", root, "rule", (path.name,), source_revision="a" * 40, oss_decision_id="receipt:oss-decision/custom-adapters")
            with self.assertRaises(InventoryError):
                extract_record(path, adapter)

    def test_fixed_root_symlink_is_rejected_before_resolution(self):
        from graph.control_inventory import matrix_from_declarations
        repo = Path(__file__).resolve().parents[3]
        declaration = repo / "governance" / "control-plane" / "source-adapters.yaml"
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "outside"
            outside.mkdir()
            symlink = Path(tmp) / "root-link"
            try:
                symlink.symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest("symlink creation is unavailable")
            with self.assertRaises(InventoryError):
                matrix_from_declarations(declaration, repo, {"/root/.claude": symlink})

    def test_step2_required_coverage_has_typed_unavailable_findings(self):
        """Absence of evidence is explicit and never becomes a runtime claim."""
        from jsonschema import Draft202012Validator
        root = Path(__file__).resolve().parents[3]
        control = root / "governance" / "control-plane"
        exclusions = yaml.safe_load((control / "inventory-exclusions.yaml").read_text(encoding="utf-8"))
        census = yaml.safe_load((control / "evidence" / "step2-runtime-census.yaml").read_text(encoding="utf-8"))
        required = {"worker_queue", "backup_restore"}
        for document in (exclusions, census):
            dispositions = {item["class"]: item for item in document["coverage_dispositions"]}
            self.assertEqual(set(dispositions), required)
            for item in dispositions.values():
                self.assertEqual(item["disposition"], "unavailable")
                self.assertEqual(item["status"], "not_present")
                self.assertEqual(item["evidence_receipt_ids"], ["receipt:inventory/step-2-vps-20260830-001"])
                self.assertTrue(item["finding_id"].startswith("finding:inventory/"))
        finding_schema = json.loads((control / "schema" / "finding.schema.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(finding_schema)
        findings = {item["id"]: item for item in exclusions["findings"]}
        self.assertEqual(set(findings), {
            "finding:inventory/worker-queue-health-20260830",
            "finding:inventory/backup-restore-evidence-20260830",
        })
        for finding in findings.values():
            validator.validate(finding)
            self.assertEqual(finding["status"], "candidate")
            self.assertEqual(finding["confidence"], "none")
            self.assertEqual(finding["reconciliation_result"], "inaccessible")
        loaded = load_exclusions(control / "inventory-exclusions.yaml")
        self.assertEqual(
            {item["class"] for item in loaded["coverage_dispositions"]},
            required,
        )
        self.assertEqual(
            {item["id"] for item in loaded["findings"]},
            set(findings),
        )


if __name__ == "__main__":
    unittest.main()
