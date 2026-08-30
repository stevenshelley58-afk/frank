#!/usr/bin/env python3
"""Capture bounded, redacted control-plane release evidence (read-only)."""
import argparse, hashlib, json, re, sys
from pathlib import Path

SHA = re.compile(r"^[0-9a-f]{40,64}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
SECRET = re.compile(rb"(?i)(password|secret|token|api[_-]?key|private[_-]?key|authorization|cookie)")
MANDATORY = {"projection:vps/world", "projection:frank/architecture", "projection:blockwise/runtime", "projection:mini-frank/knowledge-flow", "projection:ad-template-builder/architecture", "projection:ad-template-builder/workflow"}

def read(path: Path, limit=1024*1024):
    if path.is_symlink() or not path.is_file(): raise ValueError("unsafe evidence path")
    data = path.read_bytes()
    if len(data) > limit: raise ValueError("evidence exceeds bound")
    if SECRET.search(data): raise ValueError("secret-like content in evidence")
    return data

def main(argv=None):
    p=argparse.ArgumentParser(); p.add_argument("--root", type=Path, required=True); p.add_argument("--approved-sha", required=True); p.add_argument("--rollback-target", required=True); p.add_argument("--image-digest", required=True); p.add_argument("--browser-receipt", type=Path, required=True); a=p.parse_args(argv)
    if not SHA.fullmatch(a.approved_sha) or not SHA.fullmatch(a.rollback_target) or not DIGEST.fullmatch(a.image_digest): p.error("invalid release identity")
    try:
        root=a.root.resolve(); pointer=json.loads(read(root/"current.json")); maps=pointer.get("maps", {})
        if set(maps) != MANDATORY: raise ValueError("mandatory map set incomplete")
        map_hashes={}
        for k,v in maps.items():
            if not isinstance(v,dict) or not DIGEST.fullmatch(str(v.get("manifest_hash",""))): continue
            if v.get("manifest_path"):
                mp=(root/str(v["manifest_path"])).resolve()
                try: mp.relative_to(root)
                except ValueError: raise ValueError("manifest escapes root")
                actual="sha256:"+hashlib.sha256(read(mp)).hexdigest()
                if actual != v["manifest_hash"]: raise ValueError("manifest hash mismatch")
            map_hashes[k]=v["manifest_hash"]
        if set(map_hashes) != MANDATORY: raise ValueError("map manifest hashes incomplete")
        browser_path=a.browser_receipt.absolute()
        try: browser_path.relative_to(root)
        except ValueError: raise ValueError("browser receipt escapes evidence root")
        browser_hash="sha256:"+hashlib.sha256(read(browser_path)).hexdigest()
        graph_revision=str(pointer.get("graph_revision", ""))
        if not DIGEST.fullmatch(graph_revision): raise ValueError("invalid graph revision")
        result={"schema":"frank.release-evidence/v1","source_sha":a.approved_sha,"rollback_target":a.rollback_target,"image_digest":a.image_digest,"graph_revision":graph_revision,"projection_manifests":map_hashes,"browser_evidence":{"path":a.browser_receipt.name,"hash":browser_hash},"captured_at":"read-only"}
        print(json.dumps(result,sort_keys=True,separators=(",",":"))); return 0
    except (OSError,ValueError,KeyError,TypeError):
        print(json.dumps({"schema":"frank.release-evidence/v1","status":"failed","error_code":"evidence_rejected"})); return 1
if __name__ == "__main__": sys.exit(main())
