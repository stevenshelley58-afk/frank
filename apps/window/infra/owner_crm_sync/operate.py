"""Deterministic Hermes script job. No model calls or parallel task store."""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import sys
import time
from customer_sync import ConnectorError, BlockwiseSnapshotClient, FrappeContactStore, load_sync_credentials, run

STATE = Path("/srv/hermes/state/owner-crm-sync")

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
    parser.add_argument("command", choices=["preview", "run", "pause", "resume", "status"])
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
        store = FrappeContactStore()
        try:
            credentials = load_sync_credentials()
            store.authenticate(credentials.frappe_api_key, credentials.frappe_api_secret)
            source = BlockwiseSnapshotClient(base_url=credentials.blockwise_snapshot_url,
                signing_secret=credentials.blockwise_signing_secret, scope=credentials.blockwise_scope)
            result = run(snapshot_client=source, store=store, apply=args.command == "run")
            summary = (result.applied or result.preview).summary()
            receipt = {"status":"failed" if summary.get("failed") else "ok", "mode":args.command,
                "finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "summary":summary}
        except (ConnectorError, OSError):
            receipt = {"status":"failed", "mode":args.command, "finished_at":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "error":"source_or_native_crm_unavailable; no credentials or customer payload logged"}
        finally:
            store.close()
        atomic_json(STATE / "last-run.json", receipt)
        print(json.dumps(receipt))
        return int(receipt["status"] == "failed")

if __name__ == "__main__":
    sys.exit(main())
