"""Path-aware Docker-to-host bridge for pinned `hermes serve` (loopback-only).

Binds the private Docker-bridge interface (172.16.1.1) and forwards only
allowlisted paths/methods to upstream `hermes serve` on host loopback
127.0.0.1:9119. Rules frozen by FRANK_HERMES_V021_CONTRACT:
- upstream Host header is always forced to 127.0.0.1:9119;
- browser `Origin` headers are rejected (no cross-site browser use);
- the upstream session token is required for operator requests; the narrower
  customer read token is accepted only for GET/HEAD Ad DB ad reads;
  credentials are forwarded only in their original auth header and are never
  logged, echoed, or stored;
- complete URLs/queries are redacted from logs;
- no WebSocket upgrade, no raw relay beyond the allowlist.
"""
from __future__ import annotations

import http.client
import os
import sys
from urllib.parse import urlsplit

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_HOST = os.environ.get("FRANK_BRIDGE_HOST", "172.16.1.1")
LISTEN_PORT = int(os.environ.get("FRANK_SERVE_BRIDGE_PORT", "9119"))
UPSTREAM_HOST = "127.0.0.1"
UPSTREAM_PORT = int(os.environ.get("FRANK_SERVE_UPSTREAM_PORT", "9119"))
UPSTREAM_TIMEOUT = float(os.environ.get("FRANK_SERVE_BRIDGE_TIMEOUT", "120"))

# path prefix -> allowed methods (contracted serve surface only)
ALLOWED: tuple[tuple[str, frozenset], ...] = (
    ("/api/status", frozenset({"GET"})),
    ("/api/health", frozenset({"GET"})),
    ("/api/model/options", frozenset({"GET"})),
    ("/api/audio/transcribe", frozenset({"POST"})),
    ("/api/sessions", frozenset({"GET", "POST", "PATCH", "DELETE"})),
    ("/v1/ad-db", frozenset({"GET", "HEAD", "POST"})),
)

REQUEST_PASSTHROUGH_HEADERS = ("Range", "If-Range", "If-None-Match")
RESPONSE_PASSTHROUGH_HEADERS = (
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
    "Cache-Control",
)


def _allowed(path: str, method: str) -> bool:
    for prefix, methods in ALLOWED:
        if path == prefix or path.startswith(prefix + "/") or (prefix.endswith("*") and path.startswith(prefix[:-1])):
            return method in methods
    return False


def _auth_headers(path: str, method: str, headers) -> dict[str, str]:
    session_token = headers.get("X-Hermes-Session-Token", "")
    if session_token:
        return {"X-Hermes-Session-Token": session_token}
    customer_token = headers.get("X-Hermes-Ad-Db-Read-Token", "")
    is_customer_read = path == "/v1/ad-db/ads" or path.startswith("/v1/ad-db/ads/")
    if customer_token and is_customer_read and method in {"GET", "HEAD"}:
        return {"X-Hermes-Ad-Db-Read-Token": customer_token}
    return {}


class Handler(BaseHTTPRequestHandler):
    server_version = "frank-serve-bridge/1"
    protocol_version = "HTTP/1.1"

    def _reply(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self) -> None:
        if self.headers.get("Origin"):
            self._reply(403, "origin rejected")
            return
        split = urlsplit(self.path)
        path = f"{split.path}?{split.query}" if split.query else split.path
        if not _allowed(split.path, self.command):
            self._reply(404, "path not allowed")
            return
        auth_headers = _auth_headers(split.path, self.command, self.headers)
        if not auth_headers:
            self._reply(403, "private credential required")
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        try:
            conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=UPSTREAM_TIMEOUT)
            headers = {
                "Host": f"{UPSTREAM_HOST}:{UPSTREAM_PORT}",
                "Accept": self.headers.get("Accept", "application/json"),
                **auth_headers,
            }
            if length:
                headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
            for key in REQUEST_PASSTHROUGH_HEADERS:
                if self.headers.get(key):
                    headers[key] = self.headers[key]
            conn.request(self.command, path, body=body, headers=headers)
            resp = conn.getresponse()
            self.send_response(resp.status)
            forwarded_length = False
            for key in RESPONSE_PASSTHROUGH_HEADERS:
                if value := resp.getheader(key):
                    self.send_header(key, value)
                    forwarded_length = forwarded_length or key == "Content-Length"
            if not forwarded_length:
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()
            if self.command != "HEAD" and resp.status != 304:
                while chunk := resp.read(64 * 1024):
                    self.wfile.write(chunk)
            conn.close()
        except (OSError, TimeoutError) as error:
            self._reply(502, f"upstream unavailable: {error}")

    do_GET = do_HEAD = do_POST = do_PATCH = do_DELETE = _proxy  # noqa: N815

    def log_message(self, fmt: str, *args) -> None:
        # Redact complete URLs/queries: log method + status only.
        sys.stderr.write("%s\n" % self.command)


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    server.serve_forever()
