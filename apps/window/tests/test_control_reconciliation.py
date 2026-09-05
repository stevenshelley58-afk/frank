import json
import os
import tempfile
import unittest
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
from jsonschema import Draft202012Validator, FormatChecker

sys.path.insert(0, str(Path(__file__).parents[1]))
from scripts.control_reconcile import (
    Collector, HostFactSource, MAX_ARTIFACT_BYTES, MAX_FACTS_BYTES, MAX_INPUT_BYTES, MODE_TIMEOUT_SECONDS,
    MODES, read_latest, redact,
)


class ControlReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.sources = {"identity": {"project": "frank", "token": "do-not-store"},
                        "revision": {"sha": "a" * 40},
                        "systemd": {"unit": "frank.service", "instruction_body": "private"}}

    def tearDown(self):
        self.tmp.cleanup()

    def test_fixed_modes_and_immutable_pointer(self):
        self.assertEqual(MODES, {"fast", "full", "post_deploy"})
        result = Collector(self.root, sources=self.sources).run("fast")
        self.assertEqual(result["status"], "success")
        pointer = json.loads((self.root / "reconciliations/latest-fast.json").read_text())
        receipt = self.root / "reconciliations" / pointer["run_id"] / "receipt.json"
        self.assertTrue(receipt.is_file())
        self.assertEqual(json.loads(receipt.read_text())["facts"]["identity"]["token"], "[REDACTED]")
        self.assertEqual(json.loads(receipt.read_text())["facts"]["systemd"]["instruction_body"], "[REDACTED_INSTRUCTION_BODY]")

    @unittest.skipUnless(os.name != "nt", "POSIX directory mode semantics required")
    def test_reconciliation_parent_preserves_traversal_without_listing(self):
        result = Collector(self.root, sources=self.sources).run("fast")
        self.assertEqual(result["status"], "success")
        self.assertEqual(os.stat(self.root).st_mode & 0o007, 0o001)
        self.assertEqual(os.stat(self.root / "reconciliations").st_mode & 0o007, 0)

    def test_success_receipt_has_frozen_contract_and_schedule_freshness(self):
        result = Collector(self.root, sources=self.sources).run("fast")
        schema = json.loads((Path(__file__).parents[3] / "governance/control-plane/schema/receipt.schema.json").read_text())
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(result)
        self.assertEqual(result["id"], result["receipt_id"])
        self.assertEqual(result["redaction"], "secret_filtered")
        self.assertEqual(result["source_revision_set"]["project:frank"], "a" * 40)
        captured = __import__("datetime").datetime.fromisoformat(result["captured_at"].replace("Z", "+00:00"))
        fresh = __import__("datetime").datetime.fromisoformat(result["fresh_until"].replace("Z", "+00:00"))
        self.assertEqual((fresh - captured).total_seconds(), 15 * 60)

    def test_mismatched_checkout_keeps_approved_deployed_revision(self):
        from scripts.control_reconcile import _receipt_envelope
        receipt = _receipt_envelope("fast", "run-1", "2026-09-06T00:00:00Z", "pass", {
            "revision": {"checkout": {"status": "ready", "value": "1" * 40},
                         "approved": {"status": "revision_mismatch", "value": "2" * 40}}
        })
        self.assertEqual(receipt["source_revision_set"]["project:frank"], "1" * 40)
        self.assertEqual(receipt["deployed_revision_set"]["project:frank"], "2" * 40)

    def test_missing_approved_revision_does_not_claim_checkout_deployed(self):
        from scripts.control_reconcile import _receipt_envelope
        receipt = _receipt_envelope("fast", "run-2", "2026-09-06T00:00:00Z", "pass", {
            "revision": {"checkout": {"status": "ready", "value": "1" * 40},
                         "approved": {"status": "unavailable", "value": "not-a-sha"}}
        })
        self.assertEqual(receipt["source_revision_set"]["project:frank"], "1" * 40)
        self.assertEqual(receipt["deployed_revision_set"]["project:frank"], "unknown")

    def test_terminal_failure_receipt_has_frozen_contract_without_freshness(self):
        result = Collector(self.root, sources=self.sources, timeout_seconds=-1).run("fast")
        schema = json.loads((Path(__file__).parents[3] / "governance/control-plane/schema/receipt.schema.json").read_text())
        receipt = json.loads((self.root / "reconciliations" / result["run_id"] / "receipt.json").read_text())
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(receipt)
        self.assertEqual(receipt["outcome"], "fail")
        self.assertIsNone(receipt["fresh_until"])

    def test_input_not_mutated_and_deduplicated(self):
        original = json.loads(json.dumps(self.sources))
        c = Collector(self.root, sources=self.sources)
        first = c.run("full")
        second = c.run("full")
        self.assertEqual(first["run_id"], second["run_id"])
        self.assertEqual(self.sources, original)

    def test_expired_dedup_receipt_is_not_reused(self):
        now = [1_800_000_000.0]
        collector = Collector(self.root, sources=self.sources, clock=lambda: now[0])
        first = collector.run("fast")
        now[0] += 15 * 60 + 1
        second = collector.run("fast")
        self.assertNotEqual(first["run_id"], second["run_id"])
        self.assertEqual(second["outcome"], "pass")

    def test_dedup_repairs_exact_latest_pointer(self):
        collector = Collector(self.root, sources=self.sources)
        first = collector.run("fast")
        pointer = self.root / "reconciliations" / "latest-fast.json"
        pointer.unlink()
        second = collector.run("fast")
        self.assertEqual(second["run_id"], first["run_id"])
        self.assertEqual(read_latest(self.root, "fast")["receipt_id"], first["receipt_id"])

    def test_dedup_rejects_tampered_run_metadata_before_pointer_repair(self):
        collector = Collector(self.root, sources=self.sources)
        first = collector.run("fast")
        dedup = next((self.root / "reconciliations" / "fingerprints").glob("*.json"))
        payload = json.loads(dedup.read_text(encoding="utf-8"))
        payload["run_id"] = "../outside"
        dedup.write_text(json.dumps(payload), encoding="utf-8")
        (self.root / "reconciliations" / "latest-fast.json").unlink()
        second = collector.run("fast")
        self.assertIn(second["status"], {"success", "error"})
        if second["status"] == "success":
            self.assertNotEqual(second["run_id"], first["run_id"])
            self.assertEqual(read_latest(self.root, "fast")["run_id"], second["run_id"])
        else:
            self.assertFalse((self.root / "reconciliations" / "latest-fast.json").exists())

    def test_lock_is_already_running_without_stale_missed_marker(self):
        lock = self.root / "reconciliations/.fast.lock"
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({"owner": "test", "run_id": "x"}))
        self.assertEqual(Collector(self.root, sources=self.sources).run("fast")["status"], "already_running")
        lock.unlink()
        result = Collector(self.root, sources=self.sources).run("fast")
        self.assertEqual(result["status"], "success")
        self.assertNotIn("missed_run", result)
        self.assertFalse((self.root / "reconciliations/missed-fast.json").exists())

    def test_tampered_lock_metadata_is_bounded_and_not_persisted(self):
        lock = self.root / "reconciliations/.fast.lock"
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({"scope": "fast", "owner": "SECRET", "payload": "x" * 100000}), encoding="utf-8")
        result = Collector(self.root, sources=self.sources).run("fast")
        self.assertEqual(result["status"], "already_running")
        receipt = self.root / "reconciliations" / result["run_id"] / "receipt.json"
        self.assertNotIn("SECRET", receipt.read_text(encoding="utf-8"))

    def test_lock_write_failure_closes_and_removes_partial_lock(self):
        collector = Collector(self.root, sources=self.sources)
        with patch("scripts.control_reconcile.os.write", side_effect=OSError("write failed")):
            with self.assertRaises(OSError):
                collector.run("fast")
        self.assertFalse((self.root / "reconciliations/.fast.lock").exists())

    def test_project_revision_requires_exact_commit_not_symbolic_head(self):
        source = HostFactSource(runner=lambda _argv: SimpleNamespace(returncode=0, stdout="ref: refs/heads/main\n"))
        result = source._project_revision(Path("/projects/example"))
        self.assertEqual(result["status"], "unparseable")

    def test_project_git_marker_is_metadata_only_and_never_reads_head(self):
        project = self.root / "project"
        (project / ".git").mkdir(parents=True)
        (project / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        source = HostFactSource()
        with patch.object(source, "_absolute_file", side_effect=AssertionError("HEAD must not be read")):
            self.assertEqual(source._project_git_marker_status(project), "metadata_only")

    def test_project_git_marker_rejects_escaping_head_symlink(self):
        project = self.root / "project"
        (project / ".git").mkdir(parents=True)
        outside = self.root / "outside-head"
        outside.write_text("ref: refs/heads/main\n", encoding="utf-8")
        try:
            (project / ".git" / "HEAD").symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks are unavailable on this host")
        self.assertEqual(HostFactSource._project_git_marker_status(project), "inaccessible")

    def test_production_full_requires_approved_catalog_before_pointer_advance(self):
        prior = Collector(self.root, sources=self.sources).run("full")
        self.assertEqual(prior["status"], "success")
        pointer = self.root / "reconciliations/latest-full.json"
        prior_pointer = pointer.read_bytes()
        collector = Collector(self.root)
        collector._inputs = lambda _scope: {
            "revision": {"approved": {"status": "ready", "value": "a" * 40}},
            "identity": {"host": {"status": "ready"}},
        }
        with patch.object(collector, "_declared_catalog", return_value=None) as load_catalog:
            result = collector.run("full")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error_type"], "ValueError")
        load_catalog.assert_called_once_with("full", "a" * 40)
        self.assertEqual(pointer.read_bytes(), prior_pointer)

    def test_catalog_loading_stays_inside_collection_deadline(self):
        collector = Collector(self.root, timeout_seconds=30)
        collector._inputs = lambda _scope: {"revision": {"approved": {"status": "ready", "value": "b" * 40}}}
        seen = []

        def load_catalog(scope, approved_sha):
            seen.append((scope, approved_sha, collector.host_source.deadline))
            self.assertIsNotNone(collector.host_source.deadline)
            return None

        with patch.object(collector, "_declared_catalog", side_effect=load_catalog):
            # Fixture-injected sources are intentionally exempt from the
            # production catalog requirement, but still exercise the shared
            # deadline handoff.
            collector.sources = {"revision": {"approved": {"status": "ready", "value": "b" * 40}}}
            result = collector.run("full")
        self.assertEqual(result["status"], "success")
        self.assertEqual(seen[0][:2], ("full", "b" * 40))
        self.assertIsNone(collector.host_source.deadline)

    def test_persistent_startup_recovery_is_delegated_to_exact_timer_units(self):
        infra = Path(__file__).parents[1] / "infra" / "control_plane"
        for name in ("frank-control-reconcile-fast.timer", "frank-control-reconcile-full.timer"):
            body = (infra / name).read_text(encoding="utf-8")
            self.assertIn("Persistent=true", body)
        # Startup recovery is represented by systemd's Persistent timer state;
        # the collector itself never fabricates a missed-run marker.
        self.assertFalse((self.root / "reconciliations/missed-fast.json").exists())

    def test_unit_installer_is_idempotent_and_keeps_timers_disabled(self):
        installer = (Path(__file__).parents[1] / "infra" / "control_plane" / "install.sh").read_text(encoding="utf-8")
        self.assertIn("install -o root -g root -m 0644", installer)
        self.assertIn("install -d -o root -g hermes -m 0750", installer)
        self.assertIn("systemctl daemon-reload", installer)
        self.assertIn("systemctl disable", installer)
        self.assertIn("systemctl stop", installer)
        self.assertNotIn("systemctl enable", installer)
        self.assertIn("--preserve-active-release", installer)
        self.assertIn("current_release_id", installer)
        self.assertIn("ReleaseStateStore", installer)
        self.assertIn("promote_control_release.py", installer)
        self.assertIn('preserve_active_release=false', installer)

    def test_deploy_preserves_a_validated_release_when_installing_units(self):
        deploy = (Path(__file__).parents[1] / "deploy.sh").read_text(encoding="utf-8")
        self.assertIn('bash "$app/infra/control_plane/install.sh" --preserve-active-release', deploy)

    def test_restore_drill_cannot_write_control_graph_schedules(self):
        service = (Path(__file__).parents[1] / "infra" / "retention" / "frank-restore-drill.service").read_text(encoding="utf-8")
        self.assertIn("ReadWritePaths=/srv/frank/backups/control-plane", service)
        self.assertIn("UMask=0077", service)
        self.assertNotIn("control-graph/schedules", service)

    def test_timeout_does_not_advance_pointer(self):
        c = Collector(self.root, sources=self.sources, timeout_seconds=-1)
        self.assertEqual(c.run("fast")["status"], "timeout")
        self.assertFalse((self.root / "reconciliations/latest-fast.json").exists())

    def test_default_mode_deadlines_match_fixed_units(self):
        self.assertEqual(MODE_TIMEOUT_SECONDS, {"fast": 300.0, "full": 900.0})
        self.assertIsNone(Collector(self.root, sources=self.sources).timeout_seconds)

    def test_aggregate_facts_are_bounded_and_failure_receipt_is_readable(self):
        oversized = {"identity": {"facts": "x" * (MAX_FACTS_BYTES + 1)}}
        result = Collector(self.root, sources=oversized).run("fast")
        self.assertEqual(result["status"], "error")
        self.assertFalse((self.root / "reconciliations/latest-fast.json").exists())
        receipt = self.root / "reconciliations" / result["run_id"] / "receipt.json"
        self.assertLessEqual(receipt.stat().st_size, MAX_INPUT_BYTES)

    def test_full_metadata_inventory_may_exceed_single_input_bound(self):
        metadata = "x" * (MAX_INPUT_BYTES + 1024)
        sources = dict(self.sources)
        sources["capabilities"] = {"inventory": {"records": [metadata]}}
        result = Collector(self.root, sources=sources).run("full")
        self.assertEqual(result["status"], "success")
        receipt = self.root / "reconciliations" / result["run_id"] / "receipt.json"
        self.assertGreater(receipt.stat().st_size, MAX_INPUT_BYTES)
        self.assertLessEqual(receipt.stat().st_size, MAX_ARTIFACT_BYTES)
        self.assertEqual(read_latest(self.root, "full")["run_id"], result["run_id"])

    def test_symlinked_data_root_is_rejected_before_any_write(self):
        target = self.root / "target"
        target.mkdir()
        link = self.root / "data-link"
        try:
            link.symlink_to(target, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks are unavailable on this host")
        with self.assertRaises(ValueError):
            Collector(link, sources=self.sources).run("fast")
        self.assertFalse((target / "reconciliations").exists())

    def test_symlinked_reconciliation_root_is_rejected_before_any_write(self):
        data = self.root / "data"
        data.mkdir()
        target = self.root / "target"
        target.mkdir()
        try:
            (data / "reconciliations").symlink_to(target, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks are unavailable on this host")
        with self.assertRaises(ValueError):
            Collector(data, sources=self.sources).run("fast")
        self.assertFalse((target / "latest-fast.json").exists())

    def test_error_is_an_immutable_run_without_success_pointer(self):
        collector = Collector(self.root, sources=self.sources)

        def fail(_scope):
            raise RuntimeError("bounded fixture failure")

        collector._inputs = fail
        result = collector.run("full")
        self.assertEqual(result["status"], "error")
        run_dir = self.root / "reconciliations" / result["run_id"]
        self.assertTrue((run_dir / "receipt.json").is_file())
        self.assertTrue((run_dir / "findings.json").is_file())
        self.assertFalse((self.root / "reconciliations/latest-full.json").exists())

    def test_post_deploy_reconciles_both_scopes(self):
        result = Collector(self.root, sources=self.sources).run("post_deploy")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["fast"]["trigger_reason"], "post_deploy")
        self.assertEqual(result["full"]["trigger_reason"], "post_deploy")
        self.assertTrue((self.root / "reconciliations/latest-fast.json").is_file())
        self.assertTrue((self.root / "reconciliations/latest-full.json").is_file())

    def test_host_commands_are_exact_and_docker_identity_is_normalized(self):
        calls = []

        def runner(argv):
            calls.append(tuple(argv))
            if argv[0] == "docker":
                return SimpleNamespace(
                    returncode=0,
                    stdout="/frank-window|running|healthy|sha256:image|frank-window:current|frank-window-data,\n",
                )
            if argv[0] == "systemctl":
                return SimpleNamespace(returncode=0, stdout="LoadState=loaded\nActiveState=active\n")
            return SimpleNamespace(returncode=0, stdout="a" * 40 + "\n")

        source = HostFactSource(runner=runner)
        docker = source._docker("frank-window")
        self.assertEqual(docker["status"], "ready")
        self.assertTrue(docker["output"].startswith("frank-window|"))
        unit = source._command((
            "systemctl", "show", "--no-pager", source.SYSTEMD_PROPERTY,
            "hermes-gateway.service",
        ))
        self.assertEqual(unit["status"], "ready")
        rejected = source._command((
            "docker", "inspect", "--format", source.DOCKER_FORMAT,
            "frank-window", "unexpected",
        ))
        self.assertEqual(rejected["status"], "unavailable")
        git_blob = source._command((
            "git", "-C", str(source.ROOT), "show",
            "b" * 40 + ":governance/control-plane/catalog.yaml",
        ))
        self.assertEqual(git_blob["status"], "ready")
        split_git_blob = source._command((
            "git", "-C", str(source.ROOT), "show", "b" * 40,
            "governance/control-plane/catalog.yaml",
        ))
        self.assertEqual(split_git_blob["status"], "unavailable")
        self.assertEqual(len(calls), 3)

    def test_discovery_commands_are_fixed_bounded_and_names_are_allowlisted(self):
        source = HostFactSource(runner=lambda argv: SimpleNamespace(returncode=0, stdout=""))
        self.assertEqual(source._command(source.DOCKER_DISCOVERY)["status"], "ready")
        self.assertEqual(source._command(source.DOCKER_VOLUME_DISCOVERY)["status"], "ready")
        self.assertEqual(source._command(source.SYSTEMD_DISCOVERY)["status"], "ready")
        self.assertEqual(source._command(("docker", "ps", "--all", "--format", "{{.Names}}", "--privileged"))["status"], "unavailable")
        self.assertEqual(source._command(("docker", "inspect", "--format", source.DOCKER_FORMAT, "attacker"))["status"], "unavailable")

    def test_redact_is_deep_copy(self):
        value = {"secret": "x", "nested": [{"prompt": "whole body"}]}
        clean = redact(value)
        self.assertEqual(value["secret"], "x")
        self.assertEqual(clean["nested"][0]["prompt"], "[REDACTED_INSTRUCTION_BODY]")


if __name__ == "__main__":
    unittest.main()
