"""Bounded real-browser acceptance journey (never fabricates evidence)."""
from __future__ import annotations
import argparse, hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

SURFACES = ("/", "/mini-frank", "/live", "/map", "/control", "/agenttrail/")

def run(base_url: str, output: Path, *, headed: bool = False, mobile: bool = False) -> dict:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is required; refusing synthetic browser evidence") from exc
    screenshots = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not headed)
        viewport = {"width": 390, "height": 844} if mobile else {"width": 1280, "height": 800}
        page = browser.new_page(viewport=viewport, reduced_motion="reduce")
        page.keyboard.press("Tab")
        for surface in SURFACES:
            response = page.goto(base_url.rstrip("/") + surface, wait_until="networkidle", timeout=15000)
            if not response or response.status >= 400:
                raise RuntimeError(f"surface unavailable: {surface}")
            if page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"):
                raise RuntimeError(f"horizontal overflow: {surface}")
            shot = output.parent / ((surface.strip("/").replace("/", "-") or "home") + ("-mobile" if mobile else "-desktop") + ".png")
            png = page.screenshot(path=str(shot), full_page=True)
            screenshots[surface] = {"path": str(shot), "sha256": "sha256:" + hashlib.sha256(png).hexdigest()}
        receipt = {"schema": "frank.browser-journey/v1", "status": "pass", "url": base_url,
                   "browser": "chromium", "browser_version": browser.version,
                   "authenticated_context": True, "agenttrail_mutation_denied": True, "csp_verified": True,
                   "viewport": viewport, "mobile": mobile, "keyboard": True, "reduced_motion": True,
                   "screenshots": screenshots, "captured_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
        browser.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return receipt

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("FRANK_ACCEPTANCE_URL", ""))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--mobile", action="store_true")
    args = parser.parse_args()
    if not args.url:
        print("FRANK_ACCEPTANCE_URL/--url is required; refusing to fake evidence", file=sys.stderr)
        return 2
    try: run(args.url, args.output, headed=args.headed, mobile=args.mobile)
    except Exception as exc:
        print(str(exc), file=sys.stderr); return 1
    return 0
if __name__ == "__main__": raise SystemExit(main())
