"""Loopback-only Hermes vault broker backed by private Infisical CE."""

from __future__ import annotations

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import yaml


MAX_BODY_BYTES = 65536
MAX_RESPONSE_BYTES = 512 * 1024
SAFE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
SAFE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
METADATA_FIELDS = {
    "id", "_id", "environment", "version", "type", "secretKey",
    "secretPath", "createdAt", "updatedAt", "secretValueHidden",
}


class BrokerError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        raise BrokerError("upstream_redirect", 502)


def load_settings(config_path: Path | None = None) -> dict:
    home = Path(os.environ.get("HERMES_HOME", "/home/hermes/.hermes"))
    path = config_path or Path(os.environ.get("HERMES_CONFIG_FILE", str(home / "config.yaml")))
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    settings = (
        data.get("plugins", {})
        .get("entries", {})
        .get("connections-agent", {})
        .get("settings", {})
    )
    required = {
        "frank_url": "http://127.0.0.1:18080",
        "infisical_url": "http://127.0.0.1:18082",
        "infisical_environment": "production",
        "secret_path": "/hermes",
    }
    if settings.get("enabled") is not True:
        raise BrokerError("connections_agent_disabled", 503)
    for key, expected in required.items():
        if str(settings.get(key, "")).rstrip("/") != expected:
            raise BrokerError(f"invalid_{key}", 503)
    project_id = str(settings.get("infisical_project_id", "")).strip()
    if not project_id:
        raise BrokerError("missing_infisical_project_id", 503)
    return {
        "infisical_url": required["infisical_url"],
        "project_id": project_id,
        "environment": required["infisical_environment"],
        "secret_path": required["secret_path"],
    }


class InfisicalClient:
    def __init__(self, settings: dict | None = None, opener=None):
        self.settings = settings or load_settings()
        self.client_id = os.environ.get("HERMES_CONNECTIONS_INFISICAL_CLIENT_ID", "").strip()
        self.client_secret = os.environ.get("HERMES_CONNECTIONS_INFISICAL_CLIENT_SECRET", "").strip()
        if not self.client_id or not self.client_secret:
            raise BrokerError("infisical_identity_missing", 503)
        self.opener = opener or urllib.request.build_opener(_NoRedirect()).open
        self._lock = threading.RLock()
        self._token = ""
        self._token_expires_at = 0.0

    def _raw_request(self, method: str, path: str, body: dict | None = None, token: str = "") -> dict:
        raw_body = json.dumps(body, separators=(",", ":")).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            self.settings["infisical_url"] + path,
            data=raw_body,
            headers=headers,
            method=method,
        )
        try:
            with self.opener(request, timeout=10) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            if error.code in {401, 403}:
                raise BrokerError("infisical_permission_denied", error.code) from None
            if error.code == 404:
                raise BrokerError("secret_not_found", 404) from None
            raise BrokerError("infisical_error", 502) from None
        except (OSError, TimeoutError, urllib.error.URLError):
            raise BrokerError("infisical_unavailable", 503) from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise BrokerError("infisical_response_too_large", 502)
        try:
            decoded = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BrokerError("infisical_invalid_response", 502) from None
        if not isinstance(decoded, dict):
            raise BrokerError("infisical_invalid_response", 502)
        return decoded

    def _access_token(self, force: bool = False) -> str:
        with self._lock:
            if not force and self._token and time.monotonic() < self._token_expires_at:
                return self._token
            response = self._raw_request(
                "POST",
                "/api/v1/auth/universal-auth/login",
                {"clientId": self.client_id, "clientSecret": self.client_secret},
            )
            token = str(response.get("accessToken", ""))
            if not token:
                raise BrokerError("infisical_login_failed", 503)
            try:
                expires_in = int(response.get("expiresIn", 3600))
            except (TypeError, ValueError):
                expires_in = 3600
            self._token = token
            self._token_expires_at = time.monotonic() + max(1, expires_in - 30)
            return token

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        token = self._access_token()
        try:
            return self._raw_request(method, path, body, token)
        except BrokerError as error:
            if error.status != 401:
                raise
        return self._raw_request(method, path, body, self._access_token(force=True))

    def _location(self, payload: dict) -> tuple[str, str, str, str]:
        project_id = str(payload.get("project_id", ""))
        environment = str(payload.get("environment", ""))
        secret_path = str(payload.get("secret_path", ""))
        secret_name = str(payload.get("secret_name", ""))
        if (
            not hmac.compare_digest(project_id, self.settings["project_id"])
            or environment != self.settings["environment"]
            or secret_path != self.settings["secret_path"]
            or not SAFE_NAME.fullmatch(secret_name)
        ):
            raise BrokerError("scope_denied", 403)
        return project_id, environment, secret_path, secret_name

    @staticmethod
    def _metadata(secret: dict) -> dict:
        return {key: secret[key] for key in METADATA_FIELDS if key in secret and key != "secretValue"}

    def health(self) -> dict:
        self.list_metadata({
            "project_id": self.settings["project_id"],
            "environment": self.settings["environment"],
            "secret_path": self.settings["secret_path"],
        })
        return {"ok": True, "status": "verified", "provider": "infisical-ce"}

    def list_metadata(self, payload: dict) -> dict:
        project_id, environment, secret_path, _ = self._location({**payload, "secret_name": "metadata"})
        query = urllib.parse.urlencode({
            "projectId": project_id,
            "environment": environment,
            "secretPath": secret_path,
            "viewSecretValue": "false",
            "expandSecretReferences": "false",
        })
        response = self.request("GET", "/api/v4/secrets?" + query)
        items = response.get("secrets", [])
        if not isinstance(items, list):
            raise BrokerError("infisical_invalid_response", 502)
        return {"secrets": [self._metadata(item) for item in items if isinstance(item, dict)]}

    def create(self, payload: dict) -> dict:
        project_id, environment, secret_path, secret_name = self._location(payload)
        value = payload.get("secret_value")
        if not isinstance(value, str) or not value or len(value.encode("utf-8")) > MAX_BODY_BYTES:
            raise BrokerError("secret_value_invalid", 400)
        response = self.request("POST", "/api/v4/secrets/" + urllib.parse.quote(secret_name, safe=""), {
            "projectId": project_id,
            "environment": environment,
            "secretPath": secret_path,
            "secretValue": value,
            "type": "shared",
        })
        secret = response.get("secret", {})
        return {"secret": self._metadata(secret if isinstance(secret, dict) else {})}

    def rotate(self, payload: dict) -> dict:
        project_id, environment, secret_path, secret_name = self._location(payload)
        value = payload.get("secret_value")
        if not isinstance(value, str) or not value or len(value.encode("utf-8")) > MAX_BODY_BYTES:
            raise BrokerError("secret_value_invalid", 400)
        response = self.request("PATCH", "/api/v4/secrets/" + urllib.parse.quote(secret_name, safe=""), {
            "projectId": project_id,
            "environment": environment,
            "secretPath": secret_path,
            "secretValue": value,
            "type": "shared",
        })
        secret = response.get("secret", {})
        return {"secret": self._metadata(secret if isinstance(secret, dict) else {})}

    def delete(self, payload: dict) -> dict:
        project_id, environment, secret_path, secret_name = self._location(payload)
        token = payload.get("confirmation_token")
        receipt = payload.get("provider_receipt")
        if not isinstance(token, str) or len(token) < 16 or not isinstance(receipt, dict) or not receipt.get("receipt_id"):
            raise BrokerError("delete_confirmation_invalid", 403)
        response = self.request("DELETE", "/api/v4/secrets/" + urllib.parse.quote(secret_name, safe=""), {
            "projectId": project_id,
            "environment": environment,
            "secretPath": secret_path,
            "type": "shared",
        })
        secret = response.get("secret", {})
        return {"secret": self._metadata(secret if isinstance(secret, dict) else {})}


class Handler(BaseHTTPRequestHandler):
    server_version = "HermesFrankVault/1"
    client: InfisicalClient
    broker_key: str

    def log_message(self, format, *args):
        # Never log request bodies, query strings, credentials, or provider responses.
        print(f"vault-broker {self.command} {self.path.split('?', 1)[0]} {args[1] if len(args) > 1 else ''}")

    def _authorized(self) -> bool:
        expected = f"Bearer {self.broker_key}"
        return (
            hmac.compare_digest(self.headers.get("Authorization", ""), expected)
            and self.headers.get("X-Hermes-Profile", "") == "default"
        )

    def _json(self, status: int, payload: dict):
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise BrokerError("request_invalid", 400) from None
        if length < 0 or length > MAX_BODY_BYTES:
            raise BrokerError("request_too_large", 413)
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise BrokerError("request_invalid", 400) from None
        if not isinstance(payload, dict):
            raise BrokerError("request_invalid", 400)
        return payload

    def _dispatch(self):
        if not self._authorized():
            raise BrokerError("permission_denied", 401)
        path = self.path.split("?", 1)[0]
        if self.command == "GET" and path == "/secrets/health":
            return self.client.health()
        if self.command != "POST":
            raise BrokerError("not_found", 404)
        payload = self._body()
        if path == "/secrets/list-metadata":
            return self.client.list_metadata(payload)
        if path == "/secrets/create":
            return self.client.create(payload)
        if path == "/secrets/rotate":
            return self.client.rotate(payload)
        if path == "/secrets/delete":
            return self.client.delete(payload)
        raise BrokerError("not_found", 404)

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def do_DELETE(self):
        self._handle()

    def _handle(self):
        try:
            self._json(200, self._dispatch())
        except BrokerError as error:
            self._json(error.status, {"ok": False, "error": error.code})
        except Exception:
            self._json(500, {"ok": False, "error": "broker_error"})


def main():
    broker_key = os.environ.get("HERMES_VAULT_BROKER_KEY", "").strip()
    if not SAFE_KEY.fullmatch(broker_key):
        raise SystemExit("HERMES_VAULT_BROKER_KEY is missing or invalid")
    Handler.client = InfisicalClient()
    Handler.broker_key = broker_key
    bind_host = os.environ.get("HERMES_VAULT_BROKER_BIND", "172.16.1.1").strip()
    if bind_host != "172.16.1.1":
        raise SystemExit("HERMES_VAULT_BROKER_BIND must remain on Frank's private Docker gateway")
    server = ThreadingHTTPServer((bind_host, 18083), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
