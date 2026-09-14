"""One-off probe: does the owner's first sign-in enrolment actually work?

Drives the real sign-in flow for a throwaway user in the owner group, performs
the authenticator enrolment it is offered, and confirms the resulting session
reaches the owner workspace. Nothing here touches the owner's own account.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import struct
import sys
import time
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, "acceptance")

from owner_session import _resolver_args  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

USER = "mfa-enrol-probe"
PW = open("/tmp/probe-pw").read().strip()
ARGS = _resolver_args("127.0.0.1:9443")


def totp(secret: str) -> str:
    key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
    counter = struct.pack(">Q", int(time.time()) // 30)
    digest = hmac.new(key, counter, hashlib.sha1).digest()
    offset = digest[19] & 15
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


def submit(pg) -> bool:
    for sel in ("button[type='submit']", "input[type='submit']", "button"):
        loc = pg.locator(sel).first
        try:
            if loc.count() and loc.is_visible():
                loc.click()
                return True
        except Exception:
            continue
    pg.keyboard.press("Enter")
    return True


def secret_from(page) -> str:
    html = page.content()
    match = re.search(r"otpauth://totp/[^\"'\s\\]+", html)
    if not match:
        return ""
    raw = unquote(match.group(0)).replace("&amp;", "&")
    return parse_qs(urlparse(raw).query).get("secret", [""])[0]


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox", *ARGS])
    ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    try:
        pg.goto("https://frank.fail:9443/project/blockwise", wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(4000)
        print("1 anonymous lands on :", pg.url.split("?")[0][:72])

        for _ in range(5):
            f = pg.locator("input[type='password']").first
            if f.count() and f.is_visible():
                f.fill(PW)
                submit(pg)
                pg.wait_for_timeout(3500)
                continue
            f = pg.locator("input[name='uidField'], input[autocomplete='username'], input[type='text']").first
            if f.count() and f.is_visible():
                f.fill(USER)
                submit(pg)
                pg.wait_for_timeout(3500)
                continue
            break
        print("2 after credentials  :", pg.url.split("?")[0][:72])

        offered = pg.locator("text=/scan|QR|authenticator|Set up|Enroll|Configure/i").count() > 0
        print("3 enrolment offered  :", offered)
        secret = secret_from(pg)
        print("4 secret from QR     :", bool(secret))

        if secret:
            # The enrolment stage asks for the secret to be entered back, so the
            # same code proves the QR is usable rather than merely displayed.
            code_field = pg.locator("input[name='code'], input[inputmode='numeric'], input[autocomplete='one-time-code']").first
            if code_field.count() and code_field.is_visible():
                code_field.fill(totp(secret))
                submit(pg)
                pg.wait_for_timeout(5000)
            print("5 after enrolment    :", pg.url.split("?")[0][:72])

            # A second factor may now be demanded for the completed login.
            for _ in range(3):
                code_field = pg.locator("input[name='code'], input[inputmode='numeric'], input[autocomplete='one-time-code']").first
                if not (code_field.count() and code_field.is_visible()):
                    break
                code_field.fill(totp(secret))
                submit(pg)
                pg.wait_for_timeout(4500)

        pg.goto("https://frank.fail:9443/project/blockwise", wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(5000)
        workspace = pg.locator(".owner-workspace").count()
        print("6 final address      :", pg.url.split("?")[0][:72])
        print("7 owner workspace    :", workspace > 0)
        print("8 VERDICT            :", "enrolment-and-session-ok" if workspace > 0 else "did-not-reach-workspace")
    finally:
        ctx.close()
        browser.close()
