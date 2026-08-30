import json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import promote_control_release as cli

class PromoteTests(unittest.TestCase):
    def evidence(self):
        sha="a"*40
        return {"release_id":"r01","stage":"step7c","source_sha":sha,"deployed_sha":sha,"image_digest":"sha256:"+"b"*64,"graph_revision":"sha256:"+"c"*64,"projection_manifests":[1],"tests":[1],"runtime_evidence":[1],"browser_evidence":[1],"rollback_target":sha,"feature_flags":{k:k in {"live_view","map_view","control_read","reconciliation_schedules","runtime_monitoring","safe_actions","operational_actions","source_actions","cleanup_jobs","discovery_jobs","evaluation_jobs","chat_pattern_candidates"} for k in {"live_view","map_view","control_read","reconciliation_schedules","runtime_monitoring","safe_actions","operational_actions","source_actions","cleanup_jobs","discovery_jobs","evaluation_jobs","chat_pattern_candidates"}},"captured_at":"2026-08-30T00:00:00Z"}
    def test_dry_run_has_no_writes_or_systemctl(self):
        with tempfile.TemporaryDirectory() as d:
            src=Path(d)/"e.json"; src.write_text(json.dumps(self.evidence()))
            with patch.object(cli.subprocess,"run") as run: cli.main([str(src),"--store",d,"--flags-file",str(Path(d)/"flags"),"--dry-run"]); run.assert_not_called()
            self.assertFalse((Path(d)/"current.json").exists()); self.assertFalse((Path(d)/"flags").exists())
    def test_stage_timer_allowlist_is_fixed(self):
        self.assertEqual(set(cli.UNITS["step7c"]), {"frank-cleanup-report.timer","frank-discovery-refresh.timer","frank-evaluation.timer","frank-chat-pattern.timer"})
        for units in cli.UNITS.values():
            for unit in units: self.assertRegex(unit, r"^frank-[a-z-]+\.timer$")
