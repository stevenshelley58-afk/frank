import hashlib
import tempfile
import unittest
from pathlib import Path
from graph.map_release_orchestrator import PromotionError, promote

MANDATORY = {"projection:vps/world", "projection:frank/architecture", "projection:blockwise/runtime", "projection:mini-frank/knowledge-flow", "projection:ad-template-builder/architecture", "projection:ad-template-builder/workflow"}

class MapReleaseTests(unittest.TestCase):
    def receipt(self, keys=MANDATORY):
        manifests = {k: {"status":"generated", "preview_only":True, "generation_id":"generation:test", "artifact_hash":"sha256:"+"a"*64} for k in keys}
        return {"status":"passed", "run_key":"run:test", "manifests":manifests}
    def test_six_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(promote(receipt=self.receipt(), production_root=d, mandatory=MANDATORY)["status"], "promoted")
            self.assertEqual(promote(receipt=self.receipt(), production_root=d, mandatory=MANDATORY)["status"], "promoted")
    def test_conditional_missing_or_extra_rejected_and_lkg_kept(self):
        with tempfile.TemporaryDirectory() as d:
            promote(receipt=self.receipt(), production_root=d, mandatory=MANDATORY)
            before=Path(d,"current.json").read_bytes()
            with self.assertRaises(PromotionError): promote(receipt=self.receipt(MANDATORY-{"projection:blockwise/runtime"}), production_root=d, mandatory=MANDATORY)
            self.assertEqual(before, Path(d,"current.json").read_bytes())
    def test_failed_receipt_does_not_touch_pointer(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(PromotionError): promote(receipt={"status":"failed"}, production_root=d, mandatory=MANDATORY)
            self.assertFalse(Path(d,"current.json").exists())

if __name__ == "__main__": unittest.main()
