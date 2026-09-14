#!/usr/bin/env python3
"""Owner webmail launch broker.

Frank authenticates the owner. This broker turns that authenticated request into
a single-use, short-lived launch token that Roundcube's native ``authenticate``
plugin redeems exactly once. It never issues a mailbox credential to the browser
and never writes one to a log.

Three endpoints, all on the private container network:

``GET /healthz``
    Liveness for the compose healthcheck. No authentication needed.

``GET|POST /frank/launch``
    Called by the owner's browser after the ingress identity layer has
    authenticated it. Requires the ingress shared secret and a trusted owner
    identity header. Mints one token, sets it in an HttpOnly cookie and
    redirects to the webmail root.

``POST /internal/consume``
    Called by the Roundcube plugin over the compose network. Atomically marks a
    token used and returns the bound owner identity. A second call with the same
    token fails, which is what makes the launch replay-resistant.

State is a SQLite file on a compose volume. Nothing else is persisted.
"""

from __future__ import annotations

import hmac
import json
import os
import secrets
import sqlite3
import sys
import threading
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

LAUNCH_COOKIE = "frank_launch"
MAX_BODY = 8192
SCHEMA = """
CREATE TABLE IF NOT EXISTS launch_tokens (
    jti        TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    issued_at  INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS launch_tokens_expires_at ON launch_tokens (expires_at);
"""


def _constant_time_eq(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


class LaunchStore:
    """Single-writer token store backed by SQLite."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, mode=0o700, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path, timeout=10, isolation_level=None)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def issue(self, owner: str, ttl_seconds: int) -> str:
        jti = secrets.token_urlsafe(32)
        now = int(time.time())
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM launch_tokens WHERE expires_at < ?", (now,))
            connection.execute(
                "INSERT INTO launch_tokens (jti, owner, issued_at, expires_at, used_at)"
                " VALUES (?, ?, ?, ?, NULL)",
                (jti, owner, now, now + ttl_seconds),
            )
        return jti

    def consume(self, jti: str) -> str | None:
        """Mark ``jti`` used and return its owner. ``None`` means it was not usable."""
        if not jti or len(jti) > 128:
            return None
        now = int(time.time())
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "UPDATE launch_tokens SET used_at = ?"
                " WHERE jti = ? AND used_at IS NULL AND expires_at >= ?",
                (now, jti, now),
            )
            if cursor.rowcount != 1:
                return None
            row = connection.execute(
                "SELECT owner FROM launch_tokens WHERE jti = ?", (jti,)
            ).fetchone()
        return row[0] if row else None

    def pending(self) -> int:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) FROM launch_tokens WHERE used_at IS NULL AND expires_at >= ?",
                (int(time.time()),),
            ).fetchone()
        return int(row[0]) if row else 0


class Settings:
    def __init__(self, environ: dict[str, str]) -> None:
        self.state_dir = environ.get("OWNER_WEBMAIL_STATE_DIR", "/var/lib/owner-webmail-launch")
        self.listen_host = environ.get("OWNER_WEBMAIL_LAUNCH_HOST", "0.0.0.0")
        self.listen_port = int(environ.get("OWNER_WEBMAIL_LAUNCH_PORT", "8080"))
        self.ingress_secret = environ.get("OWNER_WEBMAIL_INGRESS_SECRET", "")
        self.consume_secret = environ.get("OWNER_WEBMAIL_CONSUME_SECRET", "")
        self.ingress_header = environ.get("OWNER_WEBMAIL_INGRESS_HEADER", "X-Owner-Webmail-Ingress")
        self.consume_header = environ.get("OWNER_WEBMAIL_CONSUME_HEADER", "X-Owner-Webmail-Consume")
        self.owner_header = environ.get("OWNER_WEBMAIL_OWNER_HEADER", "X-Frank-Owner")
        self.owner_id = environ.get("OWNER_WEBMAIL_OWNER_ID", "")
        # The owner's mailbox address, echoed to the plugin so it can assert the
        # token was minted for the mailbox it is about to open.
        self.mailbox = environ.get("OWNER_WEBMAIL_MAILBOX", "")
        self.ttl_seconds = int(environ.get("OWNER_WEBMAIL_TOKEN_TTL_SECONDS", "120"))
        self.cookie_samesite = environ.get("OWNER_WEBMAIL_COOKIE_SAMESITE", "Lax")
        self.landing_path = environ.get("OWNER_WEBMAIL_LANDING_PATH", "/")

    def missing_required(self) -> list[str]:
        missing = []
        if len(self.ingress_secret) < 32:
            missing.append("OWNER_WEBMAIL_INGRESS_SECRET")
        if len(self.consume_secret) < 32:
            missing.append("OWNER_WEBMAIL_CONSUME_SECRET")
        if not self.owner_id:
            missing.append("OWNER_WEBMAIL_OWNER_ID")
        if self.cookie_samesite not in ("Lax", "Strict", "None"):
            missing.append("OWNER_WEBMAIL_COOKIE_SAMESITE")
        return missing


class LaunchHandler(BaseHTTPRequestHandler):
    server_version = "owner-webmail-launch"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    settings: Settings
    store: LaunchStore

    # -- plumbing ---------------------------------------------------------
    def log_message(self, fmt: str, *args) -> None:
        # Never let a request line or header reach the log: the launch cookie and
        # the shared secrets travel on these requests.
        sys.stderr.write("%s %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), fmt % args))

    def _send(self, status: HTTPStatus, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: HTTPStatus, payload: dict, headers: dict[str, str] | None = None) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), headers)

    def _read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return {}
        if length <= 0 or length > MAX_BODY:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def _launch_cookie_value(self) -> str:
        raw = self.headers.get("Cookie", "")
        if not raw:
            return ""
        try:
            jar = SimpleCookie()
            jar.load(raw)
        except Exception:  # noqa: BLE001 - a malformed cookie is simply not a launch
            return ""
        morsel = jar.get(LAUNCH_COOKIE)
        return morsel.value if morsel else ""

    # -- endpoints --------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._json(
                HTTPStatus.OK,
                {"ok": True, "pending": self.store.pending(), "service": "owner-webmail-launch"},
            )
            return
        if path == "/frank/launch":
            self._handle_launch()
            return
        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = urlsplit(self.path).path
        if path == "/internal/consume":
            self._handle_consume()
            return
        if path == "/frank/launch":
            self._handle_launch()
            return
        self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def _handle_launch(self) -> None:
        settings = self.settings
        provided = self.headers.get(settings.ingress_header, "")
        if not provided or not _constant_time_eq(provided, settings.ingress_secret):
            self._json(
                HTTPStatus.FORBIDDEN,
                {"ok": False, "error": "untrusted_ingress",
                 "detail": "this endpoint is only reachable through the owner ingress"},
            )
            return

        owner = (self.headers.get(settings.owner_header) or "").strip()
        if not owner:
            self._json(
                HTTPStatus.UNAUTHORIZED,
                {"ok": False, "error": "no_owner_identity",
                 "detail": "the identity layer did not supply an authenticated owner"},
            )
            return
        if settings.owner_id != "*" and not _constant_time_eq(owner, settings.owner_id):
            self._json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "wrong_owner"})
            return

        jti = self.store.issue(owner, settings.ttl_seconds)
        cookie = (
            f"{LAUNCH_COOKIE}={jti}; Path=/; HttpOnly; Secure; "
            f"SameSite={settings.cookie_samesite}; Max-Age={settings.ttl_seconds}"
        )
        landing = settings.landing_path or "/"
        self._send(
            HTTPStatus.SEE_OTHER,
            b"",
            {"Location": landing, "Set-Cookie": cookie},
        )

    def _handle_consume(self) -> None:
        settings = self.settings
        provided = self.headers.get(settings.consume_header, "")
        if not provided or not _constant_time_eq(provided, settings.consume_secret):
            self._json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "untrusted_consumer"})
            return

        payload = self._read_json_body()
        token = str(payload.get("token") or "")
        owner = self.store.consume(token)
        if owner is None:
            self._json(HTTPStatus.GONE, {"ok": False, "error": "token_unusable"})
            return
        self._json(
            HTTPStatus.OK,
            {"ok": True, "owner": owner, "mailbox": settings.mailbox},
        )

    def do_HEAD(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self.do_GET()


class LaunchServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    settings = Settings(dict(os.environ))
    missing = settings.missing_required()
    if missing:
        sys.stderr.write(
            "owner-webmail-launch: refusing to start, missing or invalid: %s\n" % ", ".join(missing)
        )
        return 2
    handler = type(
        "BoundLaunchHandler",
        (LaunchHandler,),
        {"settings": settings, "store": LaunchStore(os.path.join(settings.state_dir, "launch.db"))},
    )
    server = LaunchServer((settings.listen_host, settings.listen_port), handler)
    sys.stderr.write(
        "owner-webmail-launch: listening on %s:%s ttl=%ss samesite=%s\n"
        % (settings.listen_host, settings.listen_port, settings.ttl_seconds, settings.cookie_samesite)
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
