"""Step 8 acceptance harness.

This module only reads the repository and an operator-supplied evidence file.
It never enables flags, contacts a VPS, runs a service, or mutates a receipt.
Deployment evidence is deliberately ``pending`` until a real signed receipt is
provided; the harness must not turn repository fixtures into production proof.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

SHA256 = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
SHA = re.compile(r"^[0-9a-f]{40,64}$")
MANDATORY_PROJECTIONS = {
    "projection:vps/world",
    "projection:frank/architecture",
    "projection:blockwise/runtime",
    "projection:mini-frank/knowledge-flow",
    "projection:ad-template-builder/architecture",
    "projection:ad-template-builder/workflow",
}
REQUIRED_ACTIONS = {
    "tool:refresh-evidence", "tool:regenerate-map", "tool:restore-map",
    "tool:run-cleanup-report", "tool:run-job", "tool:retry-job", "tool:cancel-job",
    "tool:run-ad-template-builder", "tool:retry-ad-template-builder",
    "tool:cancel-ad-template-builder", "tool:enable-capability", "tool:disable-capability",
    "tool:deploy-frank", "tool:rollback-frank", "tool:deploy-blockwise",
    "tool:rollback-blockwise", "tool:restart-service", "tool:create-rule",
    "tool:edit-rule", "tool:retire-rule", "tool:create-skill", "tool:edit-skill",
    "tool:retire-skill",
}
REQUIRED_CHECKLIST = {
    "one_frank_one_checkout_one_hermes",
    "no_local_persistent_service",
    "vps_world_coverage_and_exclusions",
    "projections_and_lkg_validation",
    "ad_builder_blockwise_truth",
    "live_is_pinned_agenttrail",
    "runtime_summaries_and_links",
    "control_counts_from_records",
    "control_categories_understandable",
    "managed_actions_end_to_end",
    "source_changes_recoverable",
    "duplicate_decisions_and_evaluations",
    "drift_report_only",
    "map_failure_preserves_lkg",
    "cleanup_no_auto_delete",
    "discovery_no_auto_install",
    "oss_receipts_and_revisions",
    "upstreams_remain_authorities",
    "chat_patterns_private_content_free",
    "desktop_mobile_keyboard_reduced_motion",
    "deployed_revisions_and_rollbacks_visible",
    "restore_and_rollback_drill",
    "retention_restore_drill",
    "reconciliation_timers_and_pointers",
    "retention_quota_references_preserved",
}
# Match concrete quoted material only. Environment references such as
# ``TOKEN="${TOKEN:-}"`` are boundary-safe configuration, not leaked secrets.
SECRET_MARKERS = re.compile(r"(?i)(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|password|secret|token)\s*[:=]\s*['\"](?!\$|<|REPLACE|YOUR_)[^'\"]{8,})")


@dataclass
class Finding:
    name: str
    status: str  # pass, fail, pending
    detail: str


@dataclass
class AcceptanceReport:
    findings: list[Finding] = field(default_factory=list)

    @property
    def failed(self) -> list[Finding]:
        return [f for f in self.findings if f.status == "fail"]

    @property
    def pending(self) -> list[Finding]:
        return [f for f in self.findings if f.status == "pending"]

    def as_dict(self) -> dict[str, Any]:
        return {"status": "fail" if self.failed else ("pending" if self.pending else "pass"),
                "findings": [f.__dict__ for f in self.findings]}


def _load(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"missing required file: {path}")
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else {}


def _hash(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _add(report: AcceptanceReport, name: str, status: str, detail: str) -> None:
    report.findings.append(Finding(name, status, detail))


def _static_checks(root: Path, report: AcceptanceReport) -> None:
    control = root / "governance" / "control-plane"
    flags = _load(control / "feature-flags.yaml")
    defaults = flags.get("defaults", {})
    declared = flags.get("flags", {})
    if defaults and all(value is False for value in defaults.values()) and set(defaults) == set(declared):
        _add(report, "flags.disabled-by-default", "pass", f"{len(defaults)} declared flags default false")
    else:
        _add(report, "flags.disabled-by-default", "fail", "defaults must exist for every declared flag and all be false")

    projections = _load(control / "projections.yaml").get("projections", [])
    ids = {p.get("id") for p in projections if isinstance(p, dict)}
    missing = MANDATORY_PROJECTIONS - ids
    _add(report, "projections.mandatory", "fail" if missing else "pass",
         f"missing: {sorted(missing)}" if missing else "six mandatory projections declared")
    conditional = next((p for p in projections if p.get("id") == "projection:ad-template-builder/data-flow"), None)
    valid_conditional = conditional and (conditional.get("status") == "not_generated" and conditional.get("missing_evidence")) or conditional and conditional.get("status") != "not_generated"
    _add(report, "projections.conditional-truth", "pass" if valid_conditional else "fail",
         "conditional data-flow has truthful status and missing evidence" if valid_conditional else "conditional projection lacks status/missing_evidence")

    actions = _load(control / "actions.yaml").get("actions", [])
    by_id = {a.get("id"): a for a in actions if isinstance(a, dict)}
    missing = REQUIRED_ACTIONS - set(by_id)
    bad_rollbacks = [key for key, action in by_id.items() if key in REQUIRED_ACTIONS and action.get("rollback_action_id") and action["rollback_action_id"] not in by_id]
    _add(report, "actions.complete", "fail" if missing or bad_rollbacks else "pass",
         f"missing={sorted(missing)} rollback_targets={bad_rollbacks}" if missing or bad_rollbacks else "required action and rollback targets declared")

    required_docs = ["PROJECT.md", "FRANK_RELEASE_RUNBOOK.md", "FRANK_AGENTTRAIL_ARCHIFY.md"]
    absent_docs = [name for name in required_docs if not (root / "docs" / name).exists()]
    _add(report, "docs.release-contract", "fail" if absent_docs else "pass", f"missing={absent_docs}" if absent_docs else "authority and release docs present")

    cleanup = _load(control / "cleanup-reporters.yaml")
    safety = cleanup.get("safety", {})
    safe = (cleanup.get("mode") == "report_only" and cleanup.get("enabled") is False
            and safety.get("auto_delete") is False and safety.get("auto_install") is False
            and safety.get("mutates_source") is False and safety.get("mutates_runtime") is False)
    _add(report, "cleanup.report-only", "pass" if safe else "fail",
         "cleanup is disabled/report-only and cannot auto-delete/install" if safe else "cleanup safety contract is weakened")

    # Scan only tracked source/config/docs (never vendor, dependencies, or generated data).
    candidates = [p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts and "vendor" not in p.parts and "node_modules" not in p.parts and "tests" not in p.parts and "docs" not in p.parts and "graph-workbench.bundle.js" not in p.name and p.suffix in {".py", ".js", ".mjs", ".yaml", ".yml", ".json", ".sh", ".html", ".css"}]
    leaks = []
    for path in candidates:
        text = path.read_text(encoding="utf-8", errors="ignore")
        if SECRET_MARKERS.search(text) and ".env.example" not in str(path):
            leaks.append(str(path.relative_to(root)))
    _add(report, "security.no-obvious-secrets", "fail" if leaks else "pass", f"matches={leaks}" if leaks else "no obvious secret literals in checked source")

    # Static guard against accidentally adding a second local persistent stack.
    compose = root / "apps" / "window" / "docker-compose.yml"
    body = compose.read_text(encoding="utf-8") if compose.exists() else ""
    local_stack = bool(re.search(r"(?m)^\s*(?:agenttrail|archify|hermes|hindsight|worker)\s*:", body))
    _add(report, "runtime.no-local-competing-stack", "fail" if local_stack else "pass",
         "competing persistent service names found in Window compose" if local_stack else "Window compose contains no competing control-plane stack")


def _evidence_checks(evidence: dict[str, Any] | None, root: Path, report: AcceptanceReport, require_live: bool) -> None:
    if not evidence:
        _add(report, "production.evidence", "fail" if require_live else "pending", "provide a real Step 8 release receipt; no live evidence fabricated")
        return
    required = {"source_sha", "image_digest", "deployed_sha", "graph_revision", "projection_manifests", "tests", "runtime_health", "browser_review", "screenshot_hashes", "reviewer", "rollback_target", "feature_flag_hash", "timestamp", "acceptance_checklist"}
    missing = sorted(required - set(evidence))
    hashes_ok = all(isinstance(evidence.get(key), str) and SHA256.fullmatch(evidence[key]) for key in ("image_digest", "graph_revision", "feature_flag_hash") if key in evidence)
    revisions_ok = all(isinstance(evidence.get(key), str) and SHA.fullmatch(evidence[key]) for key in ("source_sha", "deployed_sha") if key in evidence)
    manifest_errors = []
    for item in evidence.get("projection_manifests", []):
        if not isinstance(item, dict) or not item.get("path") or not SHA256.fullmatch(str(item.get("sha256", ""))):
            manifest_errors.append("path/hash")
            continue
        manifest = root / item["path"]
        if manifest.exists() and _hash(manifest) != item["sha256"]:
            manifest_errors.append(item["path"])
    browser = evidence.get("browser_review", {})
    browser_errors = []
    try:
        captured = datetime.fromisoformat(str(browser.get("captured_at", "") if isinstance(browser, dict) else "").replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - captured).total_seconds()
        if captured.tzinfo is None or age > 86400 or age < 0:
            browser_errors.append("stale browser receipt")
    except ValueError:
        browser_errors.append("browser timestamp")
    if not isinstance(browser, dict) or browser.get("schema") != "frank.browser-journey/v1":
        browser_errors.append("browser receipt missing or wrong schema")
    else:
        if not browser.get("browser_version") or not isinstance(browser.get("viewport"), dict): browser_errors.append("browser metadata")
        if browser.get("reduced_motion") is not True or browser.get("keyboard") is not True or browser.get("authenticated_context") is not True or browser.get("agenttrail_mutation_denied") is not True or browser.get("csp_verified") is not True: browser_errors.append("interaction/security checks")
        shots = browser.get("screenshots", {})
        required_surfaces = {"/", "/mini-frank", "/live", "/map", "/control", "/agenttrail/"}
        if set(shots) != required_surfaces: browser_errors.append("required surfaces missing")
        seen = set()
        if not isinstance(shots, dict) or len(shots) != len(set(shots)):
            browser_errors.append("duplicate/missing screenshots")
        else:
            for item in shots.values():
                if not isinstance(item, dict) or item.get("path") in seen: browser_errors.append("duplicate screenshot"); continue
                raw_path = item.get("path", "")
                path = Path(raw_path)
                if path.is_absolute(): browser_errors.append("screenshot path escapes evidence root"); continue
                path = (root / path).resolve()
                try: path.relative_to(root.resolve())
                except (ValueError, TypeError): browser_errors.append("screenshot path escapes evidence root"); continue
                seen.add(raw_path)
                if not path.is_file() or _hash(path) != item.get("sha256"): browser_errors.append("screenshot hash/file mismatch")
    nonempty_lists = all(isinstance(evidence.get(key), list) and bool(evidence[key]) for key in (
        "projection_manifests", "tests", "runtime_health", "screenshot_hashes"))
    checklist = evidence.get("acceptance_checklist", {})
    checklist_shape = isinstance(checklist, dict) and set(checklist) == REQUIRED_CHECKLIST
    secret_free = not SECRET_MARKERS.search(json.dumps(evidence, sort_keys=True, default=str))
    status = "fail" if (missing or not hashes_ok or not revisions_ok or manifest_errors or browser_errors
                         or not nonempty_lists or not checklist_shape or not secret_free) else "pass"
    _add(report, "production.receipt-binding", status,
         f"missing={missing}; hashes={hashes_ok}; revisions={revisions_ok}; "
         f"manifest_errors={manifest_errors}; browser_errors={browser_errors}; nonempty={nonempty_lists}; "
         f"checklist_shape={checklist_shape}; secret_free={secret_free}")
    flags = _load(root / "governance" / "control-plane" / "feature-flags.yaml").get("defaults", {})
    supplied_flags = evidence.get("feature_flags", {})
    expected = {key: True for key in flags}
    flags_ok = supplied_flags == expected
    restore = evidence.get("restore_drill", {})
    restore_ok = isinstance(restore, dict) and restore.get("status") == "passed" and restore.get("receipt_id")
    _add(report, "production.all-flags-bound", "pass" if flags_ok else "fail", "exact all-true Step 8 flag set is bound" if flags_ok else "feature_flags must explicitly contain every declared flag=true")
    receipt_hashes = {v.get("sha256") for v in browser.get("screenshots", {}).values()} if isinstance(browser, dict) else set()
    supplied_hashes = set(evidence.get("screenshot_hashes", []))
    _add(report, "production.screenshot-hash-binding", "pass" if receipt_hashes == supplied_hashes else "fail", "top-level screenshot hashes match browser receipt" if receipt_hashes == supplied_hashes else "screenshot hashes do not match browser receipt")
    _add(report, "production.restore-drill", "pass" if restore_ok else "fail", "restore drill receipt is bound" if restore_ok else "restore_drill.status=passed and receipt_id are required before enabling retention_restore_drills")
    checklist_ok = checklist_shape and all(value is True for value in checklist.values())
    _add(report, "production.acceptance-checklist", "pass" if checklist_ok else "fail", "all final acceptance items explicitly passed" if checklist_ok else "acceptance_checklist must explicitly record true for every final item")


def run_acceptance(root: Path, evidence_path: Path | None = None, require_live: bool = False) -> AcceptanceReport:
    report = AcceptanceReport()
    _static_checks(root, report)
    evidence = _load(evidence_path) if evidence_path else None
    _evidence_checks(evidence, root, report, require_live)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only Step 8 Frank acceptance checks")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--require-live", action="store_true")
    args = parser.parse_args(argv)
    report = run_acceptance(args.root, args.evidence, args.require_live)
    print(json.dumps(report.as_dict(), indent=2, sort_keys=True))
    return 1 if report.failed or (args.require_live and report.pending) else 0


if __name__ == "__main__":
    raise SystemExit(main())
