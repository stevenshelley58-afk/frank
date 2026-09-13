"""Deterministic Hermes operator entry point for the owner email consent bridge."""
import argparse
import contextlib
import fcntl
import io
import json
import os
from pathlib import Path
import sys
import time

from source_adapter import main as adapter_main

STATE = Path("/srv/hermes/state/owner-email-flows")


def atomic_json(path, value):
    temp = path.with_suffix(".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("preview", "run", "pause", "resume", "status"))
    args = parser.parse_args()
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / "lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('{"status":"already_running"}')
            return 0
        paused = STATE / "paused"
        if args.command == "pause":
            paused.touch(mode=0o600)
            print('{"status":"paused"}')
            return 0
        if args.command == "resume":
            paused.unlink(missing_ok=True)
            print('{"status":"resumed"}')
            return 0
        if args.command == "status":
            result = json.loads((STATE / "last-run.json").read_text()) if (STATE / "last-run.json").exists() else {"status":"not_run"}
            result["paused"] = paused.exists()
            print(json.dumps(result))
            return 0
        if args.command == "run" and paused.exists():
            print('{"status":"paused"}')
            return 0
        command = "preview" if args.command == "preview" else "run"
        original = sys.argv
        output = io.StringIO()
        try:
            sys.argv = ["source_adapter.py", command]
            with contextlib.redirect_stdout(output):
                code = adapter_main()
        finally:
            sys.argv = original
        try:
            summary = json.loads(output.getvalue())
        except json.JSONDecodeError:
            summary = {"failed": 1}
            code = 2
        receipt = {
            "status": "ok" if code == 0 else "failed",
            "mode": args.command,
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "summary": summary,
        }
        atomic_json(STATE / "last-run.json", receipt)
        print(json.dumps(receipt))
        return code


if __name__ == "__main__":
    raise SystemExit(main())
