#!/usr/bin/env python3
"""Promote a hash-verified map preview receipt."""
import argparse, json, sys
from pathlib import Path
from graph.map_release_orchestrator import promote, PromotionError

# Ad Builder -> Blockwise flow is conditional and is never required without
# explicit runtime-consumption evidence.
MANDATORY = {"projection:vps/world", "projection:frank/architecture", "projection:blockwise/runtime", "projection:mini-frank/knowledge-flow", "projection:ad-template-builder/architecture", "projection:ad-template-builder/workflow"}
def main(argv=None):
    p=argparse.ArgumentParser(); p.add_argument("receipt", type=Path); p.add_argument("--production-root", required=True); p.add_argument("--timeout", type=float, default=300); a=p.parse_args(argv)
    if not 1 <= a.timeout <= 1800: p.error("timeout outside 1..1800 seconds")
    try:
        value=json.loads(a.receipt.read_text(encoding="utf-8")); result=promote(receipt=value, production_root=a.production_root, mandatory=MANDATORY, timeout_seconds=a.timeout)
    except (OSError, ValueError, PromotionError) as e:
        print(json.dumps({"status":"failed","error_code":"promotion_rejected"})); return 1
    print(json.dumps(result, sort_keys=True)); return 0
if __name__ == "__main__": sys.exit(main())
