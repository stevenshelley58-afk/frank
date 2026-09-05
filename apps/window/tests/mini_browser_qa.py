"""Offline Mini Frank browser QA.

Runs only against a temporary local HTTP server. Every /api/mini request is an
explicit fixture; unexpected routes are rejected, every mutation is faked, and
all non-local browser network traffic is blocked and recorded. No public route,
AI, payment provider, mail service or customer record is reachable.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import unittest
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

ROOT = Path(__file__).resolve().parents[1]
MINI = ROOT / "web" / "mini"
SCREENSHOTS = Path(os.environ.get("MINI_QA_SCREENSHOTS", "/srv/frank/tmp/cleanup-20260905/mini-qa"))
CLAIM = "c" * 24
ACCOUNT_CLAIM = "ma1.YWNjb3VudA." + "s" * 24
INTAKE_ID = "intake-qa-001"
GUIDE_SCHEMA = "mini-guide-v1"
FREE_CTA = "Click Solve this for me — free."
JOB_A = "job-qa-working"
JOB_B = "job-qa-ready"

QUESTION_CARD = {
    "schema": GUIDE_SCHEMA,
    "message": "Happy to help more people reach you. Pick the closest answer — you can change it later.",
    "understanding": [{"key": "problem", "label": "What you want", "value": "Quote follow-up", "assumed": False}],
    "next": {
        "kind": "question",
        "id": "desired_action",
        "question": "What should people do next?",
        "why": "This decides how your page greets people.",
        "options": [
            {"id": "enquiry", "label": "Send an enquiry", "detail": "Collect their details safely.", "recommended": True},
            {"id": "booking", "label": "Book now", "detail": "Let people pick a time.", "recommended": False},
        ],
        "allow_other": True,
        "allow_choose_for_me": True,
    },
}
CONFIRM_CARD = {
    "schema": GUIDE_SCHEMA,
    "message": FREE_CTA,
    "understanding": [{"key": "problem", "label": "What you want", "value": "Quote follow-up", "assumed": False}],
    "next": {"kind": "confirm", "id": "solve_free", "question": "", "why": "", "options": [], "allow_other": True, "allow_choose_for_me": False},
}


def job_fixture(job_id, stage, version, title="Quote follow-up", summary="Your working result is ready."):
    result = {"title": title, "summary": summary, "artifacts": []} if stage == "ready" else {}
    return {
        "id": job_id,
        "title": title,
        "problem": "Quote follow-up",
        "stage": stage,
        "version": version,
        "result": result,
        "created_at": 1735689600,
        "updated_at": 1735689600 + version,
        "next_action": "Open the result.",
    }


class MiniFixtureHandler(SimpleHTTPRequestHandler):
    requests: list[tuple[str, str]] = []
    unexpected: list[str] = []
    chat_turn = 0
    jobs: dict[str, dict] = {}
    job_get_counts: dict[str, int] = {}
    delayed_404: dict[str, float] = {}
    sharing_status = HTTPStatus.OK
    lock = threading.Lock()

    def log_message(self, *_args):
        pass

    def _json(self, status, body):
        data = json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionResetError, BrokenPipeError):
            pass

    def translate_path(self, path):
        requested = Path(urlparse(path).path.lstrip("/"))
        return str(MINI / requested)

    def _match(self, pattern):
        path = urlparse(self.path).path
        return self.command == pattern[0] and path == pattern[1]

    def _api(self):
        path = urlparse(self.path).path
        with self.lock:
            self.requests.append((self.command, path))
        if self._match(("POST", "/api/mini/intakes")):
            return self._json(200, {"intake": {"id": INTAKE_ID, "status": "draft", "guide_version": 0}, "claim_token": CLAIM})
        if self._match(("GET", "/api/mini/config")):
            return self._json(200, {"config": {"tip_available": False}})
        if self._match(("POST", f"/api/mini/intakes/{INTAKE_ID}/chat")):
            with self.lock:
                type(self).chat_turn += 1
                turn = type(self).chat_turn
            card = CONFIRM_CARD if turn > 1 else QUESTION_CARD
            return self._json(200, {"reply": card["message"], "guide": card, "guide_version": turn})
        if self._match(("POST", f"/api/mini/intakes/{INTAKE_ID}/submit")):
            return self._json(200, {"job": job_fixture(JOB_B, "ready", 1), "claim_token": CLAIM, "account_claim_token": ACCOUNT_CLAIM})
        if self.command in ("GET", "PATCH") and path.startswith("/api/mini/jobs/") and path.endswith("/sharing"):
            status = self.sharing_status
            if status == HTTPStatus.OK:
                return self._json(200, {"sharing": None})
            return self._json(status, {"error": "fixture sharing unavailable"})
        if self.command == "GET" and path.startswith("/api/mini/jobs/"):
            job_id = path.removeprefix("/api/mini/jobs/").split("/")[0]
            with self.lock:
                type(self).job_get_counts[job_id] = type(self).job_get_counts.get(job_id, 0) + 1
                count = type(self).job_get_counts[job_id]
                delay = type(self).delayed_404.get(job_id)
            if delay is not None and count == 2:
                # Deterministic late-404: the drawer refresh reads normally,
                # the row-click open is slowed and then removed — landing only
                # after the user has switched to another project.
                time.sleep(delay)
                return self._json(404, {"error": "fixture job removed"})
            job = self.jobs.get(job_id)
            if job is None:
                return self._json(404, {"error": "unknown fixture job"})
            return self._json(200, {"job": job, "account_claim_token": ACCOUNT_CLAIM})
        if self.command == "POST" and path.startswith("/api/mini/jobs/") and path.endswith("/changes"):
            job_id = path.removeprefix("/api/mini/jobs/").removesuffix("/changes")
            job = self.jobs.get(job_id)
            if job is None:
                return self._json(404, {"error": "unknown fixture job"})
            updated = dict(job)
            updated["version"] = int(job.get("version", 1)) + 1
            updated["stage"] = "ready"
            updated["result"] = {"title": job["title"], "summary": "Warmer greeting added.", "artifacts": []}
            updated["updated_at"] = 1735689700
            with self.lock:
                self.jobs[job_id] = updated
            return self._json(200, {"job": updated, "account_claim_token": ACCOUNT_CLAIM})
        if self.command in ("GET", "PATCH") and path.startswith("/api/mini/jobs/") and path.endswith("/sharing"):
            status = self.sharing_status
            if status == HTTPStatus.OK:
                return self._json(200, {"sharing": None})
            return self._json(status, {"error": "fixture sharing unavailable"})
        with self.lock:
            type(self).unexpected.append(f"{self.command} {path}")
        return self._json(500, {"error": "unexpected fixture route"})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path.startswith("/api/mini/"):
            return self._api()
        if path in ("/mini-frank", "/mini-frank/"):
            self.path = "/index.html"
        elif path.startswith("/mini-frank/"):
            self.path = path.removeprefix("/mini-frank")
        return super().do_GET()

    def do_POST(self):
        return self._api()

    def do_PATCH(self):
        return self._api()


def saved_row(job_id, stage, title="Quote follow-up"):
    return {
        "id": job_id,
        "claim": CLAIM,
        "title": title,
        "problem": "Quote follow-up",
        "stage": stage,
        "created_at": 1735689600,
        "updated_at": 1735689600,
        "next_action": "Open the result.",
        "transcript": [],
    }


def launch_chromium(playwright):
    try:
        return playwright.chromium.launch(headless=True)
    except Exception:
        candidates = sorted(Path("/root/.cache/ms-playwright").glob("chromium-*/chrome-linux/chrome"))
        if not candidates:
            raise
        return playwright.chromium.launch(headless=True, executable_path=str(candidates[-1]))


@unittest.skipUnless(sync_playwright, "install apps/window/requirements-acceptance.txt in an isolated QA venv")
class MiniBrowserQa(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SCREENSHOTS.mkdir(parents=True, exist_ok=True)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MiniFixtureHandler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}/mini-frank/"
        cls.playwright = sync_playwright().start()
        cls.browser = launch_chromium(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()

    def reset_fixtures(self):
        MiniFixtureHandler.requests = []
        MiniFixtureHandler.unexpected = []
        MiniFixtureHandler.chat_turn = 0
        MiniFixtureHandler.jobs = {
            JOB_A: job_fixture(JOB_A, "working", 1),
            JOB_B: job_fixture(JOB_B, "ready", 1),
        }
        MiniFixtureHandler.job_get_counts = {}
        MiniFixtureHandler.delayed_404 = {}
        MiniFixtureHandler.sharing_status = HTTPStatus.OK

    def open_page(self, width, height, seed_projects=None):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        blocked: list[str] = []
        origin = self.base.split("/mini-frank/")[0]
        context.route("**/*", lambda route: (blocked.append(route.request.url), route.abort())
                      if not route.request.url.startswith(origin) else route.continue_())
        if seed_projects:
            payload = json.dumps(seed_projects).replace("\\", "\\\\").replace("'", "\\'")
            context.add_init_script(
                "try { localStorage.setItem('mini_frank_project_site_projects_v1', '" + payload + "');"
                " localStorage.setItem('mini_frank_account_claim_v1', '" + ACCOUNT_CLAIM + "'); } catch (e) {}"
            )
        page = context.new_page()
        errors: list[str] = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.goto(self.base, wait_until="domcontentloaded")
        page.locator("#message").wait_for()
        return page, context, errors, blocked

    def assert_clean(self, page, width, errors, blocked, unexpected, label):
        self.assertEqual(unexpected, [], f"unexpected fixture routes in {label}")
        self.assertEqual(blocked, [], f"browser attempted non-local requests in {label}")
        self.assertEqual(errors, [], f"console errors in {label}")
        self.assertLessEqual(
            page.evaluate("document.documentElement.scrollWidth"), width,
            f"page overflows at {width}px in {label}",
        )

    def test_guided_journey_submit_and_reflow(self):
        for width, height in ((1440, 900), (390, 844), (320, 700)):
            with self.subTest(width=width):
                self.reset_fixtures()
                page, context, errors, blocked = self.open_page(width, height)
                page.locator("#message").fill("I keep losing quote enquiries")
                page.locator(".send-button").click()
                decision = page.locator(".guide-decision-card").first
                decision.wait_for(timeout=8000)
                self.assertIn("What should people do next?", decision.inner_text())
                page.screenshot(path=str(SCREENSHOTS / f"guide-{width}.png"), full_page=True)
                page.locator('[data-guide-choice="enquiry"]').click()
                resume = page.locator('[data-action="resume"]').first
                resume.wait_for(timeout=8000)
                page.screenshot(path=str(SCREENSHOTS / f"confirm-{width}.png"), full_page=True)
                resume.click()
                page.locator("#current-result").wait_for(timeout=8000)
                # source=start intentionally keeps the project receipt hidden.
                self.assertFalse(page.locator("#project-receipt").is_visible())
                page.screenshot(path=str(SCREENSHOTS / f"submitted-{width}.png"), full_page=True)
                page.keyboard.press("Tab")
                self.assertTrue(page.evaluate("document.activeElement !== document.body"))
                self.assert_clean(page, width, errors, blocked, MiniFixtureHandler.unexpected, f"journey-{width}")
                calls = MiniFixtureHandler.requests
                self.assertIn(("POST", "/api/mini/intakes"), calls)
                self.assertIn(("POST", f"/api/mini/intakes/{INTAKE_ID}/chat"), calls)
                self.assertIn(("POST", f"/api/mini/intakes/{INTAKE_ID}/submit"), calls)
                self.assertTrue(all(path.startswith("/api/mini/") for _method, path in calls if "/api/" in path))
                context.close()

    def test_work_drawer_change_request(self):
        self.reset_fixtures()
        page, context, errors, blocked = self.open_page(1440, 900, seed_projects=[saved_row(JOB_A, "working"), saved_row(JOB_B, "ready")])
        page.locator('[data-action="work"]').first.click()
        row = page.locator(f'[data-project-id="{JOB_B}"]')
        row.wait_for(timeout=8000)
        page.screenshot(path=str(SCREENSHOTS / "work-drawer-1440.png"), full_page=True)
        row.click()
        page.locator("#project-receipt:not([hidden])").wait_for(timeout=8000)
        self.assertEqual(page.evaluate("document.activeElement && document.activeElement.id"), "project-receipt-title")
        page.screenshot(path=str(SCREENSHOTS / "receipt-1440.png"), full_page=True)
        page.locator("#message").fill("Make the greeting warmer")
        page.locator(".send-button").click()
        page.locator("text=Warmer greeting added.").wait_for(timeout=8000)
        page.screenshot(path=str(SCREENSHOTS / "change-1440.png"), full_page=True)
        self.assertIn(("POST", f"/api/mini/jobs/{JOB_B}/changes"), MiniFixtureHandler.requests)
        self.assert_clean(page, 1440, errors, blocked, MiniFixtureHandler.unexpected, "change")
        context.close()

    def test_sharing_failure_recovers_gracefully(self):
        self.reset_fixtures()
        MiniFixtureHandler.sharing_status = HTTPStatus.SERVICE_UNAVAILABLE
        page, context, errors, blocked = self.open_page(1440, 900, seed_projects=[saved_row(JOB_B, "ready")])
        page.locator('[data-action="work"]').first.click()
        page.locator(f'[data-project-id="{JOB_B}"]').click()
        page.locator("#project-receipt:not([hidden])").wait_for(timeout=8000)
        page.locator('[data-action="share"]').first.click()
        status = page.locator("#share-status")
        status.wait_for(timeout=8000)
        page.locator('#share-status:text("Sharing is unavailable right now. Your work stays with you.")').wait_for(timeout=8000)
        self.assertTrue(page.locator("#share-submit").is_disabled())
        page.screenshot(path=str(SCREENSHOTS / "sharing-unavailable-1440.png"), full_page=True)
        # Chromium logs a resource error for any failed HTTP response; the
        # deliberately served 503 is the only acceptable one.
        unexpected_errors = [e for e in errors if not (e.startswith("Failed to load resource") and " 503 " in e)]
        self.assert_clean(page, 1440, unexpected_errors, blocked, MiniFixtureHandler.unexpected, "sharing")
        context.close()

    def test_late_old_job_404_cannot_clear_current_work(self):
        self.reset_fixtures()
        MiniFixtureHandler.jobs[JOB_B] = job_fixture(JOB_B, "ready", 1, title="Steady project")
        # The drawer row click that opens JOB_A is slowed; its 404 lands only
        # after the user has already switched to JOB_B — the stale response
        # must be ignored entirely.
        MiniFixtureHandler.delayed_404[JOB_A] = 1.5
        page, context, errors, blocked = self.open_page(1440, 900, seed_projects=[saved_row(JOB_A, "working"), saved_row(JOB_B, "ready")])
        page.locator('[data-action="work"]').first.click()
        page.locator(f'[data-project-id="{JOB_A}"]').click()
        page.locator('[data-action="work"]').first.click()
        page.locator(f'[data-project-id="{JOB_B}"]').click()
        page.locator("#project-receipt:not([hidden])").wait_for(timeout=8000)
        page.wait_for_timeout(2500)
        self.assertIn("Steady project", page.locator("#current-result h3").first.inner_text())
        body_text = page.locator("#thread").inner_text() if page.locator("#thread").count() else page.locator("body").inner_text()
        self.assertNotIn("couldn’t open that link", body_text)
        stored = page.evaluate("JSON.parse(localStorage.getItem('mini_frank_project_site_projects_v1') || '[]')")
        self.assertEqual(sorted(item["id"] for item in stored), sorted([JOB_A, JOB_B]))
        page.screenshot(path=str(SCREENSHOTS / "late-404-1440.png"), full_page=True)
        # The deliberately served 404 logs one expected resource error.
        unexpected_errors = [e for e in errors if not (e.startswith("Failed to load resource") and " 404 " in e)]
        self.assert_clean(page, 1440, unexpected_errors, blocked, MiniFixtureHandler.unexpected, "late-404")
        context.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
