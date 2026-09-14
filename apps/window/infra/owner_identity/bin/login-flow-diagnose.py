"""Diagnostic: what stages does the owner sign-in flow actually present?"""

from __future__ import annotations

import sys

sys.path.insert(0, "acceptance")

from owner_session import _resolver_args  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

USER = "mfa-enrol-probe"
PW = open("/tmp/probe-pw").read().strip()

USER_SEL = "input[name='uidField'], input[autocomplete='username'], input[type='text']"
PASS_SEL = "input[type='password']"

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox", *_resolver_args("127.0.0.1:9443")])
    ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()

    def dump(tag: str) -> None:
        fields = pg.evaluate(
            """() => Array.from(document.querySelectorAll('input,button,select'))
                 .filter(e => e.offsetWidth || e.offsetHeight)
                 .map(e => ({tag:e.tagName, type:e.type||'', name:e.name||'', ph:e.placeholder||'',
                             txt:(e.textContent||'').trim().slice(0,22)}))"""
        )
        print(f"{tag} url   :", pg.url.split("?")[0][:78])
        print(f"{tag} fields:", fields)
        print(f"{tag} text  :", pg.inner_text("body")[:200].replace("\n", " | "))

    try:
        pg.goto("https://frank.fail:9443/project/blockwise", wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(4500)
        dump("A")

        user_field = pg.locator(USER_SEL).first
        print("username field count:", user_field.count())
        if user_field.count():
            user_field.fill(USER)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(4500)
        dump("B")

        pass_field = pg.locator(PASS_SEL).first
        print("password field count:", pass_field.count())
        if pass_field.count():
            pass_field.fill(PW)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(5500)
        dump("C")
    finally:
        ctx.close()
        browser.close()
