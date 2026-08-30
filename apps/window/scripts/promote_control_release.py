"""Promote an immutable control-plane evidence bundle (fail closed)."""
import argparse, json, os, subprocess, tempfile, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from graph.release_state import ReleaseStateStore, ReleaseEvidenceError

UNITS = {
    "step5": ("frank-control-reconcile-fast.timer", "frank-control-reconcile-full.timer"),
    "step6c": (),
    "step7c": ("frank-cleanup-report.timer", "frank-discovery-refresh.timer", "frank-evaluation.timer", "frank-chat-pattern.timer"),
    "step8": ("frank-restore-drill.timer",),
}

def main(argv=None):
    p=argparse.ArgumentParser(); p.add_argument("evidence", type=Path); p.add_argument("--store", type=Path, default=Path("/var/lib/frank/release")); p.add_argument("--flags-file", type=Path, default=Path("/var/lib/frank/release/feature-flags.env")); p.add_argument("--release-id"); p.add_argument("--dry-run", action="store_true"); p.add_argument("--rollback", action="store_true")
    a=p.parse_args(argv)
    evidence=json.loads(a.evidence.read_text(encoding="utf-8")); stage=evidence.get("stage") or evidence.get("release_stage")
    rid=a.release_id or evidence.get("release_id")
    if not isinstance(stage,str) or not isinstance(rid,str): raise SystemExit("evidence must declare stage and release_id")
    store=ReleaseStateStore(a.store)
    if a.dry_run:
        record={"id":"release:"+rid,"release_id":rid,"stage":stage,"evidence":store._validate_evidence(evidence,stage)}
        print(json.dumps(record, sort_keys=True)); return 0
    record=store.create_release(rid,stage,evidence)
    store.advance_current(rid)
    flags=record["evidence"]["feature_flags"]
    a.flags_file.parent.mkdir(parents=True, exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".flags-", dir=a.flags_file.parent)
    with os.fdopen(fd,"w",encoding="utf-8") as f:
        for k,v in sorted(flags.items()): f.write(f"FRANK_FEATURE_FLAG_{k.upper()}={'1' if v else '0'}\n")
        f.flush(); os.fsync(f.fileno())
    os.chmod(tmp,0o600); os.replace(tmp,a.flags_file)
    for unit in UNITS[stage]:
        subprocess.run(("systemctl", "enable" if not a.rollback else "disable", "--now", unit), check=True)
    return 0
if __name__ == "__main__":
    try: raise SystemExit(main())
    except (ReleaseEvidenceError, OSError, ValueError) as e: raise SystemExit(str(e))
