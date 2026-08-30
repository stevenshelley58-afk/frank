"""Promote or roll back immutable control-plane release evidence."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.release_state import ReleaseEvidenceError, ReleaseStateStore

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows test hosts are single-process.
    fcntl = None


UNITS = {
    "step5": ("frank-control-reconcile-fast.timer", "frank-control-reconcile-full.timer"),
    "step6c": (),
    "step7c": (
        "frank-cleanup-report.timer",
        "frank-discovery-refresh.timer",
        "frank-evaluation.timer",
        "frank-chat-pattern.timer",
    ),
    "step8": ("frank-restore-drill.timer",),
}
STAGES = tuple(UNITS)
ALL_UNITS = frozenset(unit for units in UNITS.values() for unit in units)
ALL_FLAGS = frozenset(
    {
        "live_view",
        "map_view",
        "control_read",
        "reconciliation_schedules",
        "runtime_monitoring",
        "safe_actions",
        "operational_actions",
        "source_actions",
        "cleanup_jobs",
        "discovery_jobs",
        "evaluation_jobs",
        "chat_pattern_candidates",
        "retention_restore_drills",
    }
)
FLAG_LINE = re.compile(r"^FRANK_FEATURE_FLAG_([A-Z_]+)=([01])$")


def _desired_units(stage: str) -> frozenset[str]:
    if stage not in STAGES:
        raise ReleaseEvidenceError("invalid release stage")
    result: set[str] = set()
    for candidate in STAGES[: STAGES.index(stage) + 1]:
        result.update(UNITS[candidate])
    return frozenset(result)


def _safe_flags_path(path: Path, release_root: Path) -> Path:
    absolute = path.absolute()
    if any(candidate.is_symlink() for candidate in (absolute, *absolute.parents)):
        raise ReleaseEvidenceError("feature flag path contains a symlink")
    if absolute.parent.resolve() != release_root.resolve():
        raise ReleaseEvidenceError("feature flag file must stay in the release store")
    if absolute.exists() and not absolute.is_file():
        raise ReleaseEvidenceError("feature flag target is not a regular file")
    return absolute


@contextmanager
def _promotion_lock(release_root: Path):
    """Serialize release state, flags, and fixed timer transitions on Linux."""
    path = release_root / ".promotion.lock"
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ReleaseEvidenceError("release promotion lock is unsafe")
    handle = path.open("a+")
    try:
        if fcntl is not None:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise ReleaseEvidenceError("another release promotion is active") from exc
        yield
    finally:
        if fcntl is not None:
            fcntl.flock(handle, fcntl.LOCK_UN)
        handle.close()


def _parse_flags(data: bytes) -> dict[str, bool]:
    try:
        lines = data.decode("utf-8").splitlines()
    except UnicodeError as exc:
        raise ReleaseEvidenceError("feature flag file is not UTF-8") from exc
    parsed: dict[str, bool] = {}
    for line in lines:
        match = FLAG_LINE.fullmatch(line)
        if not match:
            raise ReleaseEvidenceError("feature flag file contains an invalid entry")
        key = match.group(1).lower()
        if key not in ALL_FLAGS or key in parsed:
            raise ReleaseEvidenceError("feature flag file contains an unknown or duplicate flag")
        parsed[key] = match.group(2) == "1"
    return parsed


def _effective_flags(flags: Mapping[str, bool]) -> dict[str, bool]:
    if any(key not in ALL_FLAGS or not isinstance(value, bool) for key, value in flags.items()):
        raise ReleaseEvidenceError("release contains invalid feature flags")
    return {key: bool(flags.get(key, False)) for key in sorted(ALL_FLAGS)}


def _flags_bytes(flags: Mapping[str, bool]) -> bytes:
    effective = _effective_flags(flags)
    return "".join(
        f"FRANK_FEATURE_FLAG_{key.upper()}={'1' if value else '0'}\n"
        for key, value in effective.items()
    ).encode("utf-8")


def _read_flags(path: Path) -> bytes | None:
    if path.is_symlink():
        raise ReleaseEvidenceError("feature flag file must not be a symlink")
    if not path.exists():
        return None
    if not path.is_file():
        raise ReleaseEvidenceError("feature flag target is not a regular file")
    data = path.read_bytes()
    _parse_flags(data)
    return data


def _write_flags(path: Path, data: bytes) -> None:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ReleaseEvidenceError("feature flag target is unsafe")
    _parse_flags(data)
    fd, temporary = tempfile.mkstemp(prefix=".flags-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        try:
            parent = os.open(path.parent, os.O_RDONLY)
            os.fsync(parent)
            os.close(parent)
        except OSError:
            if os.name != "nt":
                raise
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _restore_flags(path: Path, previous: bytes | None) -> None:
    if previous is not None:
        _write_flags(path, previous)
        return
    if path.is_symlink():
        raise ReleaseEvidenceError("feature flag target became a symlink")
    if path.exists():
        if not path.is_file():
            raise ReleaseEvidenceError("feature flag target is unsafe")
        path.unlink()


def _reconcile_units(desired: frozenset[str], *, best_effort: bool = False) -> list[str]:
    errors: list[str] = []
    commands = [
        *(("systemctl", "disable", "--now", unit) for unit in sorted(ALL_UNITS - desired)),
        *(("systemctl", "enable", "--now", unit) for unit in sorted(desired)),
    ]
    for command in commands:
        try:
            subprocess.run(command, check=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            if not best_effort:
                raise
            errors.append(f"{command[-1]}: {type(exc).__name__}")
    return errors


def _activate(
    store: ReleaseStateStore,
    record: Mapping[str, object],
    flags_path: Path,
    *,
    rollback: bool,
) -> None:
    current = store.read_current()
    previous_flags = _read_flags(flags_path)
    if current is not None:
        if previous_flags is None:
            raise ReleaseEvidenceError("active release has no feature flag file")
        on_disk = _effective_flags(_parse_flags(previous_flags))
        expected = _effective_flags(current["evidence"]["feature_flags"])
        if on_disk != expected:
            raise ReleaseEvidenceError("active release and feature flag file disagree")
    previous_units = _desired_units(current["stage"]) if current else frozenset()
    target_flags = _flags_bytes(record["evidence"]["feature_flags"])
    target_units = _desired_units(str(record["stage"]))
    try:
        # Timer changes are reversible preparation.  The immutable pointer is
        # the final commit, so readers never select a release whose timer
        # transition has not completed.
        _reconcile_units(target_units)
        _write_flags(flags_path, target_flags)
        if rollback:
            store.rollback_current(
                str(record["release_id"]),
                expected_current_release_id=str(current["release_id"]) if current else None,
            )
        else:
            store.advance_current(str(record["release_id"]))
    except Exception as exc:
        compensation_errors: list[str] = []
        try:
            selected = store.read_current()
            if current is None:
                if selected is not None:
                    if selected.get("release_id") != record.get("release_id"):
                        raise ReleaseEvidenceError("current release changed during compensation")
                    store.clear_current(str(record["release_id"]))
            elif selected is not None and selected.get("release_id") != current.get("release_id"):
                store.rollback_current(
                    str(current["release_id"]),
                    expected_current_release_id=str(record["release_id"]),
                )
        except Exception as restore_exc:
            compensation_errors.append(f"pointer: {type(restore_exc).__name__}")
        try:
            _restore_flags(flags_path, previous_flags)
        except Exception as restore_exc:
            compensation_errors.append(f"flags: {type(restore_exc).__name__}")
        compensation_errors.extend(_reconcile_units(previous_units, best_effort=True))
        suffix = "; compensation=" + ",".join(compensation_errors) if compensation_errors else ""
        raise ReleaseEvidenceError(f"release activation failed and was restored{suffix}") from exc


def _load_evidence(path: Path) -> dict[str, object]:
    if path.is_symlink() or not path.is_file():
        raise ReleaseEvidenceError("evidence must be a regular file")
    data = path.read_bytes()
    if len(data) > 1024 * 1024:
        raise ReleaseEvidenceError("evidence exceeds the one MiB bound")
    value = json.loads(data.decode("utf-8"))
    if not isinstance(value, dict):
        raise ReleaseEvidenceError("evidence must be an object")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--store", type=Path, default=Path("/var/lib/frank/release"))
    parser.add_argument("--flags-file", type=Path, default=Path("/var/lib/frank/release/feature-flags.env"))
    parser.add_argument("--release-id")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args(argv)

    store = ReleaseStateStore(args.store)
    flags_path = _safe_flags_path(args.flags_file, store.root)
    if args.rollback:
        if args.dry_run:
            raise ReleaseEvidenceError("rollback cannot be combined with dry-run")
        if not args.release_id:
            raise ReleaseEvidenceError("rollback requires --release-id of an existing LKG")
        with _promotion_lock(store.root):
            target = store.read_release(args.release_id)
            _activate(store, target, flags_path, rollback=True)
        return 0

    evidence = _load_evidence(args.evidence)
    stage = evidence.get("stage") or evidence.get("release_stage")
    release_id = args.release_id or evidence.get("release_id")
    if not isinstance(stage, str) or not isinstance(release_id, str):
        raise ReleaseEvidenceError("evidence must declare stage and release_id")
    if args.dry_run:
        record = {
            "id": "release:" + release_id,
            "release_id": release_id,
            "stage": stage,
            "evidence": store._validate_evidence(evidence, stage),
        }
        print(json.dumps(record, sort_keys=True))
        return 0
    with _promotion_lock(store.root):
        record = store.create_release(release_id, stage, evidence)
        _activate(store, record, flags_path, rollback=False)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReleaseEvidenceError, OSError, ValueError) as exc:
        raise SystemExit(str(exc))
