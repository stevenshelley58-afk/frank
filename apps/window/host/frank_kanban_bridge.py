"""Host-side Kanban CLI bridge for the Frank container (run as User=hermes).

Binds the private Docker-bridge interface only, requires a runtime Bearer
credential, validates the verb against the same frozen allowlist as the
container-side port, and executes the pinned `hermes kanban … --json` argv
with no shell. Every other path/method is refused.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_HOST = os.environ.get("FRANK_BRIDGE_HOST", "172.16.1.1")
LISTEN_PORT = int(os.environ.get("FRANK_KANBAN_BRIDGE_PORT", "8643"))
KEY_FILE = os.environ.get("FRANK_KANBAN_BRIDGE_KEY_FILE", "/srv/frank/secrets/kanban-bridge.key")
HERMES_PY = os.environ.get("HERMES_PY", "/home/hermes/.hermes/hermes-agent-v021/venv/bin/python")
CLI_MODULE = "hermes_cli.main"
MAX_ARGS = 24
MAX_ARG_LEN = 4096

ALLOWED_VERBS = frozenset({
    "create", "show", "list", "comment", "attach", "promote", "assign",
    "dispatch", "block", "unblock", "request-review", "request-changes",
    "reclaim", "complete", "archive", "runs", "log", "boards",
})
_ARG_SAFE = re.compile(r"^[\w .,@/:+=\[\]{}()\"'-]+$")


def _load_key() -> bytes:
    with open(KEY_FILE, "rb") as handle:
        return handle.read().strip()


def _run_kanban(verb: str, args: list) -> dict:
    argv = [HERMES_PY, "-m", CLI_MODULE, "kanban", verb, *args]
    completed = subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=60,
        env={"PATH": "/usr/bin:/bin", "HOME": "/home/hermes", "HERMES_PROFILE": "default"},
    )
    stdout = completed.stdout or ""
    if completed.returncode != 0:
        detail = (completed.stderr or stdout).strip()[:400]
        return {"ok": False, "error": detail or f"kanban CLI exited {completed.returncode}"}
    text = stdout.strip()
    if not text:
        return {"ok": True, "data": {}}
    try:
        return {"ok": True, "data": json.loads(text)}
    except json.JSONDecodeError:
        return {"ok": True, "data": {"raw": text[:20000]}}


class Handler(BaseHTTPRequestHandler):
    server_version = "frank-kanban-bridge/1"
    protocol_version = "HTTP/1.1"

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._reply(200, {"ok": True, "service": "frank-kanban-bridge"})
        else:
            self._reply(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/kanban":
            self._reply(404, {"ok": False, "error": "not found"})
            return
        auth = self.headers.get("Authorization", "")
        expected = b"Bearer "
        if not auth.startswith("Bearer ") or not hmac.compare_digest(
            auth[7:].encode("utf-8"), _load_key()
        ):
            self._reply(403, {"ok": False, "error": "forbidden"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, json.JSONDecodeError):
            self._reply(400, {"ok": False, "error": "invalid JSON body"})
            return
        verb = str(body.get("verb", ""))
        args = body.get("args", [])
        if verb not in ALLOWED_VERBS:
            self._reply(400, {"ok": False, "error": "verb not allowed"})
            return
        if not isinstance(args, list) or len(args) > MAX_ARGS or not all(
            isinstance(a, (str, int, float)) and len(str(a)) <= MAX_ARG_LEN and _ARG_SAFE.match(str(a))
            for a in args
        ):
            self._reply(400, {"ok": False, "error": "args not allowed"})
            return
        self._reply(200, _run_kanban(verb, [str(a) for a in args]))

    def log_message(self, fmt: str, *args) -> None:  # keep credentials out of logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    server.serve_forever()
