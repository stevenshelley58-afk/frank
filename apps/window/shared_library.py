"""Frank's versioned shared-library adapter and quarantined candidate queue.

Approved entries are context/references only. This module never installs or
executes referenced resources and never reads customer memory.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
from typing import Any
import urllib.parse

CATALOG_SCHEMA = "schema://frank.shared-library-catalog/v1"
RECORD_SCHEMA = "schema://frank.shared-library-record/v1"
QUEUE_SCHEMA = "schema://frank.shared-library-candidate/v1"
BUNDLE_SCHEMA = "schema://frank.shared-library-bundle/v1"
DEFAULT_SEED = Path(__file__).resolve().parent / "infra/knowledge/shared-library/catalog.json"


def _default_root() -> Path:
    """Runtime root: FRANK_SHARED_LIBRARY_ROOT, then the container /data mount,
    then the host-only Window data path for host CLI use."""
    override = os.environ.get("FRANK_SHARED_LIBRARY_ROOT")
    if override:
        return Path(override)
    if Path("/data").is_dir():
        return Path("/data/window/knowledge/shared-library")
    return Path("/srv/frank/data/window/knowledge/shared-library")


DEFAULT_ROOT = _default_root()
PROJECT_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
RECORD_RE = re.compile(r"^(knowledge|resource|skill|tool):frank/[a-z0-9][a-z0-9-]{2,95}$")
CANDIDATE_RE = re.compile(r"^candidate_[0-9a-f]{32}$")
REVIEWER_RE = re.compile(r"^(agent|operator|runtime):[A-Za-z0-9._-]{2,80}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
SPDX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$")
PRIVATE_RE = re.compile(
    r"api[_ -]?key|access[_ -]?token|password|bearer\s+\S+|/workspace/private|"
    r"acct_[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY", re.I,
)


class SharedLibraryError(RuntimeError):
    pass


def _canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def _text(value: object, limit: int, required: bool = True) -> str:
    value = " ".join(str(value or "").split()).strip()
    if (required and not value) or len(value) > limit or PRIVATE_RE.search(value):
        raise SharedLibraryError("text is missing, too long, or private")
    return value


def _project(value: object) -> str:
    value = str(value or "").strip()
    if not PROJECT_RE.fullmatch(value):
        raise SharedLibraryError("invalid project id")
    return value


def _date(value: object, field: str, required: bool = True) -> str:
    value = str(value or "").strip()
    if not value and not required:
        return ""
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as error:
        raise SharedLibraryError(f"{field} must be YYYY-MM-DD") from error


def _directory(path: Path, create: bool = False) -> Path:
    if create:
        path.mkdir(parents=True, exist_ok=True)
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise SharedLibraryError(f"directory unavailable: {path}") from error
    if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
        raise SharedLibraryError(f"not a real directory: {path}")
    return path


def _child_directory(parent: Path, name: str) -> Path:
    """Create or validate one child level without ever following symlinks."""
    parent = _directory(parent)
    child = parent / name
    if child.exists():
        return _directory(child)
    try:
        os.mkdir(child, 0o750)
    except FileExistsError:
        pass
    return _directory(child)


def _publish_atomically(target: Path, payload: str) -> bool:
    """Publish a fully written record so concurrent readers never see partial
    data. Publication is no-clobber: an existing identical file is idempotent,
    a differing one is a conflict. Returns True when newly published."""
    parent = _directory(target.parent)
    temp = parent / f".tmp-{secrets.token_hex(10)}"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o640)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        try:
            os.link(temp, target, follow_symlinks=False)
            published = True
        except FileExistsError:
            try:
                existing = _read(target, parent)
            except SharedLibraryError:
                existing = None
            if existing != json.loads(payload):
                raise SharedLibraryError("library record conflict") from None
            published = False
    finally:
        try:
            os.unlink(temp)
        except OSError:
            pass
    dfd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)
    return published


def _read(path: Path, parent: Path) -> dict[str, Any]:
    try:
        path.resolve(strict=True).relative_to(parent.resolve(strict=True))
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_size > 256 * 1024:
            raise SharedLibraryError("unsafe library record")
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        raise SharedLibraryError(f"invalid library JSON: {path}") from error
    if not isinstance(value, dict):
        raise SharedLibraryError("library JSON must be an object")
    return value


def _source(value: object, executable: bool) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"kind", "reference", "revision", "sha256"}:
        raise SharedLibraryError("invalid provenance fields")
    kind = str(value.get("kind") or "")
    reference = _text(value.get("reference"), 500)
    revision = _text(value.get("revision"), 160, executable)
    digest = str(value.get("sha256") or "").lower()
    if kind == "public_url":
        url = urllib.parse.urlsplit(reference)
        host = (url.hostname or "").lower()
        private_host = False
        try:
            ipaddress.ip_address(host)
            private_host = True
        except ValueError:
            private_host = host == "localhost" or host.endswith(".localhost") or "." not in host
        if (url.scheme != "https" or not host or url.username or url.password
                or url.query or url.fragment or private_host):
            raise SharedLibraryError("public provenance must be a plain public HTTPS URL")
    elif kind == "repository":
        if not reference.startswith("repo://") or ".." in reference:
            raise SharedLibraryError("invalid repository provenance")
    else:
        raise SharedLibraryError("unsupported provenance kind")
    if digest and not SHA_RE.fullmatch(digest):
        raise SharedLibraryError("invalid source digest")
    if executable and (not revision or not digest):
        raise SharedLibraryError("executable reference lacks immutable provenance")
    return {"kind": kind, "reference": reference, "revision": revision, "sha256": digest}


def validate_record(value: object, status: str) -> dict[str, Any]:
    fields = {"schema", "id", "version", "kind", "title", "summary", "tags", "industry",
              "source", "status", "sensitivity", "verified_at", "expires_at", "reference",
              "license_spdx", "test_refs"}
    allowed = fields | ({"admission"} if status == "approved" else set())
    if not isinstance(value, dict) or set(value) != allowed:
        raise SharedLibraryError("record fields do not match the schema")
    match = RECORD_RE.fullmatch(str(value.get("id") or ""))
    kind = str(value.get("kind") or "")
    if value.get("schema") != RECORD_SCHEMA or value.get("status") != status or not match or match.group(1) != kind:
        raise SharedLibraryError("invalid record identity")
    try:
        version = int(value.get("version"))
    except (TypeError, ValueError) as error:
        raise SharedLibraryError("invalid record version") from error
    if version < 1 or value.get("sensitivity") != "public":
        raise SharedLibraryError("invalid version or non-public record")
    tags = value.get("tags")
    if not isinstance(tags, list) or not 1 <= len(tags) <= 20:
        raise SharedLibraryError("invalid tags")
    tags = [_text(tag, 50) for tag in tags]
    if len(set(tags)) != len(tags) or any(not re.fullmatch(r"[a-z0-9][a-z0-9-]*", tag) for tag in tags):
        raise SharedLibraryError("tags must be unique lowercase slugs")
    executable = kind in {"resource", "skill", "tool"}
    reference = _text(value.get("reference"), 300, executable)
    licence = _text(value.get("license_spdx"), 64, executable)
    tests = value.get("test_refs")
    if not isinstance(tests, list) or len(tests) > 20:
        raise SharedLibraryError("invalid test references")
    tests = [_text(item, 240) for item in tests]
    if executable and (not SPDX_RE.fullmatch(licence) or not tests):
        raise SharedLibraryError("executable references require SPDX licence and passing tests")
    if not executable and (reference or licence or tests):
        raise SharedLibraryError("knowledge cannot claim executable evidence")
    record = {
        "schema": RECORD_SCHEMA, "id": match.string, "version": version, "kind": kind,
        "title": _text(value.get("title"), 120), "summary": _text(value.get("summary"), 1200),
        "tags": tags, "industry": _text(value.get("industry"), 100),
        "source": _source(value.get("source"), executable), "status": status,
        "sensitivity": "public", "verified_at": _date(value.get("verified_at"), "verified_at", status == "approved"),
        "expires_at": _date(value.get("expires_at"), "expires_at"), "reference": reference,
        "license_spdx": licence, "test_refs": tests,
    }
    if status == "approved":
        admission = value.get("admission")
        if not isinstance(admission, dict) or set(admission) != {"mode", "reviewed_by", "candidate_digest", "admitted_at"}:
            raise SharedLibraryError("missing admission receipt")
        record["admission"] = {
            "mode": _text(admission.get("mode"), 40), "reviewed_by": _text(admission.get("reviewed_by"), 100),
            "candidate_digest": _text(admission.get("candidate_digest"), 80),
            "admitted_at": _date(admission.get("admitted_at"), "admitted_at"),
        }
    return record


class CentralLibrary:
    def __init__(self, seed: Path = DEFAULT_SEED, root: Path = DEFAULT_ROOT, create: bool = False):
        self.seed, self.root = Path(seed), Path(root)
        self.approved, self.candidates = self.root / "approved", self.root / "candidates"
        if create:
            self.ensure_layout()

    def ensure_layout(self) -> None:
        """Create the runtime directory tree level by level, validating that no
        component is a symlink. Only write paths call this; health GETs never do."""
        root = self.root if self.root.is_absolute() else Path.cwd() / self.root
        current = Path(root.anchor or "/")
        for part in root.parts[len(Path(current.anchor or "/").parts):]:
            current = _child_directory(current, part)
        self.approved = _child_directory(current, "approved")
        self.candidates = _child_directory(current, "candidates")

    def _records(self) -> list[dict[str, Any]]:
        catalog = _read(self.seed, self.seed.parent)
        if set(catalog) != {"schema", "version", "records"} or catalog.get("schema") != CATALOG_SCHEMA or not isinstance(catalog.get("records"), list):
            raise SharedLibraryError("invalid seed catalog")
        records = [validate_record(item, "approved") for item in catalog["records"]]
        if self.approved.exists():
            for path in sorted(_directory(self.approved).iterdir()):
                if path.name.startswith("."):
                    continue
                if path.suffix != ".json":
                    raise SharedLibraryError("unexpected approved-library file")
                records.append(validate_record(_read(path, self.approved), "approved"))
        selected = {}
        for record in records:
            prior = selected.get(record["id"])
            if prior is None or record["version"] > prior["version"]:
                selected[record["id"]] = record
            elif record["version"] == prior["version"] and record != prior:
                raise SharedLibraryError("conflicting approved record")
        return list(selected.values())

    def health(self) -> dict[str, Any]:
        try:
            records = self._records()
            existing = self.root if self.root.exists() else self.root.parent
            writable = existing.is_dir() and not existing.is_symlink() and os.access(existing, os.W_OK | os.X_OK)
            return {"status": "ready" if writable else "read_only", "approved_count": len(records),
                    "candidate_queue_writable": writable, "provider": "frank-central-library"}
        except SharedLibraryError:
            return {"status": "unavailable", "approved_count": 0, "candidate_queue_writable": False,
                    "provider": "frank-central-library", "reason": "library data unavailable"}

    def search(self, project_id: str, query: str, limit: int = 6) -> list[dict[str, Any]]:
        _project(project_id)  # validates authority, never selects a global read path
        query_words = set(re.findall(r"[a-z0-9]+", str(query).lower()))
        ranked = []
        for record in self._records():
            if date.fromisoformat(record["expires_at"]) < date.today():
                continue
            words = set(re.findall(r"[a-z0-9]+", " ".join([record["title"], record["summary"], record["industry"], *record["tags"]]).lower()))
            score = len(query_words & words)
            if score or not query_words:
                ranked.append((score, record))
        ranked.sort(key=lambda item: (-item[0], item[1]["id"]))
        return [item[1] for item in ranked[:max(0, min(int(limit), 12))]]

    def bundle(self, project_id: str, query: str, limit: int = 6) -> dict[str, Any]:
        keys = ("id", "version", "kind", "title", "summary", "tags", "industry", "source",
                "expires_at", "reference", "license_spdx", "test_refs")
        return {"schema": BUNDLE_SCHEMA, "consumer_project": _project(project_id),
                "authority": "context_only_no_permissions",
                "records": [{key: row[key] for key in keys} for row in self.search(project_id, query, limit)]}

    def contribute(self, project_id: str, proposal: dict[str, Any]) -> dict[str, str]:
        project_id, record = _project(project_id), validate_record(proposal, "candidate")
        digest = "sha256:" + hashlib.sha256(_canonical(record)).hexdigest()
        candidate_id = "candidate_" + hashlib.sha256(_canonical({"project": project_id, "record": record})).hexdigest()[:32]
        envelope = {"schema": QUEUE_SCHEMA, "candidate_id": candidate_id, "candidate_digest": digest,
                    "origin_project": project_id, "record": record}
        project_root = _child_directory(self.candidates, project_id)
        target = project_root / f"{candidate_id}.json"
        _publish_atomically(target, json.dumps(envelope, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        return {"candidate_id": candidate_id, "candidate_digest": digest, "status": "queued_for_review"}

    def contribute_industry(self, project_id: str, value: dict[str, Any]) -> list[dict[str, str]]:
        industry, receipts = _text(value.get("industry"), 100), []
        for item in value.get("candidates") or []:
            if item.get("source_kind") != "public_source" or item.get("sensitivity") != "public_general":
                continue
            source = _source({"kind": "public_url", "reference": item.get("source_reference"), "revision": "", "sha256": ""}, False)
            fact = _text(item.get("fact"), 800)
            slug = hashlib.sha256(_canonical({"fact": fact, "source": source})).hexdigest()[:20]
            proposal = {"schema": RECORD_SCHEMA, "id": f"knowledge:frank/public-{slug}", "version": 1,
                        "kind": "knowledge", "title": fact[:120], "summary": fact,
                        "tags": ["industry-knowledge", re.sub(r"[^a-z0-9]+", "-", industry.lower()).strip("-")[:50]],
                        "industry": industry, "source": source, "status": "candidate", "sensitivity": "public",
                        "verified_at": "", "expires_at": _date(item.get("valid_until") or (date.today() + timedelta(days=365)).isoformat(), "valid_until"),
                        "reference": "", "license_spdx": "", "test_refs": []}
            try:
                receipts.append(self.contribute(project_id, proposal))
            except SharedLibraryError:
                continue  # one weak candidate must not block the rest of the batch
        return receipts

    def admit(self, project_id: str, candidate_id: str, digest: str, reviewed_by: str) -> dict[str, Any]:
        project_id = _project(project_id)
        if not CANDIDATE_RE.fullmatch(candidate_id) or not REVIEWER_RE.fullmatch(reviewed_by):
            raise SharedLibraryError("invalid candidate or reviewer")
        origin_root = _directory(self.candidates / project_id)
        envelope = _read(origin_root / f"{candidate_id}.json", origin_root)
        if any((envelope.get("schema") != QUEUE_SCHEMA, envelope.get("candidate_id") != candidate_id,
                envelope.get("candidate_digest") != digest, envelope.get("origin_project") != project_id)):
            raise SharedLibraryError("candidate receipt mismatch")
        record = validate_record(envelope.get("record"), "candidate")
        if "sha256:" + hashlib.sha256(_canonical(record)).hexdigest() != digest:
            raise SharedLibraryError("candidate content mismatch")
        if date.fromisoformat(record["expires_at"]) < date.today():
            raise SharedLibraryError("candidate record is expired")
        today = date.today().isoformat()
        approved = dict(record, status="approved", verified_at=today,
                        admission={"mode": "reviewed_public_evidence", "reviewed_by": reviewed_by,
                                   "candidate_digest": digest, "admitted_at": today})
        approved = validate_record(approved, "approved")
        target = self.approved / f"{hashlib.sha256(approved['id'].encode()).hexdigest()}.v{approved['version']}.json"
        _publish_atomically(target, json.dumps(approved, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        return approved


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Frank central shared library")
    parser.add_argument("--seed", type=Path, default=DEFAULT_SEED); parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    commands = parser.add_subparsers(dest="command", required=True); commands.add_parser("health")
    search = commands.add_parser("search"); search.add_argument("--project", required=True); search.add_argument("--query", default=""); search.add_argument("--limit", type=int, default=6)
    contribute = commands.add_parser("contribute"); contribute.add_argument("--project", required=True); contribute.add_argument("--file", type=Path, required=True)
    admit = commands.add_parser("admit"); admit.add_argument("--project", required=True); admit.add_argument("--candidate", required=True); admit.add_argument("--digest", required=True); admit.add_argument("--reviewed-by", required=True)
    args = parser.parse_args(argv)
    try:
        library = CentralLibrary(args.seed, args.root)
        if args.command == "health": result: object = library.health()
        elif args.command == "search": result = library.search(args.project, args.query, args.limit)
        elif args.command == "contribute": result = library.contribute(args.project, _read(args.file, args.file.parent))
        else: result = library.admit(args.project, args.candidate, args.digest, args.reviewed_by)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True)); return 0
    except SharedLibraryError as error:
        print(f"Frank shared library: {error}", file=sys.stderr); return 1


if __name__ == "__main__":
    raise SystemExit(main())
