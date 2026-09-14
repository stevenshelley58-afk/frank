"""Owner workspace acceptance: the G1 integration checkpoint and the release matrix.

This is the consolidated owner-workspace acceptance path. It drives a real
Chromium browser against a real Frank entry point. It is deliberately honest:
every check records what it actually observed, and a check that cannot run is
reported as skipped with a reason rather than passing.

Authentication is supplied, never discovered. Exactly one of these is used:

* ``FRANK_OWNER_STORAGE_STATE`` — a Playwright storage-state file holding the
  owner session. This is the preferred path once the owner session exists,
  because it exercises the real authenticated entry.
* ``FRANK_BROWSER_BASIC_AUTH_USER`` + ``FRANK_BROWSER_BASIC_AUTH_PASSWORD`` —
  the legacy edge credential, for the interim period before the owner session
  replaces it.

No credential value is ever printed, logged or written into the receipt.

Usage (from a checkout's apps/window directory):

    /usr/local/bin/python acceptance/owner_workspace_acceptance.py \
        --base-url https://frank.fail \
        --evidence-dir /srv/frank/verification/owner-workspace-20260914/evidence
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "phone": {"width": 390, "height": 844},
}

# Owner routes that must resolve, render and survive a reload. Each entry is
# (label, path, expect_visible_text_fragment_or_None).
OWNER_ROUTES = [
    ("overview", "/project/blockwise", None),
    ("mail", "/project/blockwise/mail", None),
    ("crm", "/project/blockwise/crm", None),
    ("support", "/project/blockwise/support", None),
    ("campaigns", "/project/blockwise/campaigns", None),
    ("revenue", "/project/blockwise/revenue", None),
    ("results", "/project/blockwise/results", None),
    ("notifications", "/project/blockwise/notifications", None),
]

# Native origins that must be embedded, never opened as a separate tab.
NATIVE_APP_ORIGINS = (
    "https://crm.frank.fail",
    "https://mail.frank.fail",
    "https://marketing.frank.fail",
)


class Blocked(RuntimeError):
    """A check could not run. Recorded as skipped with a reason, never as a pass."""


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _auth_context(browser: Any, viewport: dict[str, int], storage_state: str | None, http_credentials: dict | None) -> Any:
    kwargs: dict[str, Any] = {"viewport": viewport, "reduced_motion": "reduce"}
    if storage_state:
        kwargs["storage_state"] = storage_state
    if http_credentials:
        kwargs["http_credentials"] = http_credentials
    return browser.new_context(**kwargs)


def _resolve_auth() -> tuple[str | None, dict | None]:
    """Return (storage_state_path, http_credentials). Never returns secret values.

    The owner boundary is an identity provider, so a saved owner session is the
    supported path. The legacy edge credential is still accepted because it
    remains valid on the restricted recovery route, but it no longer protects the
    owner surfaces, so using it here would prove nothing about the deployment.
    """
    raw = os.environ.get("FRANK_OWNER_STORAGE_STATE", "").strip()
    if raw:
        path = Path(raw)
        if path.is_symlink() or not path.is_file():
            raise Blocked("FRANK_OWNER_STORAGE_STATE must be a regular storage-state file")
        return str(path), None

    user = os.environ.get("FRANK_BROWSER_BASIC_AUTH_USER", "").strip()
    password = os.environ.get("FRANK_BROWSER_BASIC_AUTH_PASSWORD", "")
    if user and password:
        print(
            "warning: authenticating with the legacy edge credential. That credential "
            "now protects only the restricted recovery route, so this run does not "
            "exercise the owner session. Prefer a session created by "
            "acceptance/owner_session.py.",
            file=sys.stderr,
        )
        return None, {"username": user, "password": password}

    raise Blocked(
        "no owner session available. Create one with "
        "acceptance/owner_session.py and pass it as FRANK_OWNER_STORAGE_STATE; "
        "the owner surfaces are behind the identity provider and there is no "
        "anonymous or credential-in-URL path to them."
    )


def _goto(page: Any, url: str, purpose: str, timeout: int = 45000) -> Any:
    response = page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    if response is None:
        raise RuntimeError(f"{purpose}: navigation returned no response")
    return response


def _iframe_origins(page: Any) -> list[str]:
    """Origins of every live iframe in the document, excluding about:blank."""
    return list(page.evaluate(
        """() => Array.from(document.querySelectorAll('iframe'))
              .map((f) => { try { return new URL(f.src).origin } catch (e) { return '' } })
              .filter((o) => o && o !== 'null')"""
    ))


def check_owner_login_establishes_session(page: Any, base_url: str) -> dict[str, Any]:
    """One owner login reaches the Frank workspace without a further app password."""
    response = _goto(page, base_url.rstrip("/") + "/project/blockwise", "owner overview")
    status = getattr(response, "status", None)
    if status is not None and status >= 400:
        raise RuntimeError(f"owner overview returned HTTP {status}")
    # The workspace host must render something identifying the owner workspace.
    body = page.inner_text("body")
    if not body.strip():
        raise RuntimeError("owner overview rendered an empty document")
    return {
        "status": status,
        "final_url": page.url,
        "title": page.title(),
        "body_chars": len(body),
    }


def check_native_app_embedded(page: Any, route: str, expected_origin: str) -> dict[str, Any]:
    """A native app must render inside the Frank content area, not a new tab."""
    _goto(page, route, f"native app {expected_origin}")
    origins = _iframe_origins(page)
    return {"route": route, "iframe_origins": origins, "expected_origin": expected_origin, "matched": expected_origin in origins}


def check_no_external_tab(page: Any, context: Any, route: str) -> dict[str, Any]:
    """Opening the workspace must not spawn a popup or navigate away from Frank."""
    before = len(context.pages)
    _goto(page, route, f"popup check {route}")
    # The launcher used target="_blank"; assert no anchor in the owner surface
    # still asks the browser for a new tab.
    blank_targets = page.evaluate(
        """() => Array.from(document.querySelectorAll('#owner-dashboard a[target], .owner-workspace a[target]'))
              .map((a) => a.getAttribute('target'))"""
    )
    after = len(context.pages)
    return {"blank_targets": blank_targets, "pages_before": before, "pages_after": after,
            "no_new_tab": after == before, "no_blank_target": len(blank_targets) == 0}


def check_route_survives_reload(page: Any, path: str) -> dict[str, Any]:
    """A shareable owner deep link must resolve to the same route after reload."""
    _goto(page, path, f"reload {path}")
    first = page.url
    page.reload(wait_until="domcontentloaded", timeout=45000)
    second = page.url
    return {"requested": path, "before_reload": first, "after_reload": second,
            "stable": first == second}


def check_back_forward(page: Any, base_url: str) -> dict[str, Any]:
    """Back and Forward must move between owner sections."""
    root = base_url.rstrip("/")
    _goto(page, root + "/project/blockwise", "back/forward start")
    _goto(page, root + "/project/blockwise/crm", "back/forward second")
    page.go_back(wait_until="domcontentloaded", timeout=45000)
    after_back = page.url
    page.go_forward(wait_until="domcontentloaded", timeout=45000)
    after_forward = page.url
    return {
        "after_back": after_back,
        "after_forward": after_forward,
        "back_left_crm": "crm" not in after_back,
        "forward_returned_to_crm": after_forward.rstrip("/").endswith("/crm"),
    }


def check_draft_survives_section_switch(page: Any, base_url: str) -> dict[str, Any]:
    """A recipient-free draft must survive moving to CRM and back, then a reload.

    This only inspects document-level visibility of a composer. It never reads,
    copies or stores message text, and it never sends anything.
    """
    root = base_url.rstrip("/")
    _goto(page, root + "/project/blockwise/mail", "draft: mail")
    mail_frames = page.frames
    composer = None
    for frame in mail_frames:
        try:
            if frame.locator("textarea, [contenteditable='true'], input[name='_to']").count() > 0:
                composer = frame
                break
        except Exception:
            continue
    if composer is None:
        raise Blocked("no mail composer found in the mail surface; the webmail client may not be mounted yet")

    marker = "owner-acceptance-draft"
    try:
        target = composer.locator("textarea, [contenteditable='true']").first
        target.click(timeout=10000)
        target.type(marker, timeout=10000)
    except Exception as exc:
        raise Blocked(f"could not type into the mail composer: {type(exc).__name__}")

    _goto(page, root + "/project/blockwise/crm", "draft: crm")
    _goto(page, root + "/project/blockwise/mail", "draft: back to mail")
    page.reload(wait_until="domcontentloaded", timeout=45000)

    found = False
    for frame in page.frames:
        try:
            if marker in frame.content():
                found = True
                break
        except Exception:
            continue
    return {"marker_present_after_switch_and_reload": found}


def check_logout_blocks_access(context: Any, base_url: str, logout_path: str) -> dict[str, Any]:
    """After logout, a direct native URL must not serve authenticated content."""
    page = context.new_page()
    try:
        _goto(page, base_url.rstrip("/") + logout_path, "logout")
        probe = context.new_page()
        response = _goto(probe, "https://crm.frank.fail/crm/dashboard", "post-logout native probe")
        status = getattr(response, "status", None)
        denied = status is not None and status >= 400
        return {"logout_status_path": logout_path, "native_probe_status": status, "denied": denied}
    finally:
        page.close()


def run(base_url: str, evidence_dir: Path, viewports: list[str]) -> dict[str, Any]:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - environment dependent
        raise Blocked(f"playwright is unavailable: {type(exc).__name__}") from exc

    storage_state, http_credentials = _resolve_auth()
    results: dict[str, Any] = {
        "version": 1,
        "kind": "owner-workspace-acceptance",
        "started_at": _utc(),
        "base_url": base_url,
        "auth_mode": "owner_session" if storage_state else "legacy_edge_basic_auth",
        "viewports": {},
        "checks": {},
        "skipped": {},
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        try:
            for name in viewports:
                viewport = VIEWPORTS[name]
                context = _auth_context(browser, viewport, storage_state, http_credentials)
                page = context.new_page()
                observed: dict[str, Any] = {}
                skipped: dict[str, str] = {}

                def record(key: str, fn: Any) -> None:
                    try:
                        observed[key] = fn()
                    except Blocked as exc:
                        skipped[key] = str(exc)
                    except Exception as exc:  # noqa: BLE001 - recorded verbatim
                        observed[key] = {"error": f"{type(exc).__name__}: {exc}"}

                record("owner_login", lambda: check_owner_login_establishes_session(page, base_url))

                # Route resolution for every owner route.
                route_results = {}
                for label, path, _fragment in OWNER_ROUTES:
                    try:
                        route_results[label] = check_route_survives_reload(page, base_url.rstrip("/") + path)
                    except Blocked as exc:
                        skipped[f"route:{label}"] = str(exc)
                    except Exception as exc:  # noqa: BLE001
                        route_results[label] = {"error": f"{type(exc).__name__}: {exc}"}
                observed["routes"] = route_results

                # Native apps must be embedded, not opened.
                embeds = {}
                for origin in NATIVE_APP_ORIGINS:
                    section = {"https://crm.frank.fail": "crm",
                               "https://mail.frank.fail": "mail",
                               "https://marketing.frank.fail": "campaigns"}[origin]
                    try:
                        embeds[origin] = check_native_app_embedded(page, base_url.rstrip("/") + f"/project/blockwise/{section}", origin)
                    except Blocked as exc:
                        skipped[f"embed:{section}"] = str(exc)
                    except Exception as exc:  # noqa: BLE001
                        embeds[origin] = {"error": f"{type(exc).__name__}: {exc}"}
                observed["native_embeds"] = embeds

                record("no_external_tab", lambda: check_no_external_tab(page, context, base_url.rstrip("/") + "/project/blockwise"))
                record("back_forward", lambda: check_back_forward(page, base_url))
                record("draft_survives_switch", lambda: check_draft_survives_section_switch(page, base_url))
                record("logout_blocks_native", lambda: check_logout_blocks_access(context, base_url, "/logout"))

                results["viewports"][name] = observed
                results["skipped"].update({f"{name}:{k}": v for k, v in skipped.items()})
                context.close()
        finally:
            browser.close()

    results["finished_at"] = _utc()
    evidence_dir.mkdir(parents=True, exist_ok=True)
    out = evidence_dir / "owner-workspace-acceptance.json"
    out.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    results["evidence_path"] = str(out)
    return results


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--viewports", default="desktop,phone")
    args = parser.parse_args(argv)

    viewports = [v.strip() for v in args.viewports.split(",") if v.strip()]
    try:
        results = run(args.base_url, Path(args.evidence_dir), viewports)
    except Blocked as exc:
        print(json.dumps({"status": "blocked", "reason": str(exc)}, indent=2))
        return 3

    # A receipt is written either way; a blocked sub-check is not a failure of
    # the harness, but it is never reported as a pass either.
    errors = sum(
        1
        for viewport in results["viewports"].values()
        for value in viewport.values()
        if isinstance(value, dict) and "error" in value
    )
    print(json.dumps({
        "status": "observed",
        "evidence": results["evidence_path"],
        "skipped": results["skipped"],
        "errors": errors,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
