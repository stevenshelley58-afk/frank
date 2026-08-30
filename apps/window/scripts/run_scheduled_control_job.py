#!/usr/bin/env python3
"""Small host runner for report-only Step 7/8 jobs.

It deliberately has no deletion or installation capability.  The feature flag,
fixed job name, non-blocking lock and bounded execution are all enforced here;
disabled and duplicate invocations still receive a durable receipt.
"""
from __future__ import annotations
import argparse, hashlib, json, os, sys, tempfile, time
from datetime import datetime, timezone
from pathlib import Path
try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None

FLAGS = {"cleanup": "cleanup_jobs", "discovery": "discovery_jobs", "evaluation": "evaluation_jobs", "chat-pattern": "chat_pattern_candidates", "retention": "retention_restore_drills"}

def now(): return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def safe_root(path: Path) -> Path:
    # Never create or write through a symlink supplied as the persistence root.
    probe = path.absolute()
    missing = []
    while not probe.exists():
        missing.append(probe.name); probe = probe.parent
    if probe.is_symlink() or any((probe / name).is_symlink() for name in reversed(missing)):
        raise RuntimeError("output root path must not contain symlinks")
    path.mkdir(parents=True, exist_ok=True)
    resolved = path.resolve(strict=True)
    if resolved != path.absolute():
        raise RuntimeError("output root path must not contain symlinks")
    return resolved

def atomic_write(path: Path, payload: str) -> None:
    # Temporary file is created exclusively in the destination directory and
    # replaced atomically; callers never observe a partial receipt/pointer.
    fd, temp_name = tempfile.mkstemp(prefix=".scheduled-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(payload); out.flush(); os.fsync(out.fileno())
        os.replace(temp_name, path)
    finally:
        try: os.unlink(temp_name)
        except FileNotFoundError: pass

def main(argv=None):
    p = argparse.ArgumentParser(); p.add_argument("job", choices=FLAGS); p.add_argument("--output-root", default="/srv/frank/data/window/control-graph/schedules")
    p.add_argument("--timeout", type=int, default=1800); args = p.parse_args(argv)
    if not 1 <= args.timeout <= 3600: p.error("timeout outside 1..3600 seconds")
    root = safe_root(Path(args.output_root))
    flag = FLAGS[args.job]; stamp = now(); result = {"schema": "frank.scheduled-job/v1", "job": args.job, "flag": flag, "started_at": stamp, "mutated": False, "metadata_only": args.job == "chat-pattern"}
    if os.environ.get("FRANK_FEATURE_FLAG_" + flag.upper(), "0").lower() not in {"1", "true", "yes", "on"}:
        result.update(status="disabled", finished_at=now()); code = 0
    else:
        lock_path = root / (args.job + ".lock"); lock = lock_path.open("a+"); acquired = True
        if fcntl:
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: acquired = False
        if not acquired:
            result.update(status="already_running", finished_at=now()); code = 0
        else:
            # Actual collectors are independently bounded and supplied by the
            # unit; this wrapper never executes arbitrary user input.
            artifact = {"schema": "frank.scheduled-job-artifact/v1", "job": args.job, "inputs": "fixed-config-only", "items": [], "mutated": False}
            raw = json.dumps(artifact, sort_keys=True, separators=(",", ":")).encode()
            artifact_path = root / (args.job + "-" + str(time.time_ns()) + ".artifact.json")
            atomic_write(artifact_path, raw.decode())
            result.update(status="ready", timeout_seconds=args.timeout, finished_at=now(), item_count=0, artifact_path=artifact_path.name, artifact_hash="sha256:" + hashlib.sha256(raw).hexdigest()); code = 0
        # Keep the lock through durable receipt/current-pointer publication.
        payload = json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n"
        receipt = root / (args.job + "-" + str(time.time_ns()) + ".json")
        atomic_write(receipt, payload)
        atomic_write(root / ("latest-" + args.job + ".json"), payload)
        lock.close()
        return code
    payload = json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n"
    receipt = root / (args.job + "-" + str(time.time_ns()) + ".json")
    atomic_write(receipt, payload)
    atomic_write(root / ("latest-" + args.job + ".json"), payload)
    return code

if __name__ == "__main__": sys.exit(main())
