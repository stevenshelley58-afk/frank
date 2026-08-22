#!/usr/bin/env python3
"""Install Frank's Hindsight contract into the single Hermes home."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile


BANK_TEMPLATE = "steven-{workspace}"


def _atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, mode)
        os.replace(temporary_path, path)
        os.chmod(path, mode)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        temporary_path.unlink(missing_ok=True)
        raise


def _parse_env(content: str) -> tuple[list[str], dict[str, str]]:
    lines = content.splitlines()
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return lines, values


def configure(template_path: Path, hermes_home: Path) -> tuple[Path, Path]:
    if not hermes_home.is_dir() or hermes_home.is_symlink():
        raise RuntimeError("Hermes home must be an existing non-symlink directory")
    config = json.loads(template_path.read_text(encoding="utf-8"))
    if config.get("mode") != "local_embedded":
        raise RuntimeError("only the native local embedded provider is allowed")
    if config.get("bank_id_template") != BANK_TEMPLATE:
        raise RuntimeError("memory banks must be derived from the bound workspace")
    if "agent_workspace" in json.dumps(config):
        raise RuntimeError("agent_workspace is runtime session context, not static config")
    forbidden_secret_fields = {"apiKey", "api_key", "llmApiKey", "llm_api_key"}
    if forbidden_secret_fields.intersection(config):
        raise RuntimeError("the tracked Hindsight config must not contain secrets")

    env_path = hermes_home / ".env"
    if not env_path.is_file() or env_path.is_symlink():
        raise RuntimeError("Hermes secret environment is unavailable")
    lines, values = _parse_env(env_path.read_text(encoding="utf-8-sig"))
    llm_key = values.get("DEEPSEEK_API_KEY", "")
    if not llm_key:
        raise RuntimeError("DEEPSEEK_API_KEY is required for embedded memory extraction")

    retained = [
        line for line in lines
        if not ("=" in line and line.split("=", 1)[0].strip() == "HINDSIGHT_LLM_API_KEY")
    ]
    retained.append(f"HINDSIGHT_LLM_API_KEY={llm_key}")
    _atomic_write(env_path, "\n".join(retained).rstrip("\n") + "\n")

    config_path = hermes_home / "hindsight" / "config.json"
    _atomic_write(config_path, json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    return config_path, env_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--hermes-home", type=Path, required=True)
    args = parser.parse_args()
    config_path, _ = configure(args.template.resolve(), args.hermes_home.resolve())
    print(f"configured {config_path}")


if __name__ == "__main__":
    main()
