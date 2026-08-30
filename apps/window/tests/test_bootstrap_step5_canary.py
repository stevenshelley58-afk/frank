import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import bootstrap_step5_canary as canary


class BootstrapStep5CanaryTest(unittest.TestCase):
    def test_apply_and_cleanup_restore_exact_flags_without_release_pointer(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = root / "release"
            store.mkdir()
            flags = store / "feature-flags.env"
            flags.write_bytes(b"FRANK_FEATURE_FLAG_LIVE_VIEW=0\n")
            compose = root / "compose.yml"
            compose.write_text("services: {}", encoding="utf-8")
            with patch.object(canary, "_recreate") as recreate:
                canary.apply(flags, store, compose)
                self.assertEqual(canary._parse_flags(flags.read_bytes())["live_view"], True)
                self.assertTrue((store / canary.STATE_NAME).is_file())
                self.assertFalse((store / "current.json").exists())
                canary.cleanup(flags, store, compose)
                self.assertEqual(flags.read_bytes(), b"FRANK_FEATURE_FLAG_LIVE_VIEW=0\n")
                self.assertFalse((store / canary.STATE_NAME).exists())
                self.assertEqual(recreate.call_count, 2)
                self.assertEqual(recreate.call_args_list[0].args[1], flags)
                self.assertEqual(recreate.call_args_list[1].args[1], flags)

    def test_apply_rejects_existing_release_and_recreate_failure_restores(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = root / "release"
            store.mkdir()
            flags = store / "feature-flags.env"
            compose = root / "compose.yml"
            compose.write_text("services: {}", encoding="utf-8")
            (store / "current.json").write_text("{}", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                canary.apply(flags, store, compose)
            (store / "current.json").unlink()
            with patch.object(canary, "_recreate", side_effect=RuntimeError("no")):
                with self.assertRaises(RuntimeError):
                    canary.apply(flags, store, compose)
            self.assertFalse(flags.exists())
            self.assertTrue((store / canary.STATE_NAME).exists())

    def test_handoff_validates_step5_and_removes_canary_files(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = root / "release"
            store.mkdir()
            flags = store / ".step5-canary-flags.env"
            canonical = store / "feature-flags.env"
            compose = root / "compose.yml"
            compose.write_text("services: {}", encoding="utf-8")
            with patch.object(canary, "_recreate"):
                canary.apply(flags, store, compose)
            canonical.write_bytes(canary._flags_bytes({key: key in canary.STEP5_FLAGS for key in canary.ALL_FLAGS}))
            (store / "current.json").write_text("{}", encoding="utf-8")
            current = {"stage": "step5", "evidence": {"feature_flags": {}}}
            with patch.object(canary, "ReleaseStateStore") as state:
                state.return_value.read_current.return_value = current
                with patch.object(canary, "_recreate") as recreate:
                    canary.cleanup(flags, store, compose)
                    self.assertIsNone(recreate.call_args.args[1])
            self.assertFalse(flags.exists())
            self.assertFalse((store / canary.STATE_NAME).exists())

    def test_canary_paths_cannot_escape_release_store(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = root / "release"
            store.mkdir()
            compose = root / "compose.yml"
            compose.write_text("services: {}", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                canary.apply(root / "outside.env", store, compose)

    def test_cleanup_refuses_changed_canary_flags(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            store = root / "release"
            store.mkdir()
            flags = store / "feature-flags.env"
            compose = root / "compose.yml"
            compose.write_text("services: {}", encoding="utf-8")
            with patch.object(canary, "_recreate"):
                canary.apply(flags, store, compose)
            flags.write_text("FRANK_FEATURE_FLAG_LIVE_VIEW=0\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                canary.cleanup(flags, store, compose)


if __name__ == "__main__":
    unittest.main()
