#!/usr/bin/env python3
"""Publish a Hermes-exported Blockwise ops bundle into Frank's read store.

Hermes (or a Hermes-owned job) supplies ``--input``. This entrypoint performs
only schema validation and atomic publication; it has no provider SDKs or
credential access.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from apps.window.ops_projections import BlockwiseOpsClient, ProjectionError, publish_bundle


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path(os.environ.get("HERMES_OPS_PUBLISH_INPUT", "/data/ops-source/bundle.json")))
    parser.add_argument("--output-root", type=Path, default=Path(os.environ.get("HERMES_OPS_PROJECTION_ROOT", "/data/ops-projections")))
    parser.add_argument("--freshness-seconds", type=int, default=900)
    args = parser.parse_args(argv)
    if not 60 <= args.freshness_seconds <= 86400:
        parser.error("freshness must be between 60 and 86400 seconds")
    try:
        if os.environ.get("BLOCKWISE_OPS_BASE_URL", "").strip():
            bundle = BlockwiseOpsClient.from_env().fetch_bundle()
        else:
            raw = args.input.read_bytes()
            if len(raw) > 8 * 1024 * 1024:
                raise ProjectionError("publisher input exceeds the size bound")
            bundle = json.loads(raw.decode("utf-8"))
        receipt = publish_bundle(bundle, args.output_root, freshness_seconds=args.freshness_seconds)
    except (OSError, UnicodeError, json.JSONDecodeError, ProjectionError) as error:
        print(json.dumps({"status": "error", "message": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps({"status": "published", "publication_receipt_id": receipt}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
