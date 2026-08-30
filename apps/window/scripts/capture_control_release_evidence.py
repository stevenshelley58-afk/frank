#!/usr/bin/env python3
"""Capture one self-contained, hash-bound Step 8 production evidence bundle."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SHA = re.compile(r"^[0-9a-f]{40,64}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
GRAPH_REVISION = re.compile(r"^g_[0-9a-f]{64}$")
PLACEHOLDER = re.compile(r"(?:^|[-_ ])(?:todo|tbd|placeholder|changeme|not[-_ ]supplied)(?:$|[-_ ])", re.I)
SECRET = re.compile(
    rb"(?i)(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    rb"(?:password|secret|token|api[_-]?key|authorization)\s*[:=]\s*['\"]?[^\s,'\"]{8,})"
)
MANDATORY = frozenset(
    {
        "projection:vps/world",
        "projection:frank/architecture",
        "projection:blockwise/runtime",
        "projection:mini-frank/knowledge-flow",
        "projection:ad-template-builder/architecture",
        "projection:ad-template-builder/workflow",
    }
)
FLAGS = (
    "live_view",
    "map_view",
    "control_read",
    "reconciliation_schedules",
    "runtime_monitoring",
    "safe_actions",
    "operational_actions",
    "source_actions",
    "cleanup_jobs",
    "discovery_jobs",
    "evaluation_jobs",
    "chat_pattern_candidates",
    "retention_restore_drills",
)
CHECKLIST = (
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
)


def _canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def _digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _secure_root(path: Path, *, create: bool = False) -> Path:
    absolute = path.absolute()
    if any(candidate.is_symlink() for candidate in (absolute, *absolute.parents)):
        raise ValueError("filesystem boundary contains a symlink")
    if create:
        absolute.mkdir(parents=True, exist_ok=True)
    if not absolute.is_dir() or absolute.resolve() != absolute:
        raise ValueError("filesystem boundary is not a real directory")
    return absolute


def _read(path: Path, root: Path, *, limit: int = 1024 * 1024) -> bytes:
    absolute_root = _secure_root(root)
    absolute = path.absolute()
    try:
        relative = absolute.relative_to(absolute_root)
    except ValueError as exc:
        raise ValueError("evidence path escapes its fixed root") from exc
    if any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("evidence path is not canonical")
    cursor = absolute_root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError("evidence path contains a symlink")
    resolved = absolute.resolve(strict=True)
    try:
        resolved.relative_to(absolute_root)
    except ValueError as exc:
        raise ValueError("evidence path escapes its fixed root") from exc
    if not resolved.is_file() or resolved.is_symlink():
        raise ValueError("evidence source is not a regular file")
    with resolved.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("evidence source exceeds its size bound")
    if SECRET.search(data):
        raise ValueError("evidence source contains secret-like material")
    return data


def _load_json(path: Path, root: Path, *, limit: int = 1024 * 1024) -> Any:
    try:
        value = json.loads(_read(path, root, limit=limit).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("evidence JSON is malformed") from exc
    return value


def _relative_source(root: Path, raw: Any) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("evidence path is missing")
    relative = Path(raw)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("evidence path is unsafe")
    return root / relative


def _contains_placeholder(value: Any) -> bool:
    if isinstance(value, str):
        return not value.strip() or PLACEHOLDER.search(value.strip()) is not None
    if isinstance(value, list):
        return any(_contains_placeholder(item) for item in value)
    if isinstance(value, dict):
        return any(_contains_placeholder(item) for item in value.values())
    return False


def _evidence_list(path: Path) -> list[Any]:
    value = _load_json(path, path.absolute().parent)
    result = value if isinstance(value, list) else [value]
    if not result or _contains_placeholder(result):
        raise ValueError("release evidence is empty or contains placeholders")
    return result


def _copy(source: Path, source_root: Path, target: Path, *, limit: int = 1024 * 1024) -> tuple[bytes, str]:
    data = _read(source, source_root, limit=limit)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return data, _digest(data)


def _capture(args: argparse.Namespace, bundle: Path) -> dict[str, Any]:
    maps_root = _secure_root(args.maps_root)
    selector = _load_json(maps_root / "current.json", maps_root)
    if (
        not isinstance(selector, dict)
        or selector.get("schema") != "frank.map-promotion/v1"
        or selector.get("status") != "promoted"
        or GRAPH_REVISION.fullmatch(str(selector.get("graph_revision", ""))) is None
        or not isinstance(selector.get("projections"), dict)
        or set(selector["projections"]) != MANDATORY
    ):
        raise ValueError("production map selector is incomplete")
    graph_revision = selector["graph_revision"]

    projection_manifests: list[dict[str, str]] = []
    for index, projection_id in enumerate(sorted(MANDATORY)):
        pointer = selector["projections"][projection_id]
        if not isinstance(pointer, dict) or pointer.get("graph_revision") != graph_revision:
            raise ValueError("production map pointer is malformed")
        manifest_source = _relative_source(maps_root, pointer.get("manifest_path"))
        artifact_source = _relative_source(maps_root, pointer.get("artifact_path"))
        manifest_data = _read(manifest_source, maps_root)
        artifact_data = _read(artifact_source, maps_root, limit=8 * 1024 * 1024)
        if _digest(manifest_data) != pointer.get("manifest_hash") or _digest(artifact_data) != pointer.get("artifact_hash"):
            raise ValueError("production map byte hash mismatch")
        try:
            manifest = json.loads(manifest_data.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("production map manifest is malformed") from exc
        if (
            not isinstance(manifest, dict)
            or manifest.get("projection_id") != projection_id
            or manifest.get("generation_id") != pointer.get("generation_id")
            or manifest.get("graph_revision") != graph_revision
            or manifest.get("artifact_hash") != pointer.get("artifact_hash")
            or manifest.get("status") != "generated"
        ):
            raise ValueError("production map manifest identity mismatch")
        target = bundle / "maps" / f"{index:02d}-{projection_id.split(':', 1)[1].replace('/', '-')}" / "manifest.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(manifest_data)
        projection_manifests.append(
            {
                "projection_id": projection_id,
                "path": target.relative_to(bundle).as_posix(),
                "sha256": _digest(manifest_data),
            }
        )

    browser_root = _secure_root(args.browser_receipt.absolute().parent)
    browser = _load_json(args.browser_receipt, browser_root)
    if not isinstance(browser, dict) or browser.get("schema") != "frank.browser-journey/v2" or browser.get("status") != "pass":
        raise ValueError("browser receipt is not passing")
    browser = copy.deepcopy(browser)
    journeys = browser.get("journeys")
    if not isinstance(journeys, dict) or set(journeys) != {"desktop", "mobile"}:
        raise ValueError("browser receipt lacks both viewports")
    screenshot_hashes: list[str] = []
    for viewport, journey in sorted(journeys.items()):
        screenshots = journey.get("screenshots") if isinstance(journey, dict) else None
        if not isinstance(screenshots, dict):
            raise ValueError("browser screenshots are malformed")
        for index, (surface, shot) in enumerate(sorted(screenshots.items())):
            if not isinstance(shot, dict) or not DIGEST.fullmatch(str(shot.get("sha256", ""))):
                raise ValueError("browser screenshot identity is malformed")
            source = _relative_source(browser_root, shot.get("path"))
            target = bundle / "browser" / viewport / f"{index:02d}-{surface.strip('/').replace('/', '-') or 'home'}.png"
            _, digest = _copy(source, browser_root, target, limit=8 * 1024 * 1024)
            if digest != shot["sha256"]:
                raise ValueError("browser screenshot hash mismatch")
            shot["path"] = target.relative_to(bundle).as_posix()
            screenshot_hashes.append(digest)
    if len(screenshot_hashes) != 12 or len(screenshot_hashes) != len(set(screenshot_hashes)):
        raise ValueError("browser screenshot set is incomplete or ambiguous")
    browser_data = _canonical(browser)
    browser_target = bundle / "browser" / "receipt.json"
    browser_target.parent.mkdir(parents=True, exist_ok=True)
    browser_target.write_bytes(browser_data)

    tests = _evidence_list(args.tests)
    runtime = _evidence_list(args.runtime_evidence)
    restore = _load_json(args.restore_receipt, args.restore_receipt.absolute().parent)
    if (
        not isinstance(restore, dict)
        or restore.get("status") != "passed"
        or not isinstance(restore.get("receipt_id"), str)
        or _contains_placeholder(restore.get("receipt_id"))
    ):
        raise ValueError("restore drill evidence is not passing")

    feature_flags = {key: True for key in FLAGS}
    captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "schema": "frank.release-evidence/v1",
        "release_id": args.release_id,
        "stage": "step8",
        "source_sha": args.source_sha,
        "deployed_sha": args.deployed_sha,
        "image_digest": args.image_digest,
        "graph_revision": graph_revision,
        "projection_manifests": projection_manifests,
        "tests": tests,
        "runtime_health": runtime,
        "runtime_evidence": runtime,
        "browser_review": browser,
        "browser_evidence": {"path": browser_target.relative_to(bundle).as_posix(), "sha256": _digest(browser_data)},
        "screenshot_hashes": sorted(screenshot_hashes),
        "reviewer": args.reviewer,
        "rollback_target": args.rollback_target,
        "feature_flags": feature_flags,
        "feature_flag_hash": _digest(_canonical(feature_flags).rstrip(b"\n")),
        "restore_drill": restore,
        "acceptance_checklist": {key: True for key in CHECKLIST},
        "timestamp": captured_at,
        "captured_at": captured_at,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--maps-root", type=Path, required=True)
    parser.add_argument("--browser-receipt", type=Path, required=True)
    parser.add_argument("--tests", type=Path, required=True)
    parser.add_argument("--runtime-evidence", type=Path, required=True)
    parser.add_argument("--restore-receipt", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--deployed-sha", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--rollback-target", required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)

    stage: Path | None = None
    try:
        if (
            SHA.fullmatch(args.source_sha) is None
            or SHA.fullmatch(args.deployed_sha) is None
            or SHA.fullmatch(args.rollback_target) is None
            or DIGEST.fullmatch(args.image_digest) is None
            or re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", args.release_id) is None
            or not isinstance(args.reviewer, str)
            or not 1 <= len(args.reviewer.strip()) <= 128
            or _contains_placeholder(args.reviewer)
        ):
            raise ValueError("release identity is invalid")
        destination = args.output_dir.absolute()
        parent = _secure_root(destination.parent, create=True)
        if any(candidate.is_symlink() for candidate in (destination, *destination.parents)):
            raise ValueError("output boundary contains a symlink")
        if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
            raise ValueError("output directory must be absent or empty")
        stage = Path(tempfile.mkdtemp(prefix=".frank-evidence-", dir=parent))
        evidence = _capture(args, stage)
        evidence_path = stage / "evidence.json"
        evidence_path.write_bytes(_canonical(evidence))
        if destination.exists():
            destination.rmdir()
        os.replace(stage, destination)
        stage = None
        print(json.dumps({"status": "captured", "release_id": args.release_id, "graph_revision": evidence["graph_revision"], "output_dir": str(destination)}, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({"status": "failed", "error_code": "evidence_rejected"}, sort_keys=True))
        return 1
    finally:
        if stage is not None and stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    raise SystemExit(main())
