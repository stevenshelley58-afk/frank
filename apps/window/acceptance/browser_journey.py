"""Real, read-only browser acceptance evidence for the Step 8 release gate."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "mobile": {"width": 390, "height": 844}}
SURFACES = ("/", "/mini-frank", "/live", "/map", "/control", "/agenttrail/")


def _sha(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _response_ok(response: Any, purpose: str) -> None:
    if response is None or response.status >= 400:
        raise RuntimeError(f"{purpose} was unavailable")


def _storage_state() -> str:
    """Validate state location but never read or print credential contents."""
    raw = os.environ.get("FRANK_STORAGE_STATE", "").strip()
    if not raw:
        raise RuntimeError("FRANK_STORAGE_STATE is required for authenticated acceptance")
    path = Path(raw)
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("FRANK_STORAGE_STATE must be a regular storage-state file")
    return str(path)


def _basic_auth() -> dict[str, str]:
    """Read production Basic Auth without exposing either credential."""
    username = os.environ.get("FRANK_BROWSER_BASIC_AUTH_USER", "").strip()
    password = os.environ.get("FRANK_BROWSER_BASIC_AUTH_PASSWORD", "")
    if bool(username) != bool(password):
        raise RuntimeError("FRANK_BROWSER_BASIC_AUTH_USER and PASSWORD must be supplied together")
    if not username:
        raise RuntimeError("FRANK_BROWSER_BASIC_AUTH_USER and PASSWORD are required")
    return {"username": username, "password": password}


def _navigate(page: Any, base_url: str, surface: str) -> Any:
    # AgentTrail's board intentionally keeps an EventSource open, so waiting
    # for network-idle would make the real read-only route time out forever.
    response = page.goto(base_url.rstrip("/") + surface, wait_until="domcontentloaded", timeout=30000)
    _response_ok(response, surface)
    if page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"):
        raise RuntimeError(f"horizontal overflow: {surface}")
    return response


def _click(page: Any, selector: str, purpose: str) -> None:
    item = page.locator(selector)
    if item.count() < 1:
        raise RuntimeError(f"missing {purpose}")
    item.first.click()


def _run_viewport(browser: Any, base_url: str, evidence_root: Path, name: str, viewport: dict[str, int], storage_state: str, basic_auth: dict[str, str]) -> dict[str, Any]:
    # ``storage_state`` belongs to a browser context, not a page.  Creating a
    # fresh context per viewport also prevents desktop state leaking into the
    # mobile result while retaining the operator-supplied authenticated state.
    context = browser.new_context(viewport=viewport, reduced_motion="reduce", storage_state=storage_state, http_credentials=basic_auth)
    page = context.new_page()
    outcomes: dict[str, bool] = {}
    screenshots: dict[str, dict[str, str]] = {}
    try:
        home = _navigate(page, base_url, "/")
        headers = {str(k).lower(): str(v) for k, v in home.headers.items()}
        outcomes["csp"] = bool(headers.get("content-security-policy")) or page.locator("meta[http-equiv='Content-Security-Policy']").count() > 0
        page.keyboard.press("Tab")
        outcomes["keyboard"] = bool(page.evaluate("document.activeElement && document.activeElement !== document.body"))
        outcomes["reduced_motion"] = bool(page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"))
        page.evaluate("localStorage.setItem('frank-acceptance-preservation', '1')")
        _navigate(page, base_url, "/mini-frank")
        outcomes["mini_frank_preserved"] = bool(page.evaluate("localStorage.getItem('frank-acceptance-preservation') === '1'"))
        _navigate(page, base_url, "/live")
        outcomes["live_navigation"] = page.locator("iframe.live-frame").count() == 1
        _navigate(page, base_url, "/map")
        _click(page, ".map-row", "validated map projection")
        frame = page.locator("iframe.map-frame").first
        outcomes["map_navigation"] = frame.count() == 1
        outcomes["map_artifact"] = "/api/control/maps/artifact?projection_id=" in str(frame.get_attribute("src"))
        _navigate(page, base_url, "/control")
        records = page.locator(".control-row")
        outcomes["control_navigation"] = records.count() > 0
        if not outcomes["control_navigation"]:
            raise RuntimeError("control has no evidence-backed records")
        _click(page, ".control-row[data-record-id='service:frank-window']", "Frank runtime record")
        outcomes["records"] = bool(page.locator("#control-inspector").inner_text().strip())
        runtime_fact = page.locator(".runtime-fact")
        runtime_fact.wait_for(timeout=10000)
        outcomes["runtime_summary"] = runtime_fact.count() > 0
        export_href = page.locator("#control-export").get_attribute("href")
        export = page.request.get(base_url.rstrip("/") + str(export_href)) if export_href else None
        outcomes["export"] = export is not None and export.status < 400 and len(export.body()) > 0
        page.locator("#control-import-input").set_input_files({"name": "acceptance-preview.json", "mimeType": "application/json", "buffer": b'{"schema":"frank.acceptance/v1"}'})
        page.locator("#control-inspector").get_by_text("Import preview").wait_for(timeout=10000)
        outcomes["import_preview"] = "no canonical source or control state was changed" in page.locator("#control-inspector").inner_text().lower()
        mutation = page.request.fetch(base_url.rstrip("/") + "/agenttrail/setup", method="POST", data="{}", headers={"Content-Type": "application/json"})
        outcomes["agenttrail_mutation_denied"] = mutation.status == 403
        for surface in SURFACES:
            _navigate(page, base_url, surface)
            filename = f"{name}-{surface.strip('/').replace('/', '-') or 'home'}.png"
            png = page.screenshot(path=str(evidence_root / filename), full_page=True)
            screenshots[surface] = {"path": filename, "sha256": _sha(png)}
        outcomes["no_overflow"] = True
    finally:
        page.close()
        context.close()
    return {"viewport": viewport, "outcomes": outcomes, "screenshots": screenshots}


def run(base_url: str, output: Path, *, headed: bool = False) -> dict[str, Any]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is required; refusing synthetic browser evidence") from exc
    storage_state = _storage_state()
    basic_auth = _basic_auth()
    if output.is_symlink():
        raise RuntimeError("evidence receipt must not be a symlink")
    output = output.resolve()
    evidence_root = output.parent
    if evidence_root.is_symlink():
        raise RuntimeError("evidence root must not be a symlink")
    evidence_root.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not headed)
        try:
            journeys = {name: _run_viewport(browser, base_url, evidence_root, name, viewport, storage_state, basic_auth) for name, viewport in VIEWPORTS.items()}
            browser_version = browser.version
        finally:
            browser.close()
    all_outcomes = all(value is True for journey in journeys.values() for value in journey["outcomes"].values())
    receipt = {"schema": "frank.browser-journey/v2", "status": "pass" if all_outcomes else "fail", "url": base_url,
               "browser": "chromium", "browser_version": browser_version, "authenticated_context": True,
               "journeys": journeys, "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
    output.write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("FRANK_ACCEPTANCE_URL", ""))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    if not args.url:
        print("FRANK_ACCEPTANCE_URL/--url is required; refusing to fake evidence", file=sys.stderr)
        return 2
    try:
        return 0 if run(args.url, args.output, headed=args.headed)["status"] == "pass" else 1
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
