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
            self.assertFalse((store / canary.STATE_NAME).exists())

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
