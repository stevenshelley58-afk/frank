import subprocess, sys, unittest, tempfile, hashlib
from pathlib import Path

SCRIPT = Path(__file__).with_name("browser_journey.py")
from acceptance.production_acceptance import AcceptanceReport, _evidence_checks
class BrowserJourneyTests(unittest.TestCase):
    def test_fails_closed_without_url(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--output", str(Path.cwd()/"unused-receipt.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("refusing", result.stderr)

    def test_receipt_rejects_stale_and_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            shot = Path(d) / "desktop.png"; shot.write_bytes(b"real")
            browser = {"schema":"frank.browser-journey/v1", "captured_at":"2020-01-01T00:00:00Z", "browser_version":"1", "viewport":{"width":1}, "keyboard":True, "reduced_motion":True, "screenshots":{"/":{"path":str(shot),"sha256":"sha256:"+"0"*64}}}
            ev = {"browser_review":browser}
            report = AcceptanceReport(); _evidence_checks(ev, Path(__file__).parents[3], report, False)
            self.assertTrue(any("browser_errors" in f.detail and f.status == "fail" for f in report.findings))

    def test_receipt_rejects_duplicate_screenshot_paths(self):
        with tempfile.TemporaryDirectory() as d:
            shot = Path(d) / "x.png"; shot.write_bytes(b"real")
            item = {"path":str(shot),"sha256":"sha256:"+hashlib.sha256(b"real").hexdigest()}
            browser = {"schema":"frank.browser-journey/v1", "captured_at":"2099-01-01T00:00:00Z", "browser_version":"1", "viewport":{"width":1}, "keyboard":True, "reduced_motion":True, "screenshots":{"/":item,"/live":item}}
            report = AcceptanceReport(); _evidence_checks({"browser_review":browser}, Path(__file__).parents[3], report, False)
            self.assertTrue(report.failed)
if __name__ == "__main__": unittest.main()
