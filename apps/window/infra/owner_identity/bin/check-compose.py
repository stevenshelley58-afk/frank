#!/usr/bin/env python3
"""Reject a Compose configuration that is not the accepted owner identity stack.

`docker compose config -q` only proves the file parses. This check proves the
resolved configuration still matches the decisions recorded in pins.env: the
pinned digests, no published host ports, an internal-only data network, the
runtime paths outside Git, and no Docker socket handed to a container.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ACCEPTED_IMAGES = {
    "ghcr.io/goauthentik/server:2026.8.2@sha256:ff8489a5af4f4fe415ffd180a8e3c10b120bc2592d13d79dac050d977f7b9ecd",
    "postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685",
}
REQUIRED_BIND_PREFIX = "/srv/frank/owner-identity/"
INTERNAL_ONLY = {"postgresql"}


def fail(message: str) -> None:
    print(f"check-compose: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    secret = Path("/srv/frank/secrets/owner-identity.env")
    if not secret.is_file():
        fail(f"missing secret file {secret}")
    out = subprocess.run(
        [
            "docker", "compose",
            "--project-directory", str(root),
            "--env-file", str(secret),
            "-f", str(root / "compose.yaml"),
            "config", "--format", "json",
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    config = json.loads(out)

    images = {service["image"] for service in config["services"].values()}
    unexpected = images - ACCEPTED_IMAGES
    if unexpected:
        fail(f"unexpected image(s) in the resolved configuration: {sorted(unexpected)}")
    if images != ACCEPTED_IMAGES:
        fail(f"expected exactly the {len(ACCEPTED_IMAGES)} pinned images, found {sorted(images)}")

    for name, service in config["services"].items():
        if service.get("ports"):
            fail(f"service {name} publishes host port(s); the identity provider must not be reachable off-host except through the Frank edge")
        if service.get("privileged"):
            fail(f"service {name} is privileged")
        for volume in service.get("volumes") or []:
            source = volume.get("source", "") if isinstance(volume, dict) else str(volume)
            target = volume.get("target", "") if isinstance(volume, dict) else ""
            if source in {"/var/run/docker.sock", "/run/docker.sock"}:
                fail(f"service {name} mounts the Docker socket; this deployment uses the embedded outpost and must not be able to spawn containers")
            if source.startswith("/srv/frank/") and not source.startswith(REQUIRED_BIND_PREFIX):
                fail(f"service {name} mounts {source}; runtime state belongs under {REQUIRED_BIND_PREFIX}")
            if target == "/blueprints/custom" and not volume.get("read_only"):
                fail(f"service {name} mounts the blueprint directory writable")

    networks = config.get("networks", {})
    internal = [n for n in networks if n.endswith("owner-identity-internal")]
    if len(internal) != 1:
        fail("expected exactly one internal data network")
    if not networks[internal[0]].get("internal"):
        fail("the data network must be internal so the database cannot reach the internet")

    for name in INTERNAL_ONLY:
        if len(config["services"][name].get("networks", {})) != 1:
            fail(f"{name} must only join the internal data network")

    services = set(config["services"])
    if services != {"postgresql", "server", "worker"}:
        fail(f"unexpected service set: {sorted(services)}")

    print(
        "check-compose: resolved configuration matches the accepted owner identity stack "
        f"({len(services)} services, 0 published ports, {len(images)} pinned images)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
