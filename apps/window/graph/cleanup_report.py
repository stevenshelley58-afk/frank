"""Report-first cleanup analysis.

This module is deliberately a boundary around external cleanup reporters.  It
never deletes, rewrites, installs, or enables anything.  Reporter output is
kept as evidence and converted to deterministic candidate findings for review.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .control_plane import canonical_bytes

REPORTER_DECISIONS = "receipt:oss-decision/cleanup-reporters"
REPORTER_VERSIONS = {
    "knip": "3c785f55ce608d7921e37e41dd5fc61b623e5da2",
    "dependency-cruiser": "1f28f44a49c054dc128226543188220818b1ab52",
    "jscpd": "b816fb777d885d963c7167cd9ae81035c1731660",
    "vulture": "2c21cb0ae2afa657e36f6a397cb573608a65d79e",
}
SUPPORTED_KINDS = {"dead_code", "dependencies", "duplicates", "stale_sources"}
EXCLUDED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "vendor", ".tox"}
_ID = re.compile(r"^(?:project|repo|component|source|receipt|finding):[a-z0-9][a-z0-9/-]*$")


class CleanupError(ValueError):
    """A bounded cleanup request or reporter result is invalid."""


@dataclass(frozen=True)
class ReporterDefinition:
    name: str
    version: str
    languages: tuple[str, ...]
    command: tuple[str, ...]
    output: str


REPORTERS = {
    "knip": ReporterDefinition("knip", REPORTER_VERSIONS["knip"], ("javascript", "typescript"), ("npx", "--no-install", "knip", "--reporter", "json"), "json"),
    "dependency-cruiser": ReporterDefinition("dependency-cruiser", REPORTER_VERSIONS["dependency-cruiser"], ("javascript", "typescript"), ("npx", "--no-install", "depcruise", "--output-type", "json"), "json"),
    "jscpd": ReporterDefinition("jscpd", REPORTER_VERSIONS["jscpd"], ("javascript", "typescript", "python"), ("npx", "--no-install", "jscpd", "--format", "json"), "json"),
    "vulture": ReporterDefinition("vulture", REPORTER_VERSIONS["vulture"], ("python",), ("vulture", "--json"), "json"),
}


def _digest(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "unknown"


def applicable_reporters(root: Path) -> tuple[ReporterDefinition, ...]:
    """Return only reporters applicable to files actually present in root."""
    suffixes = {p.suffix.lower() for p in _walk_files(root)}
    languages = set()
    if suffixes & {".js", ".jsx", ".mjs", ".cjs"}: languages.update(("javascript", "typescript"))
    if ".ts" in suffixes or ".tsx" in suffixes: languages.update(("javascript", "typescript"))
    if ".py" in suffixes: languages.add("python")
    return tuple(r for r in REPORTERS.values() if set(r.languages) & languages)


def _walk_files(root: Path) -> Iterable[Path]:
    root = Path(root).resolve()
    if not root.is_dir() or Path(root).is_symlink():
        raise CleanupError("cleanup root is not a directory")
    for path in root.rglob("*"):
        if any(part in EXCLUDED_DIRS for part in path.relative_to(root).parts):
            continue
        if path.is_symlink():
            continue
        if path.is_file() and not path.is_symlink():
            yield path


def stable_finding_id(*, project_id: str, kind: str, subject: str, source_revision: str) -> str:
    if not re.fullmatch(r"project:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*", project_id):
        raise CleanupError("invalid project stable ID")
    if kind not in SUPPORTED_KINDS:
        raise CleanupError("unsupported cleanup finding kind")
    key = _digest({"project": project_id, "kind": kind, "subject": subject, "source_revision": source_revision})[:24]
    return f"finding:cleanup/{_slug(project_id.split(':', 1)[1])}-{_slug(kind)}-{key}"


def normalize_candidate(candidate: Mapping[str, Any], *, project_id: str, kind: str, source_revision: str, evidence_receipt_id: str) -> dict[str, Any]:
    """Normalize heterogeneous reporter fields into one reviewable finding."""
    if not isinstance(candidate, Mapping) or not isinstance(evidence_receipt_id, str) or not re.fullmatch(r"^receipt:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$", evidence_receipt_id):
        raise CleanupError("invalid cleanup evidence")
    subject = str(candidate.get("file") or candidate.get("path") or candidate.get("name") or candidate.get("symbol") or candidate.get("dependency") or "unknown")
    summary = str(candidate.get("summary") or candidate.get("message") or f"{kind} candidate: {subject}")[:500]
    confidence = str(candidate.get("confidence", "medium")).lower()
    if confidence not in {"high", "medium", "low", "none"}: confidence = "medium"
    finding = {
        "id": stable_finding_id(project_id=project_id, kind=kind, subject=subject, source_revision=source_revision),
        "kind": kind,
        "subject_ids": [project_id],
        "severity": "high" if confidence == "high" else "medium" if confidence == "medium" else "low",
        "status": "candidate",
        "summary": summary,
        "reconciliation_result": "stale" if kind == "stale_sources" else "unparseable",
        "confidence": confidence,
        "evidence_receipt_ids": [evidence_receipt_id],
        # Review metadata is intentionally nested and never grants deletion authority.
        "review": {
            "usage_reference_evidence": candidate.get("references", candidate.get("usage", [])),
            "replacement": candidate.get("replacement"),
            "owner": candidate.get("owner"),
            "source_sha": source_revision,
            "estimated_value": candidate.get("estimated_value", "unknown"),
            "safe_retirement_path": candidate.get("safe_retirement_path", "retire only after owner review, replacement and passing checks"),
            "reporter": candidate.get("reporter"),
        },
    }
    return finding


def _extract_candidates(raw: Any, reporter: str) -> list[dict[str, Any]]:
    if isinstance(raw, list): return [dict(x, reporter=reporter) for x in raw if isinstance(x, Mapping)]
    if not isinstance(raw, Mapping): return []
    for key in ("issues", "results", "violations", "files", "dead_code", "duplicates"):
        value = raw.get(key)
        if isinstance(value, list):
            result = []
            for item in value:
                if isinstance(item, Mapping):
                    candidate = dict(item)
                    candidate["reporter"] = reporter
                    result.append(candidate)
            return result
    return []


def run_report(*, project_id: str, root: Path, source_revision: str, report_kind: str, receipt_id: str, timeout_seconds: int = 1800, exclusions: Sequence[str] = ()) -> dict[str, Any]:
    """Run applicable pinned tools and return a no-write cleanup report."""
    if report_kind not in SUPPORTED_KINDS: raise CleanupError("unsupported cleanup report kind")
    if not _ID.fullmatch(project_id) or not _ID.fullmatch(receipt_id): raise CleanupError("invalid stable ID")
    if not source_revision or timeout_seconds < 1 or timeout_seconds > 1800: raise CleanupError("invalid report bounds")
    root = Path(root).resolve()
    started = time.monotonic()
    findings: list[dict[str, Any]] = []
    raw_evidence: dict[str, Any] = {}
    errors: list[dict[str, str]] = []
    reporters = applicable_reporters(root)
    deadline = started + timeout_seconds
    for reporter in reporters:
        if reporter.name == "knip" and report_kind != "dead_code": continue
        if reporter.name == "dependency-cruiser" and report_kind != "dependencies": continue
        if reporter.name == "jscpd" and report_kind != "duplicates": continue
        if reporter.name == "vulture" and report_kind != "dead_code": continue
        executable = shutil.which(reporter.command[0])
        if not executable:
            errors.append({"reporter": reporter.name, "error": "tool_unavailable"})
            continue
        try:
            # argv is fixed by the pinned definition; no shell, command text, or writes.
            remaining = max(1, min(1800, int(deadline - time.monotonic())))
            result = subprocess.run((*reporter.command, str(root)), cwd=root, capture_output=True, text=True, timeout=remaining, check=False, shell=False)
            raw = json.loads(result.stdout or "[]")
            raw_evidence[reporter.name] = {"exit_code": result.returncode, "output": raw}
            for candidate in _extract_candidates(raw, reporter.name):
                subject = str(candidate.get("file") or candidate.get("path") or candidate.get("name") or candidate.get("symbol") or candidate.get("dependency") or "unknown")
                if subject in exclusions or any(subject.startswith(x.rstrip("/") + "/") for x in exclusions): continue
                findings.append(normalize_candidate(candidate, project_id=project_id, kind=report_kind, source_revision=source_revision, evidence_receipt_id=receipt_id))
            if result.returncode != 0: errors.append({"reporter": reporter.name, "error": "reporter_nonzero_exit"})
        except subprocess.TimeoutExpired:
            errors.append({"reporter": reporter.name, "error": "timeout"})
        except (json.JSONDecodeError, OSError):
            errors.append({"reporter": reporter.name, "error": "parse_error"})
    unique = {item["id"]: item for item in findings}
    captured = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "schema": "frank.cleanup-report/v1", "project_id": project_id, "report_kind": report_kind,
        "source_revision": source_revision, "captured_at": captured.isoformat().replace("+00:00", "Z"),
        "fresh_until": (captured + timedelta(days=8)).isoformat().replace("+00:00", "Z"),
        "reporters": [{"id": r.name, "revision": r.version} for r in reporters],
        "findings": sorted(unique.values(), key=lambda item: item["id"]), "raw_evidence": raw_evidence,
        "errors": errors, "mutated": False, "elapsed_seconds": round(time.monotonic() - started, 3),
        "exclusions": list(exclusions), "oss_decision_id": REPORTER_DECISIONS,
    }


def make_receipt(report: Mapping[str, Any], *, receipt_id: str, producer: str = "runtime:hermes-default") -> dict[str, Any]:
    """Create schema-compatible evidence for a report, with no private raw output."""
    if not isinstance(receipt_id, str) or not re.fullmatch(r"^receipt:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$", receipt_id):
        raise CleanupError("invalid cleanup receipt ID")
    report_hash = _digest(report)
    project_id = str(report["project_id"])
    return {"id": receipt_id, "kind": "cleanup_report", "subject_ids": [project_id], "producer": producer,
            "source_revision_set": {"source": str(report["source_revision"])}, "deployed_revision_set": {},
            "captured_at": report["captured_at"], "fresh_until": report["fresh_until"],
            "outcome": "fail" if report.get("errors") and not report.get("findings") else "partial" if report.get("errors") else "pass",
            "evidence_uris": [f"cleanup/{project_id}/{report_hash}.json"],
            "redaction": "secret_filtered", "schema": "frank.cleanup-report/v1", "findings": report.get("findings", []),
            "facts": {"report_hash": report_hash, "mutated": False, "report_only": True, "errors": report.get("errors", [])}}


def retention_candidates(*, artifacts: Iterable[Mapping[str, Any]], referenced_ids: set[str], now: datetime, retention_days: int = 90) -> list[dict[str, Any]]:
    """Return retirement candidates only; never remove artifacts."""
    cutoff = now.timestamp() - retention_days * 86400
    return [dict(a, disposition="retirement_candidate") for a in artifacts if str(a.get("id")) not in referenced_ids and float(a.get("modified_at", now.timestamp())) < cutoff]


def quota_warning(*, used_bytes: int, quota_bytes: int, threshold: float = 0.8) -> bool:
    if quota_bytes <= 0 or used_bytes < 0 or not (0 < threshold <= 1): raise CleanupError("invalid quota")
    return used_bytes / quota_bytes >= threshold


class CleanupReportAdapter:
    """Typed Hermes adapter seam for ``tool:run-cleanup-report``.

    The adapter returns an in-memory report.  A receipt store owned by the
    action service may persist it; this object itself has no filesystem write
    capability and cannot be used as a shell escape hatch.
    """

    adapter_id = "tool:adapter-cleanup"
    adapter_version = "1.0.0"
    adapter_hash = "sha256:" + hashlib.sha256(b"frank-cleanup-report-adapter-v1").hexdigest()

    def __init__(self, roots: Mapping[str, Path], *, source_revisions: Mapping[str, str] | None = None):
        self.roots = {str(k): Path(v).resolve() for k, v in roots.items()}
        self.source_revisions = dict(source_revisions or {})

    def execute(self, target_id: str, arguments: Mapping[str, Any], *, timeout_seconds: int = 1800) -> Mapping[str, Any]:
        root = self.roots.get(target_id)
        if root is None: raise CleanupError("cleanup target is not allowlisted")
        kind = str(arguments.get("report_kind", "dead_code"))
        receipt_id = str(arguments.get("receipt_id", "receipt:cleanup/action"))
        report = run_report(project_id=target_id, root=root, source_revision=self.source_revisions.get(target_id, "unknown"), report_kind=kind, receipt_id=receipt_id, timeout_seconds=timeout_seconds)
        return {"ok": not (report["errors"] and not report["findings"]), "report": report, "mutated": False}


__all__ = ["CleanupError", "ReporterDefinition", "REPORTERS", "CleanupReportAdapter", "applicable_reporters", "normalize_candidate", "run_report", "make_receipt", "retention_candidates", "quota_warning", "stable_finding_id"]
