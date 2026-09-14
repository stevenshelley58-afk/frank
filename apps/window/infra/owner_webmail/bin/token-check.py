#!/usr/bin/env python3
"""Operator diagnostic for the owner webmail launch session.

Runs inside the launch container (the wrapper pipes it in with ``docker exec -i``)
and exercises the real HTTP surface, so it proves the properties the design
claims rather than restating them:

* a request without the ingress proof is refused,
* a request without an authenticated owner identity is refused,
* a minted token is redeemed exactly once,
* a second redemption of the same token is refused,
* the token lifetime is the configured short one.

It reads the shared secrets from the process environment and never prints one.
"""

from __future__ import annotations

import http.cookies
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:%s" % os.environ.get("OWNER_WEBMAIL_LAUNCH_PORT", "8080")
STATE = os.path.join(os.environ.get("OWNER_WEBMAIL_STATE_DIR", "/var/lib/owner-webmail-launch"), "launch.db")
INGRESS_SECRET = os.environ.get("OWNER_WEBMAIL_INGRESS_SECRET", "")
CONSUME_SECRET = os.environ.get("OWNER_WEBMAIL_CONSUME_SECRET", "")
OWNER_HEADER = os.environ.get("OWNER_WEBMAIL_OWNER_HEADER", "X-Frank-Owner")
OWNER_ID = os.environ.get("OWNER_WEBMAIL_OWNER_ID", "")
TTL = int(os.environ.get("OWNER_WEBMAIL_TOKEN_TTL_SECONDS", "120"))

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str) -> None:
    results.append((name, ok, detail))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The mint response is a 303 whose cookie we must read, not follow."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def request(path: str, headers: dict[str, str], method: str = "GET", body: bytes | None = None):
    """Return (status, headers, body-bytes) without raising on 4xx/5xx."""
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with _opener.open(req, timeout=10) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def main() -> int:
    owner = "owner@blockwise.sale" if OWNER_ID in ("", "*") else OWNER_ID

    status, _, _ = request("/frank/launch", {OWNER_HEADER: owner})
    record("launch without the ingress proof is refused", status == 403, "status=%s" % status)

    status, _, _ = request("/frank/launch", {"X-Owner-Webmail-Ingress": INGRESS_SECRET})
    record("launch without an authenticated owner is refused", status == 401, "status=%s" % status)

    status, headers, _ = request(
        "/frank/launch",
        {"X-Owner-Webmail-Ingress": INGRESS_SECRET, OWNER_HEADER: owner},
    )
    record("authenticated launch is minted", status == 303, "status=%s location=%s" % (status, headers.get("Location")))

    jar = http.cookies.SimpleCookie()
    jar.load(headers.get("Set-Cookie", ""))
    morsel = jar.get("frank_launch")
    if morsel is None:
        record("launch cookie is issued", False, "no frank_launch cookie")
        return report()
    record("launch cookie is issued HttpOnly and Secure", bool(morsel["httponly"]) and bool(morsel["secure"]), "samesite=%s" % morsel["samesite"])
    token = morsel.value

    status, _, body = request(
        "/internal/consume",
        {"X-Owner-Webmail-Consume": CONSUME_SECRET, "Content-Type": "application/json"},
        method="POST",
        body=json.dumps({"token": token}).encode(),
    )
    payload = json.loads(body or b"{}")
    record("first redemption succeeds", status == 200 and payload.get("ok") is True, "status=%s owner=%s" % (status, payload.get("owner")))

    status, _, body = request(
        "/internal/consume",
        {"X-Owner-Webmail-Consume": CONSUME_SECRET, "Content-Type": "application/json"},
        method="POST",
        body=json.dumps({"token": token}).encode(),
    )
    record("second redemption of the same token is refused", status == 410, "status=%s body=%s" % (status, (body or b"").decode()[:80]))

    status, _, _ = request(
        "/internal/consume",
        {"Content-Type": "application/json"},
        method="POST",
        body=json.dumps({"token": token}).encode(),
    )
    record("redemption without the consumer secret is refused", status == 403, "status=%s" % status)

    try:
        with sqlite3.connect(STATE) as connection:
            row = connection.execute("SELECT expires_at - issued_at FROM launch_tokens ORDER BY issued_at DESC LIMIT 1").fetchone()
        lifetime = int(row[0]) if row else -1
    except sqlite3.Error as error:
        lifetime = -1
        record("token store readable", False, str(error))
    else:
        record("token store readable", True, "rows readable")
    record("minted token lifetime is the configured short one", lifetime == TTL, "lifetime=%ss configured=%ss" % (lifetime, TTL))

    return report()


def report() -> int:
    failed = 0
    for name, ok, detail in results:
        print("%s  %s  (%s)" % ("PASS" if ok else "FAIL", name, detail))
        failed += 0 if ok else 1
    print("token-check: %d of %d checks passed" % (len(results) - failed, len(results)))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
