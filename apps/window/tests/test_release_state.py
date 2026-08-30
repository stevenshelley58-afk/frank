import os
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from graph.release_state import ReleaseEvidenceError, ReleaseStateStore

FLAGS = {k: True for k in ('live_view','map_view','control_read','reconciliation_schedules','runtime_monitoring','safe_actions','operational_actions','source_actions','cleanup_jobs','discovery_jobs','evaluation_jobs','chat_pattern_candidates','retention_restore_drills')}
BASE = dict(source_sha='a'*40, deployed_sha='b'*40, image_digest='sha256:'+'c'*64, graph_revision='g_'+'d'*64, projection_manifests=['manifest'], tests=['tests'], runtime_evidence=['runtime'], browser_evidence=['browser'], rollback_target='e'*40, feature_flags=FLAGS, captured_at='2026-08-30T00:00:00Z')

class ReleaseStateTests(unittest.TestCase):
    def test_rollback_selects_existing_hashed_release(self):
        with tempfile.TemporaryDirectory() as d:
            s=ReleaseStateStore(Path(d)); ev=dict(BASE, feature_flags={k:FLAGS[k] for k in list(FLAGS)[:5]})
            s.create_release('rel-old','step5',ev); s.advance_current('rel-old')
            self.assertEqual(s.rollback_current('rel-old')['release_id'], 'rel-old')
            self.assertEqual(s.read_current()['release_id'], 'rel-old')

    def test_rollback_missing_is_non_mutating(self):
        with tempfile.TemporaryDirectory() as d:
            s=ReleaseStateStore(Path(d))
            with self.assertRaises(ReleaseEvidenceError): s.rollback_current('missing')
            self.assertIsNone(s.read_current())

    def test_initial_non_step5_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            s=ReleaseStateStore(Path(d)); ev=dict(BASE, feature_flags={k:FLAGS[k] for k in list(FLAGS)[:12]})
            s.create_release('rel-late','step7c',ev)
            with self.assertRaises(ReleaseEvidenceError): s.advance_current('rel-late')

    def test_rollback_cas_rejects_changed_current(self):
        with tempfile.TemporaryDirectory() as d:
            s=ReleaseStateStore(Path(d)); ev=dict(BASE, feature_flags={k:FLAGS[k] for k in list(FLAGS)[:5]})
            s.create_release('rel-old','step5',ev); s.advance_current('rel-old')
            with self.assertRaises(ReleaseEvidenceError): s.rollback_current('rel-old', expected_current_release_id='other')
    def test_progression_and_no_skip_or_regression(self):
        with tempfile.TemporaryDirectory() as d:
            s=ReleaseStateStore(Path(d))
            for i, stage in enumerate(('step5','step6c','step7c','step8')):
                ev=dict(BASE, feature_flags={k:v for k,v in FLAGS.items() if (stage=='step8' or k not in {'retention_restore_drills'})})
                if stage in ('step5',): ev['feature_flags']={k:FLAGS[k] for k in list(FLAGS)[:5]}
                elif stage=='step6c': ev['feature_flags']={k:FLAGS[k] for k in list(FLAGS)[:8]}
                elif stage=='step7c': ev['feature_flags']={k:FLAGS[k] for k in list(FLAGS)[:12]}
                s.create_release(f'rel-{i+1}',stage,ev); s.advance_current(f'rel-{i+1}')
            with self.assertRaises(ReleaseEvidenceError): s.advance_current('rel-1')
    def test_tamper_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            s=ReleaseStateStore(Path(d)); ev=dict(BASE, feature_flags={k:FLAGS[k] for k in list(FLAGS)[:5]})
            s.create_release('rel-1','step5',ev); s.advance_current('rel-1')
            (Path(d)/'releases'/'rel-1.json').write_text('{}')
            with self.assertRaises(ReleaseEvidenceError): s.read_current()

    def test_tampered_next_record_cannot_be_promoted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = ReleaseStateStore(root)
            step5 = dict(BASE, feature_flags={key: FLAGS[key] for key in list(FLAGS)[:5]})
            step6 = dict(BASE, feature_flags={key: FLAGS[key] for key in list(FLAGS)[:8]})
            store.create_release("rel-1", "step5", step5)
            store.advance_current("rel-1")
            store.create_release("rel-2", "step6c", step6)
            pointer_before = (root / "current.json").read_bytes()
            (root / "releases" / "rel-2.json").write_text(
                '{"id":"release:rel-2","release_id":"rel-2","stage":"step6c","evidence":{}}',
                encoding="utf-8",
            )
            with self.assertRaises(ReleaseEvidenceError):
                store.advance_current("rel-2")
            self.assertEqual((root / "current.json").read_bytes(), pointer_before)

    def test_graph_revision_uses_control_graph_key_not_content_digest(self):
        with tempfile.TemporaryDirectory() as d:
            evidence = dict(BASE, feature_flags={k: FLAGS[k] for k in list(FLAGS)[:5]}, graph_revision='sha256:' + 'd' * 64)
            with self.assertRaisesRegex(ReleaseEvidenceError, "g_ graph revision"):
                ReleaseStateStore(Path(d)).create_release('rel-1', 'step5', evidence)

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_symlinked_current_pointer_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            s = ReleaseStateStore(Path(d)); ev = dict(BASE, feature_flags={k: FLAGS[k] for k in list(FLAGS)[:5]})
            s.create_release('rel-1', 'step5', ev); s.advance_current('rel-1')
            current = Path(d) / 'current.json'; saved = Path(d) / 'saved-current.json'
            current.replace(saved)
            try:
                os.symlink(saved, current)
            except OSError:
                self.skipTest("symlink creation unavailable")
            with self.assertRaises(ReleaseEvidenceError):
                s.read_current()

if __name__ == '__main__': unittest.main()
