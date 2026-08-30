"""Bounded weekly cleanup report entry point (report-only)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from graph.cleanup_report import run_report, make_receipt  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weekly", action="store_true")
    parser.add_argument("--project-id", default="project:frank")
    parser.add_argument("--root", type=Path, default=Path("/projects/frank"))
    parser.add_argument("--source-revision", default="unknown")
    parser.add_argument("--report-kind", choices=["dead_code", "dependencies", "duplicates", "stale_sources"], default="dead_code")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    report_id = "receipt:cleanup/weekly-" + args.project_id.split(":", 1)[1].replace("/", "-")
    report = run_report(project_id=args.project_id, root=args.root, source_revision=args.source_revision, report_kind=args.report_kind, receipt_id=report_id)
    receipt = make_receipt(report, receipt_id=report_id)
    value = {"report": report, "receipt": receipt}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    else:
        print(json.dumps(value, sort_keys=True))
    return 0 if not report["errors"] or report["findings"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
