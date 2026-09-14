"""Establish a real owner session and save it for the acceptance harness.

The owner boundary is now an identity provider, not HTTP Basic Auth. That means
acceptance can no longer be authenticated by putting a credential in a URL: the
session has to be created the way the owner creates it, through the real sign-in
flow, and then reused. This script does exactly that and nothing else.

It drives the provider's own login page in a real browser, so it exercises the
same flow the owner does. Multi-factor is handled honestly rather than bypassed:
if the provider asks for a second factor, this script asks for the current code
and submits it. There is no flag to skip that step, because a bypass would prove
nothing about the deployment.

The output is a Playwright storage-state file. Treat it as a credential: it holds
a live session. It is written outside the repository with owner-only permissions,
and no cookie or token value is ever printed.

Usage:

    FRANK_OWNER_LOGIN_USER=owner \
    FRANK_OWNER_LOGIN_PASSWORD=... \
    /srv/frank/acceptance-venv/bin/python acceptance/owner_session.py \
        --base-url https://frank.fail \
        --out /srv/frank/verification/owner-workspace-20260914/owner-session.json

Add ``--base-url https://frank.fail:9443 --insecure`` to run against the
acceptance edge instead of production.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

DEFAULT_TIMEOUT_MS = 60_000

# Field names are not assumed. The provider's flow renders different stages
# (identification, password, authenticator, consent) and its markup is not a
# contract we own, so each stage is matched by input type and role instead.
PASSWORD_SELECTORS = (
    "input[type='password']",
    "input[name='password']",
    "input[autocomplete='current-password']",
)
USERNAME_SELECTORS = (
    "input[name='uidField']",
    "input[autocomplete='username']",
    "input[type='text']",
    "input[type='email']",
)
SUBMIT_SELECTORS = (
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Log in')",
    "button:has-text('Continue')",
    "button:has-text('Next')",
)
CODE_SELECTORS = (
    "input[name='code']",
    "input[autocomplete='one-time-code']",
    "input[inputmode='numeric']",
    "input[name='totp']",
)


def _first_visible(page, selectors, timeout_ms: int = 4000):
    """The first selector that is present and visible, or None."""
    deadline_selectors = list(selectors)
    for selector in deadline_selectors:
        try:
            locator = page.locator(selector).first
            locator.wait_for(state="visible", timeout=timeout_ms)
            return locator
        except Exception:
            continue
    return None


def _click_submit(page) -> bool:
    for selector in SUBMIT_SELECTORS:
        try:
            button = page.locator(selector).first
            if button.count() and button.is_visible():
                button.click()
                return True
        except Exception:
            continue
    # Some stages submit on Enter from the active field.
    try:
        page.keyboard.press("Enter")
        return True
    except Exception:
        return False


def _prompt_code() -> str:
    code = os.environ.get("FRANK_OWNER_LOGIN_TOTP", "").strip()
    if code:
        return code
    if not sys.stdin.isatty():
        raise SystemExit(
            "the provider asked for a second factor and no code was supplied; "
            "set FRANK_OWNER_LOGIN_TOTP or run this interactively"
        )
    return input("Enter the current authenticator code: ").strip()


def _settle(page, timeout_ms: int = DEFAULT_TIMEOUT_MS) -> None:
    try:
        page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    except Exception:
        pass


def login(base_url: str, user: str, password: str, out: Path, insecure: bool, headless: bool) -> int:
    from playwright.sync_api import sync_playwright

    out.parent.mkdir(parents=True, exist_ok=True)
    target = base_url.rstrip("/") + "/project/blockwise"

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"], headless=headless)
        context = browser.new_context(ignore_https_errors=insecure, viewport={"width": 1280, "height": 900})
        page = context.new_page()
        try:
            page.goto(target, wait_until="domcontentloaded", timeout=DEFAULT_TIMEOUT_MS)
            _settle(page)

            # Stage 1: identification and/or password. The provider may combine
            # them or split them, so both are attempted in order until the page
            # stops offering them.
            for attempt in range(4):
                field = _first_visible(page, PASSWORD_SELECTORS)
                if field is not None:
                    field.fill(password)
                    _click_submit(page)
                    _settle(page)
                    continue
                user_field = _first_visible(page, USERNAME_SELECTORS, timeout_ms=2500)
                if user_field is not None:
                    user_field.fill(user)
                    _click_submit(page)
                    _settle(page)
                    continue
                break

            # Stage 2: second factor. Asked for, never skipped.
            for _ in range(3):
                code_field = _first_visible(page, CODE_SELECTORS, timeout_ms=4000)
                if code_field is None:
                    break
                code_field.fill(_prompt_code())
                _click_submit(page)
                _settle(page)

            # Confirm the session actually reaches Frank rather than a provider
            # page that merely looks finished.
            page.goto(target, wait_until="domcontentloaded", timeout=DEFAULT_TIMEOUT_MS)
            _settle(page)
            workspace = page.locator(".owner-workspace, #owner-dashboard").count()
            on_frank = page.url.startswith(base_url.rstrip("/"))
            if not on_frank or workspace == 0:
                print(
                    "sign-in did not reach the owner workspace. Final address was "
                    f"{page.url.split('?')[0]}. No session file was written.",
                    file=sys.stderr,
                )
                return 4

            context.storage_state(path=str(out))
            os.chmod(out, 0o600)
            print(f"owner session established and written to {out} (mode 0600)")
            print("this file is a live credential; delete it when acceptance is done")
            return 0
        finally:
            context.close()
            browser.close()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://frank.fail")
    parser.add_argument("--out", required=True)
    parser.add_argument("--insecure", action="store_true", help="accept a self-signed certificate")
    parser.add_argument("--headed", action="store_true", help="show the browser, useful when enrolling MFA")
    args = parser.parse_args(argv)

    user = os.environ.get("FRANK_OWNER_LOGIN_USER", "").strip()
    password = os.environ.get("FRANK_OWNER_LOGIN_PASSWORD", "")
    if not user or not password:
        print(
            "FRANK_OWNER_LOGIN_USER and FRANK_OWNER_LOGIN_PASSWORD are required. "
            "They are read from the environment only and are never written to disk.",
            file=sys.stderr,
        )
        return 2

    return login(args.base_url, user, password, Path(args.out), args.insecure, not args.headed)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
