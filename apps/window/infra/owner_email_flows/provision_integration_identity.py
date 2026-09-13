#!/usr/bin/env python3
"""Create the narrowly-permitted native Mautic API identity, idempotently."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
try:
    import pwd
except ImportError:  # Allows static policy tests on non-POSIX developer hosts.
    pwd = None
import secrets
import stat
import sys

from mautic_flows import ApiError, Mautic

ADMIN_SECRET = Path("/srv/frank/secrets/owner-marketing/owner-marketing.env")
RUNTIME_SECRET = Path("/srv/hermes/secrets/owner-email-flows.env")
ROLE = "Owner email consent bridge"
USERNAME = "owner-email-bridge"
PERMISSIONS = {
    "lead:leads": ["viewother", "create", "editother"],
    "lead:fields": ["viewother"],
    # Mautic authorizes static-segment membership through the segment edit
    # capability. It is the narrowest native permission for its add-contact API.
    "lead:lists": ["viewother", "editother"],
    "campaign:campaigns": ["viewother"],
    "email:emails": ["viewother"],
}


def env_file(path: Path, *, owner: int | None = None) -> dict[str, str]:
    info = path.lstat()
    if path.is_symlink() or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError("secret file permissions are unsafe")
    if owner is not None and info.st_uid != owner:
        raise RuntimeError("secret file owner is unsafe")
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key or key in values or "\n" in value:
            raise RuntimeError("secret file syntax is unsafe")
        values[key] = value
    return values


def exact(api: Mautic, path: str, key: str, name: str) -> dict | None:
    rows = api.request("GET", path).get(key, {})
    values = list(rows.values()) if isinstance(rows, dict) else list(rows) if isinstance(rows, list) else []
    if not all(isinstance(row, dict) for row in values):
        raise RuntimeError("native identity listing was malformed")
    matched = [row for row in values if row.get("name") == name or row.get("username") == name]
    if len(matched) > 1:
        raise RuntimeError("native identity is ambiguous")
    return matched[0] if matched else None


def write_runtime_secret(username: str, password: str) -> None:
    if pwd is None:
        raise RuntimeError("Hermes credential provisioning requires POSIX")
    account = pwd.getpwnam("hermes")
    RUNTIME_SECRET.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    data = f"OWNER_EMAIL_FLOWS_MAUTIC_USERNAME={username}\nOWNER_EMAIL_FLOWS_MAUTIC_PASSWORD={password}\n".encode()
    temp = RUNTIME_SECRET.with_suffix(".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.chown(temp, account.pw_uid, account.pw_gid)
    os.replace(temp, RUNTIME_SECRET)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("must run as root")
    if pwd is None:
        raise SystemExit("must run on the VPS")
    admin = env_file(ADMIN_SECRET, owner=0)
    password = admin.get("MAUTIC_ADMIN_PASSWORD", "")
    if not password:
        raise SystemExit("Mautic bootstrap credential is unavailable")
    api = Mautic("http://127.0.0.1:18106", "owner", password)
    role = exact(api, "roles?limit=100", "roles", ROLE)
    if role is None:
        if not args.apply:
            print('{"status":"would_create_role"}')
            return 0
        role = api.request("POST", "roles/new", {"name": ROLE, "description": "Native API role for consent bridge only.", "isAdmin": False, "rawPermissions": PERMISSIONS}).get("role", {})
    if role.get("isAdmin"):
        raise SystemExit("native role unexpectedly has administrator access")
    if role.get("rawPermissions") != PERMISSIONS:
        if not args.apply:
            raise SystemExit("native role permissions drifted")
        role = api.request(
            "PATCH",
            f"roles/{int(role["id"])}/edit",
            {"name": ROLE, "description": "Native API role for consent bridge only.", "isAdmin": False, "rawPermissions": PERMISSIONS},
        ).get("role", {})
    if role.get("isAdmin") or role.get("rawPermissions") != PERMISSIONS:
        raise SystemExit("native role permissions drifted")
    existing_secret = env_file(RUNTIME_SECRET, owner=pwd.getpwnam("hermes").pw_uid) if RUNTIME_SECRET.exists() else {}
    user = exact(api, "users?limit=100", "users", USERNAME)
    if user is None:
        if not args.apply:
            print('{"status":"would_create_user"}')
            return 0
        generated = "A!" + secrets.token_urlsafe(36)
        user = api.request("POST", "users/new", {"username": USERNAME, "firstName": "Owner", "lastName": "Email Bridge", "email": "owner-email-bridge@localhost.invalid", "plainPassword": {"password": generated, "confirm": generated}, "role": int(role["id"])}).get("user", {})
        write_runtime_secret(USERNAME, generated)
    elif existing_secret.get("OWNER_EMAIL_FLOWS_MAUTIC_USERNAME") != USERNAME or not existing_secret.get("OWNER_EMAIL_FLOWS_MAUTIC_PASSWORD"):
        raise SystemExit("native user exists but Hermes credential cannot be safely reconciled")
    if int(user.get("role", {}).get("id", user.get("role", 0))) != int(role["id"]):
        raise SystemExit("native user role drifted")
    print('{"status":"provisioned","role":"owner_email_consent_bridge","user":"owner-email-bridge"}')
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ApiError, OSError, RuntimeError):
        print('{"status":"failed","error":"native_identity_unavailable"}', file=sys.stderr)
        raise SystemExit(2)
