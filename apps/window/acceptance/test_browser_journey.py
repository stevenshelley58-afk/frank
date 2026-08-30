import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import types
from datetime import datetime, timezone
from pathlib import Path

import yaml

from acceptance.production_acceptance import AcceptanceReport, REQUIRED_CHECKLIST, _canonical_hash, _evidence_checks
from acceptance.browser_journey import _basic_auth, run

SCRIPT = Path(__file__).with_name("browser_journey.py")
ROOT = Path(__file__).parents[3]
OUTCOMES = {"csp", "keyboard", "reduced_motion", "mini_frank_preserved", "live_navigation", "map_navigation", "map_artifact", "control_navigation", "records", "runtime_summary", "export", "import_preview", "agenttrail_mutation_denied", "no_overflow"}
SURFACES = ("/", "/mini-frank", "/live", "/map", "/control", "/agenttrail/")


class BrowserJourneyTests(unittest.TestCase):
    def _evidence(self, folder: Path) -> dict:
        journeys, hashes = {}, []
        for name, viewport in (("desktop", {"width": 1280, "height": 800}), ("mobile", {"width": 390, "height": 844})):
            shots = {}
            for index, surface in enumerate(SURFACES):
                relative = f"{name}-{index}.png"; data = f"{name}-{surface}".encode(); (folder / relative).write_bytes(data)
                digest = "sha256:" + hashlib.sha256(data).hexdigest(); hashes.append(digest)
                shots[surface] = {"path": relative, "sha256": digest}
            journeys[name] = {"viewport": viewport, "outcomes": {key: True for key in OUTCOMES}, "screenshots": shots}
        flags = yaml.safe_load((ROOT / "governance/control-plane/feature-flags.yaml").read_text())["defaults"]
        all_flags = {key: True for key in flags}; manifests = []
        for index, projection_id in enumerate(sorted({"projection:vps/world", "projection:frank/architecture", "projection:blockwise/runtime", "projection:mini-frank/knowledge-flow", "projection:ad-template-builder/architecture", "projection:ad-template-builder/workflow"})):
            manifest = folder / f"manifest-{index}.json"
            manifest.write_text(json.dumps({"projection_id": projection_id, "graph_revision": "g_" + "d" * 64}), encoding="utf-8")
            manifests.append({"projection_id": projection_id, "path": manifest.name, "sha256": "sha256:" + hashlib.sha256(manifest.read_bytes()).hexdigest()})
        return {"source_sha": "a" * 40, "image_digest": "sha256:" + "b" * 64, "deployed_sha": "c" * 40, "graph_revision": "g_" + "d" * 64,
                "projection_manifests": manifests,
                "tests": ["real"], "runtime_health": ["real"], "reviewer": "reviewer", "rollback_target": "e" * 40,
                "feature_flags": all_flags, "feature_flag_hash": _canonical_hash(all_flags),
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "acceptance_checklist": {key: True for key in REQUIRED_CHECKLIST},
                "restore_drill": {"status": "passed", "receipt_id": "receipt-1"}, "screenshot_hashes": hashes,
                "browser_review": {"schema": "frank.browser-journey/v2", "status": "pass", "url": "https://frank.invalid", "browser": "chromium", "browser_version": "1", "authenticated_context": True, "journeys": journeys, "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}}

    def test_fails_closed_without_url(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--output", str(Path.cwd()/"unused-receipt.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2); self.assertIn("refusing", result.stderr)

    def test_mocked_playwright_responses_produce_two_real_receipt_journeys(self):
        class Response:
            status = 200
            headers = {"content-security-policy": "default-src 'self'"}
            def body(self): return b"export"
        class Locator:
            count = lambda self: 1
            first = property(lambda self: self)
            def click(self): pass
            def get_attribute(self, name): return "/api/control/maps/artifact?projection_id=projection%3Avps%2Fworld" if name == "src" else "/api/control/export?format=csv"
            def inner_text(self): return "Import preview no canonical source or control state was changed Runtime evidence"
            def set_input_files(self, value): pass
            def get_by_text(self, value): return self
            def wait_for(self, **kwargs): pass
        class Request:
            def get(self, url): return Response()
            def fetch(self, url, **kwargs):
                result = Response(); result.status = 403; return result
        class Page:
            keyboard = types.SimpleNamespace(press=lambda key: None)
            request = Request()
            def goto(self, *args, **kwargs): return Response()
            def evaluate(self, expression):
                if "scrollWidth" in expression: return False
                return True
            def locator(self, selector): return Locator()
            def screenshot(self, path, **kwargs):
                data = path.encode(); Path(path).write_bytes(data); return data
            def close(self): pass
        class BrowserContext:
            def new_page(self): return Page()
            def close(self): pass
        captured_contexts = []
        class Browser:
            version = "mock"
            def new_context(self, **kwargs): captured_contexts.append(kwargs); return BrowserContext()
            def close(self): pass
        class Playwright:
            chromium = types.SimpleNamespace(launch=lambda **kwargs: Browser())
        class SyncContext:
            def __enter__(self): return Playwright()
            def __exit__(self, *args): return False
        fake_sync = types.ModuleType("playwright.sync_api"); fake_sync.sync_playwright = lambda: SyncContext()
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); state = folder / "state.json"; state.write_text("{}")
            with patch.dict(sys.modules, {"playwright": types.ModuleType("playwright"), "playwright.sync_api": fake_sync}), patch.dict("os.environ", {"FRANK_STORAGE_STATE": str(state), "FRANK_BROWSER_BASIC_AUTH_USER": "operator", "FRANK_BROWSER_BASIC_AUTH_PASSWORD": "secret-value"}, clear=False):
                receipt = run("https://frank.invalid", folder / "receipt.json")
            self.assertEqual(receipt["status"], "pass")
            self.assertEqual(set(receipt["journeys"]), {"desktop", "mobile"})
            self.assertNotIn("secret-value", json.dumps(receipt))
            self.assertEqual(len(captured_contexts), 2)
            self.assertTrue(all(item["http_credentials"] == {"username": "operator", "password": "secret-value"} for item in captured_contexts))

    def test_complete_real_file_receipt_passes_and_binds_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = AcceptanceReport(); _evidence_checks(self._evidence(Path(tmp)), ROOT, report, True, Path(tmp))
            self.assertFalse(report.failed, [item.detail for item in report.failed])

    def test_basic_auth_requires_both_values_and_never_echoes_secret(self):
        with patch.dict("os.environ", {"FRANK_BROWSER_BASIC_AUTH_USER": "operator", "FRANK_BROWSER_BASIC_AUTH_PASSWORD": "secret-value"}, clear=True):
            self.assertEqual(_basic_auth(), {"username": "operator", "password": "secret-value"})
        with patch.dict("os.environ", {"FRANK_BROWSER_BASIC_AUTH_USER": "operator"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "supplied together") as failure:
                _basic_auth()
            self.assertNotIn("secret-value", str(failure.exception))

    def test_rejects_missing_mobile_outcome_and_a_symlinked_screenshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); evidence = self._evidence(folder); del evidence["browser_review"]["journeys"]["mobile"]
            report = AcceptanceReport(); _evidence_checks(evidence, ROOT, report, True, folder); self.assertTrue(report.failed)
            evidence = self._evidence(folder); shot = folder / "desktop-0.png"; target = folder / "real.png"; shot.replace(target)
            try: shot.symlink_to(target)
            except OSError: self.skipTest("symlink creation unavailable")
            report = AcceptanceReport(); _evidence_checks(evidence, ROOT, report, True, folder); self.assertTrue(report.failed)

    def test_rejects_future_timestamp_and_cross_binding_tamper(self):
        with tempfile.TemporaryDirectory() as tmp:
            evidence = self._evidence(Path(tmp)); evidence["browser_review"]["captured_at"] = "2099-01-01T00:00:00Z"; evidence["screenshot_hashes"] = evidence["screenshot_hashes"][:-1]
            report = AcceptanceReport(); _evidence_checks(evidence, ROOT, report, True, Path(tmp)); self.assertTrue(report.failed)

    def test_manifest_path_must_stay_inside_bundled_evidence_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp); evidence = self._evidence(folder)
            evidence["projection_manifests"][0]["path"] = "../../outside/manifest.json"
            report = AcceptanceReport(); _evidence_checks(evidence, ROOT, report, True, folder)
            self.assertTrue(report.failed)


if __name__ == "__main__":
    unittest.main()
