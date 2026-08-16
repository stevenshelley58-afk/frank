#!/usr/bin/env python3
"""Atomically merge the Connections Agent settings into Hermes config.yaml.

Only the plugin's namespaced settings subtree is managed here. The input file
must already exist and contain valid YAML; malformed or structurally unsafe
configuration is never replaced.
"""

from __future__ import annotations

import argparse
import os
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any


PLUGIN_SETTINGS = {
    "enabled",
    "frank_url",
    "infisical_url",
    "infisical_project_id",
    "infisical_environment",
    "secret_path",
    "resend_secret_name",
}


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"merge-hermes-config: {message}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--enabled", required=True, choices=("true", "false"))
    parser.add_argument("--frank-url", required=True)
    parser.add_argument("--infisical-url", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--secret-path", required=True)
    parser.add_argument("--resend-secret-name", required=True)
    return parser.parse_args()


def load_yaml():
    try:
        from ruamel.yaml import YAML
    except ImportError as exc:  # pragma: no cover - exercised on deployment hosts
        fail(f"ruamel.yaml is required by Hermes ({exc})")

    yaml = YAML(typ="rt")
    yaml.preserve_quotes = True
    yaml.default_flow_style = False
    return yaml


def ensure_mapping(value: Any, label: str) -> Any:
    if not isinstance(value, dict):
        fail(f"{label} must be a YAML mapping; refusing to clobber it")
    return value


def atomic_write(
    yaml: Any,
    config_path: Path,
    document: Any,
    mode: int,
    owner_uid: int,
    owner_gid: int,
) -> None:
    directory = config_path.parent
    fd, temp_name = tempfile.mkstemp(prefix=f".{config_path.name}.", dir=directory)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            yaml.dump(document, stream)
            stream.flush()
            os.fsync(stream.fileno())
        # chmod by path works for both the Linux VPS and local Windows checks;
        # the target's existing mode is retained before the atomic replacement.
        os.chmod(temp_path, stat.S_IMODE(mode))
        # Bootstrap normally runs as root while Hermes owns config.yaml. Keep
        # that ownership across the atomic replacement; an unprivileged owner
        # already creates the temporary file with the correct identity.
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            os.chown(temp_path, owner_uid, owner_gid)
        os.replace(temp_path, config_path)
        try:
            directory_fd = os.open(directory, os.O_RDONLY)
        except OSError:
            directory_fd = None
        if directory_fd is not None:
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def main() -> int:
    args = parse_args()
    config_path = args.config
    if not config_path.exists():
        fail(f"missing Hermes config: {config_path}")
    if config_path.is_symlink() or not config_path.is_file():
        fail(f"Hermes config is not a regular non-symlink file: {config_path}")

    yaml = load_yaml()
    try:
        with config_path.open("r", encoding="utf-8") as stream:
            document = yaml.load(stream)
    except Exception as exc:
        fail(f"could not parse Hermes config; refusing to replace it: {exc}")

    if document is None:
        # An empty config is valid and can safely receive the namespaced map.
        document = {}
    ensure_mapping(document, "config root")

    plugins = document.setdefault("plugins", {})
    ensure_mapping(plugins, "plugins")
    entries = plugins.setdefault("entries", {})
    ensure_mapping(entries, "plugins.entries")
    plugin = entries.setdefault("connections-agent", {})
    ensure_mapping(plugin, "plugins.entries.connections-agent")
    settings = plugin.setdefault("settings", {})
    ensure_mapping(settings, "plugins.entries.connections-agent.settings")

    values = {
        "enabled": args.enabled == "true",
        "frank_url": args.frank_url,
        "infisical_url": args.infisical_url,
        "infisical_project_id": args.project_id,
        "infisical_environment": args.environment,
        "secret_path": args.secret_path,
        "resend_secret_name": args.resend_secret_name,
    }
    changed = any(settings.get(key) != value for key, value in values.items())
    if changed:
        for key, value in values.items():
            settings[key] = value
        existing = config_path.stat()
        atomic_write(
            yaml,
            config_path,
            document,
            existing.st_mode,
            existing.st_uid,
            existing.st_gid,
        )
        print(f"updated Hermes Connections Agent settings in {config_path}")
    else:
        print(f"Hermes Connections Agent settings already match {config_path}")
    return 0


if __name__ == "__main__":
    main()
