#!/usr/bin/env python3
"""Provision the least-privilege owner-mail receiver identities and secrets."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import stat
import sys
from typing import Any, Mapping
import urllib.error
import urllib.parse
import urllib.request

EMAIL_FLOWS = Path(__file__).resolve().parents[1] / "owner_email_flows"
if str(EMAIL_FLOWS) not in sys.path:
    sys.path.insert(0, str(EMAIL_FLOWS))
from mautic_flows import ApiError, Mautic

ADMIN_SECRET = Path("/srv/frank/secrets/owner-marketing/owner-marketing.env")
RUNTIME_SECRET = Path("/srv/hermes/secrets/owner-mail-events.env")
MAUTIC_URL = "http://127.0.0.1:18106"
ROLE = "Owner mail events receiver"
USERNAME = "owner-mail-events-receiver"
WEBHOOK_ENDPOINT = "https://frank.fail/api/owner-mail-events/resend"
WEBHOOK_EVENTS = frozenset({"email.bounced", "email.complained"})
RESEND_API = "https://api.resend.com"
USER_AGENT = "resend-node:6.18.1"
MAX_RESPONSE_BYTES = 1024 * 1024
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SAFE_KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")
SAFE_VALUE = re.compile(r"^[A-Za-z0-9_!+./:=@%-]+$")
PERMISSIONS = {
    "lead:leads": ["viewown", "viewother", "editown", "editother"],
    "lead:lists": ["viewother", "editother"],
    "email:emails": ["viewother"],
}


class ProvisionError(RuntimeError):
    pass


class Resend:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        headers = {
            "Authorization": "Bearer " + self.api_key,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(RESEND_API + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            raise ProvisionError(f"Resend API {method} {path} returned HTTP {error.code}") from error
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            raise ProvisionError("Resend API is unavailable") from error
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ProvisionError("Resend API response exceeded its safe bound")
        try:
            value = json.loads(raw.decode() or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ProvisionError("Resend API response was malformed") from error
        if not isinstance(value, dict):
            raise ProvisionError("Resend API response was malformed")
        return value


def read_env(path: Path, *, allow_missing: bool = False) -> dict[str, str]:
    if not path.exists() and allow_missing:
        return {}
    try:
        info = path.lstat()
    except OSError as error:
        raise ProvisionError("required secret file is unavailable") from error
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ProvisionError("secret file must be root-owned regular 0600")
    result: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise ProvisionError("secret file is unreadable") from error
    for raw in lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, encoded = stripped.partition("=")
        if not separator or not SAFE_KEY.fullmatch(key) or key in result:
            raise ProvisionError("secret file syntax is invalid")
        try:
            values = shlex.split(encoded, posix=True)
        except ValueError as error:
            raise ProvisionError("secret file syntax is invalid") from error
        if len(values) > 1 or (not values and encoded):
            raise ProvisionError("secret file value is invalid")
        value = values[0] if values else ""
        if "\x00" in value or "\n" in value or "\r" in value:
            raise ProvisionError("secret file value is invalid")
        result[key] = value
    return result


def resend_key_from_dsn(value: str) -> str:
    try:
        fields = shlex.split(value, posix=True)
    except ValueError as error:
        raise ProvisionError("native mailer DSN is malformed") from error
    if len(fields) != 1:
        raise ProvisionError("native mailer DSN is malformed")
    parsed = urllib.parse.urlsplit(fields[0])
    api_key = urllib.parse.unquote(parsed.password or "")
    if parsed.scheme not in {"smtp", "smtps", "resend+smtp"} or parsed.username != "resend" or parsed.hostname != "smtp.resend.com" or not api_key.startswith("re_"):
        raise ProvisionError("native mailer DSN is not the fixed Resend transport")
    return api_key


def decimal_id(value: Any, label: str) -> str:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return str(value)
    if isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,14}", value):
        return value
    raise ProvisionError(f"native {label} ID was malformed")


def exact(items: Any, *, name: str, field: str, label: str) -> dict[str, Any] | None:
    values = list(items.values()) if isinstance(items, dict) else items if isinstance(items, list) else None
    if not isinstance(values, list) or len(values) > 100 or not all(isinstance(item, dict) for item in values):
        raise ProvisionError(f"native {label} listing was malformed")
    matched = [item for item in values if item.get(field) == name]
    if len(matched) > 1:
        raise ProvisionError(f"native {label} identity is ambiguous")
    return matched[0] if matched else None


def _permissions(value: Any) -> dict[str, list[str]] | None:
    if not isinstance(value, Mapping):
        return None
    result = {}
    for key, permissions in value.items():
        if not isinstance(key, str) or not isinstance(permissions, list) or not all(isinstance(item, str) for item in permissions):
            return None
        result[key] = sorted(permissions)
    return result


def ensure_mautic(api: Mautic, runtime: Mapping[str, str], apply: bool) -> tuple[str, str, list[str]]:
    plan: list[str] = []
    expected_permissions = {key: sorted(value) for key, value in PERMISSIONS.items()}
    role = exact(api.request("GET", "roles?limit=100").get("roles"), name=ROLE, field="name", label="role")
    if role is None:
        plan.append("create_mautic_role")
        if apply:
            role = api.request("POST", "roles/new", {"name": ROLE, "description": "Least-privilege native API role for owner mail event suppression and reply exits.", "isAdmin": False, "rawPermissions": PERMISSIONS}).get("role")
    elif role.get("isAdmin") or _permissions(role.get("rawPermissions")) != expected_permissions:
        plan.append("update_mautic_role")
        if apply:
            role_id = decimal_id(role.get("id"), "role")
            role = api.request("PATCH", f"roles/{role_id}/edit", {"name": ROLE, "description": "Least-privilege native API role for owner mail event suppression and reply exits.", "isAdmin": False, "rawPermissions": PERMISSIONS}).get("role")
    if role is None:
        user = exact(api.request("GET", "users?limit=100").get("users"), name=USERNAME, field="username", label="user")
        if user is not None:
            raise ProvisionError("native receiver user exists without its managed role")
        plan.append("create_mautic_user")
        return USERNAME, "", plan
    if not isinstance(role, dict) or role.get("isAdmin") or _permissions(role.get("rawPermissions")) != expected_permissions:
        raise ProvisionError("native Mautic role permissions drifted")
    role_id = decimal_id(role.get("id"), "role")

    user = exact(api.request("GET", "users?limit=100").get("users"), name=USERNAME, field="username", label="user")
    existing_username = runtime.get("OWNER_MAIL_EVENTS_MAUTIC_USERNAME", "")
    existing_password = runtime.get("OWNER_MAIL_EVENTS_MAUTIC_PASSWORD", "")
    if user is None:
        plan.append("create_mautic_user")
        if not apply:
            return USERNAME, "", plan
        password = "A!" + secrets.token_urlsafe(36)
        user = api.request("POST", "users/new", {"username": USERNAME, "firstName": "Owner", "lastName": "Mail Events", "email": "owner-mail-events@localhost.invalid", "plainPassword": {"password": password, "confirm": password}, "role": role_id}).get("user")
    else:
        if existing_username != USERNAME or not existing_password:
            raise ProvisionError("native receiver user exists but its credential is unavailable")
        password = existing_password
    if not isinstance(user, dict):
        raise ProvisionError("native Mautic user response was malformed")
    user_role = user.get("role")
    if isinstance(user_role, dict):
        user_role = user_role.get("id")
    if decimal_id(user_role, "user role") != role_id:
        raise ProvisionError("native receiver user role drifted")
    return USERNAME, password, plan


def list_webhooks(api: Resend) -> list[dict[str, Any]]:
    response = api.request("GET", "/webhooks?limit=100")
    values = response.get("data")
    if response.get("object") != "list" or response.get("has_more") is not False or not isinstance(values, list) or len(values) > 100 or not all(isinstance(item, dict) for item in values):
        raise ProvisionError("Resend webhook listing was malformed or exceeded its safe bound")
    for item in values:
        if not isinstance(item.get("id"), str) or not UUID.fullmatch(item["id"]):
            raise ProvisionError("Resend webhook ID was malformed")
    return values


def _webhook_secret(value: Any) -> str:
    if not isinstance(value, str) or not value.startswith("whsec_") or len(value) < 20:
        raise ProvisionError("Resend webhook signing secret was unavailable")
    return value


def ensure_resend(api: Resend, runtime: Mapping[str, str], apply: bool) -> tuple[str, list[str]]:
    plan: list[str] = []
    matches = [item for item in list_webhooks(api) if item.get("endpoint") == WEBHOOK_ENDPOINT]
    if len(matches) > 1:
        raise ProvisionError("Resend webhook endpoint is ambiguous")
    if not matches:
        plan.append("create_resend_webhook")
        if not apply:
            return "", plan
        webhook = api.request("POST", "/webhooks", {"endpoint": WEBHOOK_ENDPOINT, "events": sorted(WEBHOOK_EVENTS)})
        ident = webhook.get("id")
        if webhook.get("object") != "webhook" or not isinstance(ident, str) or not UUID.fullmatch(ident):
            raise ProvisionError("Resend webhook create response was malformed")
    else:
        ident = matches[0]["id"]
        webhook = api.request("GET", "/webhooks/" + ident)
        if webhook.get("id") != ident or webhook.get("endpoint") != WEBHOOK_ENDPOINT:
            raise ProvisionError("Resend webhook identity drifted")
        events = webhook.get("events")
        if not isinstance(events, list) or not all(isinstance(item, str) for item in events):
            raise ProvisionError("Resend webhook events were malformed")
        if set(events) != WEBHOOK_EVENTS or webhook.get("status") != "enabled":
            plan.append("update_resend_webhook")
            if apply:
                api.request("PATCH", "/webhooks/" + ident, {"endpoint": WEBHOOK_ENDPOINT, "events": sorted(WEBHOOK_EVENTS), "status": "enabled"})
                webhook = api.request("GET", "/webhooks/" + ident)
                if webhook.get("id") != ident or webhook.get("endpoint") != WEBHOOK_ENDPOINT or set(webhook.get("events") or []) != WEBHOOK_EVENTS or webhook.get("status") != "enabled":
                    raise ProvisionError("Resend webhook update did not converge")
    secret = _webhook_secret(webhook.get("signing_secret"))
    existing = runtime.get("RESEND_WEBHOOK_SECRET", "")
    if existing and existing != secret:
        raise ProvisionError("stored Resend webhook signing secret does not match native endpoint")
    return secret, plan


def write_env(path: Path, values: Mapping[str, str]) -> None:
    if any(not SAFE_KEY.fullmatch(key) or not value or not SAFE_VALUE.fullmatch(value) for key, value in values.items()):
        raise ProvisionError("refusing to write unsafe runtime secret value")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(temp, flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            for key in sorted(values):
                stream.write(f"{key}={values[key]}\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temp, 0, 0)
        os.replace(temp, path)
    except Exception:
        try:
            temp.unlink()
        except OSError:
            pass
        raise


def provision(*, apply: bool, admin_path: Path = ADMIN_SECRET, runtime_path: Path = RUNTIME_SECRET, mautic: Mautic | None = None, resend: Resend | None = None) -> dict[str, Any]:
    if os.geteuid() != 0:
        raise ProvisionError("provisioning must run as root")
    admin = read_env(admin_path)
    runtime = read_env(runtime_path, allow_missing=True)
    admin_password = admin.get("MAUTIC_ADMIN_PASSWORD", "")
    dsn = admin.get("MAUTIC_MAILER_DSN", "")
    if not admin_password or not dsn:
        raise ProvisionError("native owner marketing credential is unavailable")
    resend_key = resend_key_from_dsn(dsn)
    existing_key = runtime.get("OWNER_MAIL_EVENTS_RESEND_API_KEY", "")
    if existing_key and existing_key != resend_key:
        raise ProvisionError("stored Resend API key does not match native mail transport")
    mautic_api = mautic or Mautic(MAUTIC_URL, "owner", admin_password)
    username, password, plan = ensure_mautic(mautic_api, runtime, apply)
    resend_secret, resend_plan = ensure_resend(resend or Resend(resend_key), runtime, apply)
    plan.extend(resend_plan)
    reply_secret = runtime.get("OWNER_MAIL_REPLY_SECRET", "")
    if reply_secret and len(reply_secret) < 32:
        raise ProvisionError("stored owner reply secret is too short")
    if not reply_secret:
        plan.append("create_reply_secret")
        if apply:
            reply_secret = secrets.token_urlsafe(48)
    if apply:
        if not password or not resend_secret or not reply_secret:
            raise ProvisionError("runtime credential provisioning was incomplete")
        merged = dict(runtime)
        merged.update({
            "OWNER_MAIL_EVENTS_MAUTIC_USERNAME": username,
            "OWNER_MAIL_EVENTS_MAUTIC_PASSWORD": password,
            "OWNER_MAIL_EVENTS_RESEND_API_KEY": resend_key,
            "OWNER_MAIL_REPLY_SECRET": reply_secret,
            "RESEND_WEBHOOK_SECRET": resend_secret,
        })
        write_env(runtime_path, merged)
    return {"status": "applied" if apply else "dry_run", "actions": plan or ["unchanged"], "role": "owner_mail_events_receiver", "webhook": "exact"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        result = provision(apply=args.apply)
    except (ApiError, OSError, ProvisionError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}, separators=(",", ":")), file=sys.stderr)
        return 2
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
