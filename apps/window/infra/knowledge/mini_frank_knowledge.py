#!/usr/bin/env python3
"""Validate and compile the staged Mini Frank knowledge project.

This is a deterministic file compiler. It has no model client, database,
memory, scheduler, or network access. Hermes remains the execution owner.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


PAGE_SCHEMA = "schema://mini-frank.knowledge-page/v1"
REPOSITORY_SCHEMA = "schema://mini-frank.repository/v1"
SOURCE_SCHEMA = "schema://mini-frank.source/v1"
EVALUATION_SCHEMA = "schema://mini-frank.evaluation/v1"
KNOWN_SCHEMAS = {
    PAGE_SCHEMA,
    REPOSITORY_SCHEMA,
    SOURCE_SCHEMA,
    EVALUATION_SCHEMA,
    "schema://mini-frank.architecture/v1",
    "schema://mini-frank.kit-item/v1",
    "schema://mini-frank.feedback-lesson/v1",
}
STATUSES = {"candidate", "approved", "restricted", "deprecated", "rejected"}
PRIVACY = {"public", "internal", "private-client"}
TOKEN = re.compile(r"[a-z0-9]+")


class KnowledgeError(RuntimeError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise KnowledgeError(f"{path}: invalid JSON") from error
    if not isinstance(value, dict):
        raise KnowledgeError(f"{path}: top level must be an object")
    return value


def _read_markdown(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise KnowledgeError(f"{path}: missing JSON frontmatter")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise KnowledgeError(f"{path}: unterminated JSON frontmatter")
    try:
        metadata = json.loads(text[4:end])
    except json.JSONDecodeError as error:
        raise KnowledgeError(f"{path}: invalid JSON frontmatter") from error
    if not isinstance(metadata, dict):
        raise KnowledgeError(f"{path}: frontmatter must be an object")
    body = text[end + 5 :].strip()
    if not body:
        raise KnowledgeError(f"{path}: empty body")
    return metadata, body


def _require(record: dict[str, Any], fields: tuple[str, ...], path: Path) -> None:
    missing = [field for field in fields if record.get(field) in (None, "", [])]
    if missing:
        raise KnowledgeError(f"{path}: missing {', '.join(missing)}")


def _date(value: Any, field: str, path: Path) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError as error:
        raise KnowledgeError(f"{path}: {field} must be YYYY-MM-DD") from error


def _validate_source(record: dict[str, Any], path: Path) -> None:
    _require(record, ("schema", "id", "title", "kind", "locator", "revision", "sha256", "tier", "verified_at", "retention_rights"), path)
    if record["schema"] != SOURCE_SCHEMA:
        raise KnowledgeError(f"{path}: unsupported source schema")
    if not re.fullmatch(r"[0-9a-f]{64}", str(record["sha256"])):
        raise KnowledgeError(f"{path}: sha256 must be lowercase hexadecimal")
    if record["tier"] not in {"A", "B", "C"}:
        raise KnowledgeError(f"{path}: rejected source tiers must not be ingested")
    _date(record["verified_at"], "verified_at", path)


def _validate_record(record: dict[str, Any], path: Path) -> None:
    _require(record, ("schema", "id", "title", "kind", "status", "summary", "tags", "source_refs", "verified_at", "stale_after", "privacy"), path)
    if record["schema"] not in KNOWN_SCHEMAS - {SOURCE_SCHEMA, EVALUATION_SCHEMA}:
        raise KnowledgeError(f"{path}: unsupported record schema")
    if record["status"] not in STATUSES:
        raise KnowledgeError(f"{path}: unsupported status")
    if record["privacy"] not in PRIVACY:
        raise KnowledgeError(f"{path}: unsupported privacy class")
    if record["privacy"] == "private-client":
        raise KnowledgeError(f"{path}: private client records cannot enter shared knowledge")
    if not isinstance(record["tags"], list) or not all(isinstance(item, str) and item for item in record["tags"]):
        raise KnowledgeError(f"{path}: tags must be non-empty strings")
    if not isinstance(record["source_refs"], list) or not all(isinstance(item, str) and item for item in record["source_refs"]):
        raise KnowledgeError(f"{path}: source_refs must be non-empty strings")
    _date(record["verified_at"], "verified_at", path)
    _date(record["stale_after"], "stale_after", path)
    if record["status"] == "approved" and not record["source_refs"]:
        raise KnowledgeError(f"{path}: approved records require evidence")
    if record["schema"] == REPOSITORY_SCHEMA:
        _require(record, ("repository_url", "exact_revision", "license_spdx", "license_evidence_ref", "missing_evidence"), path)
        if not re.fullmatch(r"[0-9a-f]{40}", str(record["exact_revision"])):
            raise KnowledgeError(f"{path}: repository revision must be a full commit")
        if record["status"] == "approved" and record["missing_evidence"]:
            raise KnowledgeError(f"{path}: repository with missing evidence cannot be approved")
        if record["license_evidence_ref"] not in record["source_refs"]:
            raise KnowledgeError(f"{path}: licence evidence must be included in source_refs")
    if record["schema"] == "schema://mini-frank.architecture/v1":
        _require(record, ("applies_when", "not_for"), path)
        if not all(isinstance(value, list) and all(isinstance(item, str) and item for item in value) for value in (record["applies_when"], record["not_for"])):
            raise KnowledgeError(f"{path}: architecture applicability must be string arrays")
    if record["schema"] == "schema://mini-frank.kit-item/v1":
        _require(record, ("origin_ref", "license_spdx", "test_refs"), path)
    if record["schema"] == "schema://mini-frank.feedback-lesson/v1":
        _require(record, ("sample_size", "recognisability_check"), path)
        if record["privacy"] != "internal" or record["recognisability_check"] != "passed":
            raise KnowledgeError(f"{path}: shared feedback lessons must be internal and de-identified")


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def load_project(root: Path, verify_local_sources: bool = False, repo_root: Path | None = None) -> dict[str, Any]:
    knowledge = root / "knowledge"
    if not knowledge.is_dir():
        raise KnowledgeError(f"{root}: missing knowledge directory")

    schema_ids: set[str] = set()
    for path in sorted((knowledge / "schemas").glob("*.schema.json")):
        schema = _read_json(path)
        schema_id = str(schema.get("$id") or "")
        if not schema_id or schema_id in schema_ids:
            raise KnowledgeError(f"{path}: missing or duplicate $id")
        schema_ids.add(schema_id)
    missing_schemas = KNOWN_SCHEMAS - schema_ids
    if missing_schemas:
        raise KnowledgeError(f"missing schemas: {', '.join(sorted(missing_schemas))}")

    sources: dict[str, dict[str, Any]] = {}
    for path in sorted((knowledge / "sources" / "manifests").glob("*.json")):
        source = _read_json(path)
        _validate_source(source, path)
        source_id = str(source["id"])
        if source_id in sources:
            raise KnowledgeError(f"{path}: duplicate id {source_id}")
        source["path"] = _relative(path, root)
        sources[source_id] = source
        if verify_local_sources and source["kind"] == "local-file":
            if repo_root is None:
                raise KnowledgeError("repo root is required to verify local sources")
            local = (repo_root / str(source["locator"])).resolve()
            expected_root = repo_root.resolve()
            if expected_root not in local.parents and local != expected_root:
                raise KnowledgeError(f"{path}: source escapes repository")
            if not local.is_file():
                raise KnowledgeError(f"{path}: local source is missing")
            # Git may materialise committed text as LF or CRLF. Define local
            # evidence hashes over UTF-8 text normalised to LF so the same
            # source validates on Windows and Linux.
            text = local.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if digest != source["sha256"]:
                raise KnowledgeError(f"{path}: local source checksum changed")

    records: dict[str, dict[str, Any]] = {}
    roots = [knowledge / "governance", knowledge / "layers", knowledge / "build"]
    for record_root in roots:
        for path in sorted(record_root.rglob("*.md")):
            if path.name.lower() == "readme.md":
                continue
            record, body = _read_markdown(path)
            _validate_record(record, path)
            record_id = str(record["id"])
            if record_id in records:
                raise KnowledgeError(f"{path}: duplicate id {record_id}")
            unknown_sources = sorted(set(record["source_refs"]) - sources.keys())
            if unknown_sources:
                raise KnowledgeError(f"{path}: unknown sources {', '.join(unknown_sources)}")
            record["path"] = _relative(path, root)
            record["body_sha256"] = hashlib.sha256(body.encode("utf-8")).hexdigest()
            records[record_id] = record

    for record in records.values():
        related_refs = record.get("related_refs", [])
        if not isinstance(related_refs, list) or not all(isinstance(item, str) and item for item in related_refs):
            raise KnowledgeError(f"{root / record['path']}: related_refs must be non-empty strings")
        unknown_related = sorted(set(related_refs) - records.keys())
        if unknown_related:
            raise KnowledgeError(f"{root / record['path']}: unknown related records {', '.join(unknown_related)}")

    if not 12 <= len(records) <= 20:
        raise KnowledgeError(f"expected 12-20 seed records, found {len(records)}")

    fixtures: list[dict[str, Any]] = []
    for path in sorted((knowledge / "evaluations" / "fixtures").glob("*.json")):
        fixture = _read_json(path)
        _require(fixture, ("schema", "id", "query", "expected_contains", "max_results"), path)
        if fixture["schema"] != EVALUATION_SCHEMA:
            raise KnowledgeError(f"{path}: unsupported evaluation schema")
        unknown_expected = sorted(set(fixture["expected_contains"]) - records.keys())
        if unknown_expected:
            raise KnowledgeError(f"{path}: unknown expected records {', '.join(unknown_expected)}")
        fixtures.append(fixture)

    return {"root": root, "sources": sources, "records": records, "fixtures": fixtures}


def _tokens(value: str) -> set[str]:
    return set(TOKEN.findall(value.lower()))


def retrieve(project: dict[str, Any], query: str, limit: int) -> list[dict[str, Any]]:
    query_tokens = _tokens(query)
    ranked = []
    for record in project["records"].values():
        if record["status"] in {"deprecated", "rejected"}:
            continue
        title_tokens = _tokens(record["title"])
        tag_tokens = _tokens(" ".join(record["tags"]))
        summary_tokens = _tokens(record["summary"])
        score = 5 * len(query_tokens & tag_tokens) + 3 * len(query_tokens & title_tokens) + len(query_tokens & summary_tokens)
        if score:
            ranked.append({"id": record["id"], "score": score, "status": record["status"], "path": record["path"]})
    ranked.sort(key=lambda item: (-item["score"], item["id"]))
    return ranked[:limit]


def compile_project(project: dict[str, Any], output: Path, as_of: date) -> None:
    output.mkdir(parents=True, exist_ok=True)
    records = project["records"]
    catalog = {
        "schema": "schema://mini-frank.catalog/v1",
        "as_of": as_of.isoformat(),
        "record_count": len(records),
        "records": [
            {key: record[key] for key in ("id", "title", "kind", "status", "summary", "tags", "source_refs", "verified_at", "stale_after", "privacy", "path", "body_sha256")}
            for record in sorted(records.values(), key=lambda value: value["id"])
        ],
    }
    freshness = {"schema": "schema://mini-frank.freshness/v1", "as_of": as_of.isoformat(), "stale": [], "due_within_30_days": []}
    for record in sorted(records.values(), key=lambda value: value["id"]):
        stale_after = date.fromisoformat(record["stale_after"])
        if stale_after < as_of:
            freshness["stale"].append(record["id"])
        elif stale_after <= as_of + timedelta(days=30):
            freshness["due_within_30_days"].append(record["id"])

    edges = []
    for record in sorted(records.values(), key=lambda value: value["id"]):
        edges.extend({"from": record["id"], "to": ref, "kind": "supported-by"} for ref in sorted(record["source_refs"]))
        edges.extend({"from": record["id"], "to": ref, "kind": "related-to"} for ref in sorted(record.get("related_refs", [])))
    relationships = {"schema": "schema://mini-frank.relationships/v1", "edges": edges}

    generated_at = datetime.combine(as_of, datetime.min.time(), tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    fixture_results = []
    for fixture in project["fixtures"]:
        results = retrieve(project, fixture["query"], int(fixture["max_results"]))
        result_ids = [item["id"] for item in results]
        missing = sorted(set(fixture["expected_contains"]) - set(result_ids))
        if missing:
            raise KnowledgeError(f"fixture {fixture['id']}: missing {', '.join(missing)}")
        fixture_results.append({"id": fixture["id"], "query": fixture["query"], "result_ids": result_ids, "passed": True})

    files = {
        "catalog.json": catalog,
        "freshness-report.json": freshness,
        "relationships.json": relationships,
        "evaluation-results.json": {"schema": "schema://mini-frank.evaluation-results/v1", "generated_at": generated_at, "results": fixture_results},
    }
    for name, value in files.items():
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("validate", "build"))
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--as-of", default=date.today().isoformat())
    parser.add_argument("--verify-local-sources", action="store_true")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[4])
    args = parser.parse_args()
    try:
        as_of = date.fromisoformat(args.as_of)
        project = load_project(args.source.resolve(), args.verify_local_sources, args.repo_root.resolve())
        if args.command == "build":
            if args.output is None:
                raise KnowledgeError("--output is required for build")
            compile_project(project, args.output.resolve(), as_of)
        print(f"mini-frank knowledge: {len(project['records'])} records, {len(project['sources'])} sources, valid")
        return 0
    except (KnowledgeError, ValueError) as error:
        print(f"mini-frank knowledge: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
