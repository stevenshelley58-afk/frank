"""Path-aware Docker-to-host bridge for pinned `hermes serve` (loopback-only).

Binds the private Docker-bridge interface (172.16.1.1) and forwards only
allowlisted paths/methods to upstream `hermes serve` on host loopback
127.0.0.1:9119. Rules frozen by FRANK_HERMES_V021_CONTRACT:
- upstream Host header is always forced to 127.0.0.1:9119;
- browser `Origin` headers are rejected (no cross-site browser use);
- the upstream session token is required on every forwarded request and is
  passed through only as the `X-Hermes-Session-Token` header — it is never
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
)


def _allowed(path: str, method: str) -> bool:
    for prefix, methods in ALLOWED:
        if path == prefix or path.startswith(prefix + "/") or (prefix.endswith("*") and path.startswith(prefix[:-1])):
            return method in methods
    return False


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
        token = self.headers.get("X-Hermes-Session-Token", "")
        if not token:
            self._reply(403, "session token required")
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        try:
            conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=UPSTREAM_TIMEOUT)
            headers = {
                "Host": f"{UPSTREAM_HOST}:{UPSTREAM_PORT}",
                "X-Hermes-Session-Token": token,
                "Accept": self.headers.get("Accept", "application/json"),
            }
            if length:
                headers["Content-Type"] = self.headers.get("Content-Type", "application/json")
            conn.request(self.command, path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            for key in ("Content-Type",):
                if resp.getheader(key):
                    self.send_header(key, resp.getheader(key))
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            conn.close()
        except (OSError, TimeoutError) as error:
            self._reply(502, f"upstream unavailable: {error}")

    do_GET = do_POST = do_PATCH = do_DELETE = _proxy  # noqa: N815

    def log_message(self, fmt: str, *args) -> None:
        # Redact complete URLs/queries: log method + status only.
        sys.stderr.write("%s\n" % self.command)


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    server.serve_forever()
