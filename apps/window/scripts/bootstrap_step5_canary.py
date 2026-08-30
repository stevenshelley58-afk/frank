#!/usr/bin/env python3
"""Temporarily enable the first-release Step 5 flags for a browser canary.

This is a bootstrap aid only.  It refuses an existing release selector, never
advances one, and records the exact previous flag bytes so cleanup is
deterministic.  The Window is recreated after each flag transition because
Compose reads the flag file only at container creation time.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.promote_control_release import ALL_FLAGS, _flags_bytes, _parse_flags, _promotion_lock, _write_flags
from graph.release_state import ReleaseStateStore


SCHEMA = "frank.step5-canary/v1"
STATE_NAME = ".step5-canary-state.json"
STEP5_FLAGS = frozenset({
    "live_view", "map_view", "control_read", "reconciliation_schedules",
    "runtime_monitoring",
})


def _safe_file(path: Path) -> bytes | None:
    if path.is_symlink():
        raise RuntimeError("flag path must not be a symlink")
    if not path.exists():
        return None
    if not path.is_file():
        raise RuntimeError("flag path must be a regular file")
    data = path.read_bytes()
    _parse_flags(data)
    return data


def _inside_store(path: Path, store: Path) -> Path:
    store = store.absolute()
    candidate = path.absolute()
    try:
        candidate.relative_to(store)
    except ValueError as exc:
        raise RuntimeError("canary paths must stay inside the release store") from exc
    cursor = candidate.parent
    while True:
        if cursor.is_symlink():
            raise RuntimeError("release store ancestry contains a symlink")
        if cursor == store:
            break
        if cursor == cursor.parent:
            raise RuntimeError("canary path escaped release store")
        cursor = cursor.parent
    return candidate


def _state_path(flags_file: Path, store: Path) -> Path:
    _inside_store(flags_file, store)
    if flags_file.parent.is_symlink():
        raise RuntimeError("flag parent must not be a symlink")
    return flags_file.parent / STATE_NAME


def _assert_first_release(store: Path) -> None:
    if store.is_symlink() or not store.is_dir():
        raise RuntimeError("release store must be a real directory")
    current = store / "current.json"
    if current.is_symlink() or current.exists():
        raise RuntimeError("Step 5 bootstrap requires no existing release selector")


def _write_state(path: Path, flags_file: Path, store: Path, previous: bytes | None, target: bytes) -> None:
    state = {
        "schema": SCHEMA,
        "flags_path": flags_file.relative_to(store).as_posix(),
        "had_previous": previous is not None,
        "previous_flags": base64.b64encode(previous).decode("ascii") if previous is not None else None,
        "previous_sha256": hashlib.sha256(previous).hexdigest() if previous is not None else None,
        "target_sha256": hashlib.sha256(target).hexdigest(),
    }
    fd, temporary = tempfile.mkstemp(prefix=".step5-canary-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _load_state(path: Path, flags_file: Path, store: Path) -> tuple[bytes | None, str]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("Step 5 canary state is missing or unsafe")
    value = json.loads(path.read_text(encoding="utf-8"))
    if (value.get("schema") != SCHEMA or value.get("flags_path") != flags_file.relative_to(store).as_posix()
            or not isinstance(value.get("target_sha256"), str)):
        raise RuntimeError("Step 5 canary state is invalid")
    encoded = value.get("previous_flags")
    previous = None if encoded is None else base64.b64decode(encoded, validate=True)
    if previous is not None:
        _parse_flags(previous)
        if value.get("previous_sha256") != hashlib.sha256(previous).hexdigest():
            raise RuntimeError("Step 5 canary state previous flags hash mismatch")
    elif value.get("previous_sha256") is not None:
        raise RuntimeError("Step 5 canary state previous flags is malformed")
    return previous, value["target_sha256"]


def _recreate(compose_file: Path, flags_file: Path | None) -> None:
    if compose_file.is_symlink() or not compose_file.is_file():
        raise RuntimeError("Compose file is missing or unsafe")
    try:
        environment = os.environ.copy()
        if flags_file is None:
            environment.pop("FRANK_RELEASE_FLAGS_FILE", None)
        else:
            environment["FRANK_RELEASE_FLAGS_FILE"] = str(flags_file)
        subprocess.run(
            ["docker", "compose", "-f", str(compose_file), "up", "-d", "--force-recreate", "frank-window", "frank-agenttrail"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env=environment,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("Window canary recreation failed") from exc


def apply(flags_file: Path, store: Path, compose_file: Path) -> None:
    flags_file = _inside_store(flags_file, store)
    _assert_first_release(store)
    state = _state_path(flags_file, store)
    if state.exists():
        raise RuntimeError("Step 5 canary is already active")
    previous = _safe_file(flags_file)
    target = _flags_bytes({key: key in STEP5_FLAGS for key in ALL_FLAGS})
    _write_state(state, flags_file, store, previous, target)
    try:
        _write_flags(flags_file, target)
        _recreate(compose_file, flags_file)
    except Exception:
        try:
            if previous is None:
                if flags_file.exists() and not flags_file.is_symlink():
                    flags_file.unlink()
            else:
                _write_flags(flags_file, previous)
            try:
                _recreate(compose_file, flags_file if previous is not None else None)
                if state.exists() and not state.is_symlink():
                    state.unlink()
            except Exception:
                # The marker was removed only when flag restoration succeeded;
                # a failed environment compensation is surfaced to the caller.
                raise
        finally:
            raise


def cleanup(flags_file: Path, store: Path, compose_file: Path) -> None:
    flags_file = _inside_store(flags_file, store)
    state = _state_path(flags_file, store)
    release_store = ReleaseStateStore(store)
    if (store / "current.json").exists():
        # Promotion has completed: validate the selected Step 5 record and
        # hand off from the temporary canary file to the canonical env file.
        current = release_store.read_current()
        if current is None or current.get("stage") != "step5":
            raise RuntimeError("canary handoff requires a valid Step 5 release")
        expected = _flags_bytes({key: key in STEP5_FLAGS for key in ALL_FLAGS})
        canonical = store / "feature-flags.env"
        if _safe_file(canonical) != expected:
            raise RuntimeError("canonical Step 5 flags do not match release")
        _recreate(compose_file, None)
        if flags_file.exists() and not flags_file.is_symlink():
            flags_file.unlink()
        if state.exists() and not state.is_symlink():
            state.unlink()
        return
    _assert_first_release(store)
    previous, target_hash = _load_state(state, flags_file, store)
    current = _safe_file(flags_file)
    target = _flags_bytes({key: key in STEP5_FLAGS for key in ALL_FLAGS})
    if hashlib.sha256(target).hexdigest() != target_hash:
        raise RuntimeError("canary flags changed; refusing cleanup")
    if current == target:
        if previous is None:
            if flags_file.exists() and not flags_file.is_symlink():
                flags_file.unlink()
        else:
            _write_flags(flags_file, previous)
        recreate_flags = flags_file if previous is not None else None
    elif (previous is None and current is None) or (previous is not None and current == previous):
        # A previous cleanup restored the file but recreation failed; retry
        # using the already-restored production environment.
        recreate_flags = flags_file if previous is not None else None
    else:
        raise RuntimeError("canary flags changed; refusing cleanup")
    try:
        _recreate(compose_file, recreate_flags)
    except Exception:
        # Keep the state marker so cleanup can be retried safely.
        raise
    state.unlink()


def _locked_apply(flags_file: Path, store: Path, compose_file: Path) -> None:
    with _promotion_lock(store):
        apply(flags_file, store, compose_file)


def _locked_cleanup(flags_file: Path, store: Path, compose_file: Path) -> None:
    with _promotion_lock(store):
        cleanup(flags_file, store, compose_file)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply", "cleanup"))
    parser.add_argument("--flags-file", type=Path, default=Path("/var/lib/frank/release/.step5-canary-flags.env"))
    parser.add_argument("--store", type=Path, default=Path("/var/lib/frank/release"))
    parser.add_argument("--compose-file", type=Path, default=Path("/projects/frank/apps/window/docker-compose.yml"))
    args = parser.parse_args(argv)
    try:
        if args.action == "apply":
            _locked_apply(args.flags_file, args.store, args.compose_file)
        else:
            _locked_cleanup(args.flags_file, args.store, args.compose_file)
        print(json.dumps({"status": "applied" if args.action == "apply" else "cleaned", "schema": SCHEMA}))
        return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError):
        print(json.dumps({"status": "failed", "error_code": "step5_canary_rejected"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
