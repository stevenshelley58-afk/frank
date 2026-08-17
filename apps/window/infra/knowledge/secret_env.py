#!/usr/bin/env python3
"""Strict parser for the small, root-managed knowledge environment files."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
try:
    import pwd
except ImportError:  # pragma: no cover - Windows has no passwd database
    pwd = None
import re
import stat
import sys

KEY = re.compile(r"^[A-Z][A-Z0-9_]{1,127}$")
KNOWLEDGE_KEYS = frozenset({
    "HERMES_GRAPHITI_PROVIDER_TOKEN", "FRANK_KNOWLEDGE_PROJECTION_TOKEN",
    "NEO4J_PASSWORD", "HERMES_ALLOWED_NAMESPACES",
    "FRANK_KNOWLEDGE_ALLOWED_PROJECTS", "OPENAI_API_KEY", "NEO4J_IMAGE",
})
FRANK_KEYS = frozenset({
    "HERMES_API_KEY", "FRANK_BASIC_AUTH_USER", "FRANK_BASIC_AUTH_HASH",
    "HERMES_CONNECTIONS_AGENT_KEY", "HERMES_VAULT_BROKER_KEY",
    "HERMES_VAULT_BROKER_URL", "FRANK_KNOWLEDGE_PROJECTION_TOKEN",
    "FRANK_KNOWLEDGE_PROJECTION_URL", "FRANK_KNOWLEDGE_ALLOWED_PROJECTS",
})
RUNTIME_KEYS = frozenset({
    "HERMES_GRAPHITI_PROVIDER_URL", "HERMES_GRAPHITI_PROVIDER_TOKEN",
    "HERMES_GRAPHITI_NAMESPACE", "HERMES_GRAPHITI_ALLOWED_HOSTS",
})


def parse(path: str | Path, profile: str, *, allow_missing: bool = False) -> dict[str, str]:
    target = Path(path)
    try:
        info = target.lstat()
    except FileNotFoundError:
        if allow_missing:
            return {}
        raise ValueError("secret file is unavailable")
    except OSError as exc:
        raise ValueError("secret file is unavailable") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ValueError("secret file must be a regular non-symlink file")
    if os.name != "nt":
        owners = {0}
        if profile == "runtime":
            if pwd is not None:
                try:
                    owners.add(pwd.getpwnam("hermes").pw_uid)
                except KeyError:
                    pass
        if info.st_uid not in owners:
            raise ValueError("secret file owner is not allowlisted")
    if os.name != "nt" and stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError("secret file must be mode 0600")
    try:
        raw = target.read_bytes()
        text = raw.decode("utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError("secret file is not valid UTF-8") from exc
    if len(raw) > 64 * 1024 or "\x00" in text or "\r" in text or any(ord(char) < 32 and char != "\n" for char in text):
        raise ValueError("secret file contains invalid control data")
    allowed = (
        KNOWLEDGE_KEYS if profile == "knowledge" else
        FRANK_KEYS if profile == "frank" else
        RUNTIME_KEYS if profile == "runtime" else frozenset()
    )
    values: dict[str, str] = {}
    for line_number, line in enumerate(text.split("\n"), 1):
        if not line:
            continue
        if "=" not in line:
            raise ValueError(f"secret file line {line_number} is malformed")
        key, value = line.split("=", 1)
        if key not in allowed or KEY.fullmatch(key) is None:
            raise ValueError(f"secret file key {key!r} is not allowlisted")
        if key in values:
            raise ValueError(f"secret file key {key!r} is duplicated")
        if not value or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError(f"secret file value for {key!r} is invalid")
        values[key] = value
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("profile", choices=("knowledge", "frank", "runtime"))
    parser.add_argument("--allow-missing", action="store_true")
    args = parser.parse_args()
    try:
        values = parse(args.path, args.profile, allow_missing=args.allow_missing)
    except ValueError as exc:
        print(f"secret validation failed: {exc}", file=sys.stderr)
        return 1
    print(f"valid {args.profile} environment ({len(values)} keys)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
