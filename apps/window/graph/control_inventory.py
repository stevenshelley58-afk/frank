"""Closed, metadata-only inventory of Step 0 control-plane sources."""
from __future__ import annotations
import hashlib
import json
import os
import re
import subprocess
import time
import copy
import fnmatch
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping
try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

from .control_plane import _UniqueKeyLoader

KINDS = frozenset({"rule", "skill", "plugin", "cli", "mcp", "app", "template", "library", "hook", "ci_gate", "runtime_policy", "runbook"})
_SAFE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_ID = re.compile(r"^(vps|project|repo|runtime|service|component|worker|store|route|capability|rule|skill|tool|plugin|cli|mcp|app|template|library|hook|gate|policy|runbook|eval|observer|source|receipt|proposal|finding|run|container):[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")
_REVISION = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
_SECRET = re.compile(r"(?i)(authorization\s*:\s*bearer|bearer|password|passwd|token|secret|api[_-]?key|private[_-]?key|credentials?)\s*[:=]?\s*[^\s,;]+")
_HEADING = re.compile(r"^\s{0,3}#+\s*(.+?)\s*$")
_MAX_SOURCE_BYTES = 256 * 1024
_MAX_SCAN_FILES = 10_000
_MAX_SCAN_BYTES = 64 * 1024 * 1024
# The host collector bounds the whole invocation separately.  Keep this
# generous enough for a cold VPS filesystem while retaining a hard ceiling.
_MAX_SCAN_SECONDS = 60.0
# Directory expansion is deliberately bounded too.  A bounded list keeps the
# output deterministic (case-folded lexical order) without ever materialising
# an attacker-controlled directory in memory.
_MAX_DIRECTORY_ENTRIES = 10_000
_MAX_POLICY_BYTES = 512 * 1024
_DISPOSITIONS = frozenset({
    "excluded_evidence", "rejected", "redacted",
    "represented_by_platform_node", "observed-only/unclassified",
})
_ALIAS_STATUSES = frozenset({"unknown_after_bounded_search", "resolved", "candidate_only"})
_REQUIRED_COVERAGE_CLASSES = frozenset({"worker_queue", "backup_restore"})
_DEFAULT_EXCLUSIONS = {
    "excluded": {
        "cache": {"class": "cache", "disposition": "excluded_evidence"},
        "quarantine": {"class": "quarantine", "disposition": "excluded_evidence"},
        "symlink_escape": {"class": "symlink_escape", "disposition": "rejected"},
        "unknown_root": {"class": "unknown_root", "disposition": "rejected"},
        "full_instruction_body": {"class": "full_instruction_body", "disposition": "redacted"},
    },
    "observed_only": [],
    "unresolved_aliases": [],
    "coverage_dispositions": [],
    "findings": [],
}

class InventoryError(ValueError):
    """A source is outside the closed inventory boundary."""


class _ScanFinding(Exception):
    """A bounded traversal stopped with a typed, receipt-safe finding."""

    def __init__(self, kind: str, identity: str, **details):
        super().__init__(kind)
        self.kind = kind
        self.identity = identity
        self.details = details

@dataclass(frozen=True)
class SourceAdapter:
    adapter_id: str
    root: Path
    kind: str
    patterns: tuple[str, ...] = ("**/*",)
    authority_tier: str = "scoped"
    evidence_receipt_id: str = "receipt:skills/census-20260830-001"
    canonical_root: str | None = None
    enforcement: str = "documentation"
    scope_ids: tuple[str, ...] = ("project:frank",)
    source_revision: str = ""
    revision_source: str = "git_head"
    # There is no safe default: a source adapter is a new control-plane
    # component and must point at the reviewed Step 1 OSS decision that
    # justified it (or the adopted upstream implementation).
    oss_decision_id: str | None = None
    # The accepted Step 1 contract is required provenance for declarations;
    # direct test fixtures may omit it, but repository declarations may not.
    step1_receipt_id: str | None = None
    def __post_init__(self):
        # Step 0 paths are Linux canonical paths even when tests run on Windows.
        if self.kind not in KINDS or not _SAFE.fullmatch(self.adapter_id):
            raise InventoryError("invalid source adapter")
        if self.authority_tier not in {"global", "repo", "scoped", "runtime"}:
            raise InventoryError("invalid authority tier")
        if not self.scope_ids or any(not isinstance(scope, str) or not _ID.fullmatch(scope) for scope in self.scope_ids):
            raise InventoryError("source adapter requires canonical scope IDs")
        if not isinstance(self.evidence_receipt_id, str) or not re.fullmatch(r"receipt:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*", self.evidence_receipt_id):
            raise InventoryError("source adapter requires an evidence receipt")
        if self.enforcement not in {"skill_trigger", "ci", "deploy", "runtime", "hook", "documentation"}:
            raise InventoryError("invalid enforcement")
        if self.revision_source not in {"git_head", "external_pin"}:
            raise InventoryError("invalid revision source")
        if self.revision_source == "external_pin" and not _REVISION.fullmatch(self.source_revision):
            raise InventoryError("external source adapter requires an exact pin")
        if self.revision_source == "git_head" and self.source_revision not in {"", "git_head"} and not _REVISION.fullmatch(self.source_revision):
            raise InventoryError("Git source adapter requires git_head or an exact fallback revision")
        if not isinstance(self.oss_decision_id, str) or not re.fullmatch(r"receipt:oss-decision/[a-z0-9]+(?:-[a-z0-9]+)*", self.oss_decision_id):
            raise InventoryError("source adapter requires a valid OSS decision receipt")
        if self.step1_receipt_id is not None and not re.fullmatch(r"receipt:contract/step-1-[0-9]{8}-[0-9]{3}", self.step1_receipt_id):
            raise InventoryError("source adapter requires a valid Step 1 contract receipt")
        if not self.patterns or any(
            not isinstance(pattern, str)
            or not pattern
            or pattern.startswith("/")
            or ".." in Path(pattern).parts
            for pattern in self.patterns
        ):
            raise InventoryError("source patterns must be relative and non-empty")
    @property
    def scan_root(self) -> Path:
        return self.root

class AllowlistedSourceMatrix:
    def __init__(self, adapters: Iterable[SourceAdapter], *, exclusions: Mapping | None = None):
        self.adapters = tuple(adapters)
        if not self.adapters: raise InventoryError("empty source-adapter matrix")
        ids = [adapter.adapter_id for adapter in self.adapters]
        if len(ids) != len(set(ids)):
            raise InventoryError("duplicate source adapter id")
        self.exclusions = dict(exclusions or _DEFAULT_EXCLUSIONS)

    @staticmethod
    def _finding(kind: str, identity: str, **details) -> dict:
        digest = hashlib.sha256(canonical_inventory({"kind": kind, "identity": identity, **details})).hexdigest()[:24]
        return {"id": f"finding:inventory/{kind}-{digest}", "type": kind, "identity": identity,
                "status": kind, **details}
    def _matches(self, path, adapter):
        root, candidate = adapter.root.resolve(strict=False), path.resolve(strict=False)
        if root == candidate or root not in candidate.parents: return False
        relative = candidate.relative_to(root).as_posix()
        if any(p.casefold() in {"cache", "caches", "quarantine", "quarantined"} for p in Path(relative).parts): return False
        return any(Path(relative).match(pattern) for pattern in adapter.patterns)
    def adapter_for(self, path: Path) -> SourceAdapter:
        if not path.is_absolute() or any(p == ".." for p in path.parts) or path.is_symlink() or not path.is_file():
            raise InventoryError("source must be an absolute regular non-symlink file")
        matches = [a for a in self.adapters if self._matches(path, a)]
        if not matches: raise InventoryError("source is not allowlisted")
        # Pattern specificity is based on literal relative segments; ties fail closed.
        relative = path.resolve().relative_to(matches[0].root.resolve()).as_posix()
        def score(adapter):
            matching = [p for p in adapter.patterns if Path(relative).match(p)]
            return max((sum(1 for part in p.split("/") if part not in {"*", "**"}) for p in matching), default=-1)
        scores = [score(a) for a in matches]
        top = max(scores); winners = [a for a, score in zip(matches, scores) if score == top]
        if len(winners) != 1: raise InventoryError("source matches overlapping adapters")
        return winners[0]
    def _candidate_paths(self, root: Path, pattern: str, *, deadline_at: float):
        """Expand only declared path segments, pruning caches before descent."""
        parts = Path(pattern).parts
        excluded = {".git", "node_modules", "cache", "caches", "quarantine", "quarantined"}

        def entries(base: Path):
            # Avoid sorting an unbounded directory iterator: a compromised
            # root could otherwise force an unbounded listing into memory.
            collected = []
            try:
                with os.scandir(base) as iterator:
                    for index, entry in enumerate(iterator):
                        if time.monotonic() > deadline_at:
                            raise TimeoutError("inventory scan deadline exceeded")
                        if index >= _MAX_DIRECTORY_ENTRIES:
                            raise _ScanFinding(
                                "scan_directory_limit_exceeded", str(base),
                                directory=str(base), limit=_MAX_DIRECTORY_ENTRIES,
                            )
                        collected.append(entry)
            except _ScanFinding:
                raise
            except (OSError, ValueError) as exc:
                raise _ScanFinding(
                    "inaccessible_directory", str(base),
                    directory=str(base), reason=type(exc).__name__,
                ) from exc
            return sorted(collected, key=lambda entry: entry.name.casefold())

        def descend(base: Path, index: int):
            if time.monotonic() > deadline_at:
                raise TimeoutError("inventory scan deadline exceeded")
            if index == len(parts):
                yield base
                return
            part = parts[index]
            if part == "**":
                yield from descend(base, index + 1)
                for entry in entries(base):
                    try:
                        is_symlink = entry.is_symlink()
                    except OSError as exc:
                        raise _ScanFinding(
                            "inaccessible_directory", str(base),
                            directory=str(base), reason=type(exc).__name__,
                        ) from exc
                    if entry.name.casefold() in excluded or is_symlink:
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            yield from descend(Path(entry.path), index)
                    except (OSError, ValueError) as exc:
                        raise _ScanFinding(
                            "inaccessible_directory", str(entry.path),
                            directory=str(entry.path), reason=type(exc).__name__,
                        ) from exc
                return
            has_magic = any(char in part for char in "*?[")
            if not has_magic:
                child = base / part
                try:
                    if child.exists() and not child.is_symlink():
                        yield from descend(child, index + 1)
                except (OSError, ValueError) as exc:
                    raise _ScanFinding(
                        "inaccessible_path", str(child),
                        path=str(child), reason=type(exc).__name__,
                    ) from exc
                return
            for entry in entries(base):
                try:
                    is_symlink = entry.is_symlink()
                except OSError as exc:
                    raise _ScanFinding(
                        "inaccessible_directory", str(base),
                        directory=str(base), reason=type(exc).__name__,
                    ) from exc
                if not fnmatch.fnmatchcase(entry.name, part) or is_symlink:
                    continue
                try:
                    yield from descend(Path(entry.path), index + 1)
                except (OSError, ValueError) as exc:
                    raise _ScanFinding(
                        "inaccessible_path", str(entry.path),
                        path=str(entry.path), reason=type(exc).__name__,
                    ) from exc

        # Keep expansion lazy.  Some allowlisted patterns contain ``**`` and
        # must remain bounded even when a root unexpectedly grows very large.
        return descend(root, 0)

    def scan(self, *, max_files: int = _MAX_SCAN_FILES, max_bytes: int = _MAX_SCAN_BYTES,
             deadline_seconds: float = _MAX_SCAN_SECONDS):
        if max_files < 1 or max_bytes < 1 or deadline_seconds <= 0:
            raise InventoryError("inventory scan bounds must be positive")
        started = time.monotonic()
        deadline_at = started + deadline_seconds
        found, findings, seen, total_bytes = [], [], set(), 0
        # Keep the declared path intact until the symlink check.  Resolving it
        # first would turn a symlink escape into a trusted root.
        roots = sorted({a.root for a in self.adapters}, key=lambda path: str(path))
        for declared_root in roots:
            matching = [a for a in self.adapters if a.root == declared_root]
            try:
                if declared_root.is_symlink():
                    findings.append(self._finding(
                        "inaccessible_root", str(declared_root), root=str(declared_root),
                        adapter_ids=sorted(a.adapter_id for a in matching), reason="symlink",
                    ))
                    continue
                if not declared_root.exists():
                    findings.append(self._finding(
                        "missing_root", str(declared_root), root=str(declared_root),
                        adapter_ids=sorted(a.adapter_id for a in matching),
                    ))
                    continue
                root = declared_root.resolve(strict=True)
            except (OSError, RuntimeError, ValueError) as exc:
                findings.append(self._finding(
                    "inaccessible_root", str(declared_root), root=str(declared_root),
                    adapter_ids=sorted(a.adapter_id for a in matching), reason=type(exc).__name__,
                ))
                continue
            if not root.is_dir():
                findings.append(self._finding("inaccessible_root", str(declared_root), root=str(declared_root), reason="not a directory"))
                continue
            for adapter in matching:
                for pattern in adapter.patterns:
                    if time.monotonic() - started > deadline_seconds:
                        findings.append(self._finding("scan_deadline_exceeded", adapter.adapter_id, adapter_id=adapter.adapter_id))
                        break
                    candidate_paths = self._candidate_paths(root, pattern, deadline_at=deadline_at)
                    try:
                        for path in candidate_paths:
                            if len(found) >= max_files:
                                findings.append(self._finding("scan_file_limit_exceeded", adapter.adapter_id, adapter_id=adapter.adapter_id, limit=max_files))
                                break
                            # Check the declared path before resolving it, then
                            # revalidate the resolved target stays under the
                            # fixed root.  This catches parent replacement and
                            # symlink escapes as typed findings.
                            if path.is_symlink():
                                continue
                            resolved = path.resolve(strict=True)
                            if resolved == root or root not in resolved.parents:
                                raise _ScanFinding(
                                    "symlink_escape", str(path), path=str(path), root=str(declared_root),
                                )
                            if not resolved.is_file():
                                continue
                            key = (str(resolved), adapter.adapter_id)
                            if key in seen:
                                continue
                            size = resolved.stat().st_size
                            if size > _MAX_SOURCE_BYTES:
                                findings.append(self._finding("source_too_large", str(path), path=str(path), bytes=size))
                                continue
                            if total_bytes + size > max_bytes:
                                findings.append(self._finding("scan_byte_limit_exceeded", adapter.adapter_id, adapter_id=adapter.adapter_id, limit=max_bytes))
                                break
                            seen.add(key)
                            found.append((path, adapter, size))
                            total_bytes += size
                    except TimeoutError:
                        findings.append(self._finding("scan_deadline_exceeded", adapter.adapter_id, adapter_id=adapter.adapter_id))
                    except _ScanFinding as exc:
                        findings.append(self._finding(exc.kind, exc.identity, **exc.details))
                    except (OSError, RuntimeError, ValueError) as exc:
                        findings.append(self._finding("inaccessible_source", str(declared_root), path=str(declared_root), reason=type(exc).__name__))
                    if findings and findings[-1].get("type") in {"scan_deadline_exceeded", "scan_file_limit_exceeded", "scan_byte_limit_exceeded"}:
                        break
        return found, findings

    def files(self, **limits):
        return [(path, adapter) for path, adapter, _size in self.scan(**limits)[0]]

def _slug(value):
    value = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-") or "source"
    return value if _SAFE.fullmatch(value) else "source"
def _safe_text(value, fallback):
    value = _SECRET.sub(r"\1=[REDACTED]", value)
    value = re.sub(r"[\x00-\x1f\x7f]", " ", value).strip()
    return (fallback if _SECRET.search(value) else (value or fallback))[:160]
def _metadata(text, path):
    heading = next((m.group(1) for line in text.splitlines() if (m := _HEADING.match(line))), path.stem.replace("_", " ").title())
    title = _safe_text(heading, "Untitled source")
    return title, _safe_text(f"Metadata reference for {title}; source body is not persisted.", "Metadata source reference.")


def _stable_identity(value: object) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise InventoryError("observed-only identity must be a canonical stable ID")
    return value


def load_exclusions(path: Path) -> dict:
    """Load the closed exclusion vocabulary without accepting free-form policy."""
    if yaml is None:
        raise InventoryError("YAML support unavailable")
    try:
        data = yaml.load(_bounded_regular_read(path, max_bytes=_MAX_POLICY_BYTES).decode("utf-8"), Loader=_UniqueKeyLoader)
    except (OSError, ValueError, UnicodeError, yaml.YAMLError, InventoryError) as exc:
        raise InventoryError("inventory exclusions are unavailable") from exc
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise InventoryError("unsupported inventory exclusions schema")
    excluded = {}
    raw_excluded = data.get("excluded", [])
    if not isinstance(raw_excluded, list):
        raise InventoryError("excluded inventory classes must be a list")
    for item in raw_excluded:
        if not isinstance(item, dict) or not isinstance(item.get("class"), str) or item.get("disposition") not in _DISPOSITIONS:
            raise InventoryError("inventory exclusion has an unrecognized disposition")
        key = item["class"]
        if not re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", key) or key in excluded:
            raise InventoryError("inventory exclusion class is invalid or duplicated")
        excluded[key] = {str(k): copy.deepcopy(v) for k, v in item.items()}
    observed = []
    raw_observed = data.get("observed_only", [])
    if not isinstance(raw_observed, list):
        raise InventoryError("observed-only inventory entries must be a list")
    for item in raw_observed:
        if not isinstance(item, dict):
            raise InventoryError("observed-only inventory entry must be a mapping")
        identity = _stable_identity(item.get("identity"))
        if item.get("disposition") != "observed-only/unclassified":
            raise InventoryError("observed-only entries must use observed-only/unclassified")
        observed.append({str(k): copy.deepcopy(v) for k, v in item.items()})
    observed.sort(key=lambda item: item["identity"])
    if len({item["identity"] for item in observed}) != len(observed):
        raise InventoryError("duplicate observed-only identity")
    aliases = []
    raw_aliases = data.get("unresolved_aliases", [])
    if not isinstance(raw_aliases, list):
        raise InventoryError("unresolved aliases must be a list")
    for item in raw_aliases:
        if (not isinstance(item, dict) or not _SAFE.fullmatch(str(item.get("name", "")))
                or item.get("status") not in _ALIAS_STATUSES):
            raise InventoryError("invalid unresolved alias")
        aliases.append({"name": item["name"], "status": item["status"]})
    aliases.sort(key=lambda item: item["name"])
    if len({item["name"] for item in aliases}) != len(aliases):
        raise InventoryError("duplicate unresolved alias")
    coverage = []
    for item in data.get("coverage_dispositions", []):
        if (not isinstance(item, dict)
                or item.get("class") not in _REQUIRED_COVERAGE_CLASSES
                or item.get("disposition") != "unavailable"
                or item.get("status") != "not_present"
                or not _ID.fullmatch(str(item.get("finding_id", "")))
                or not isinstance(item.get("subject_ids"), list)
                or not item["subject_ids"]
                or any(not _ID.fullmatch(str(value)) for value in item["subject_ids"])
                or not isinstance(item.get("evidence_receipt_ids"), list)
                or not item["evidence_receipt_ids"]
                or any(not _ID.fullmatch(str(value)) for value in item["evidence_receipt_ids"])):
            raise InventoryError("invalid required coverage disposition")
        coverage.append(copy.deepcopy(item))
    coverage.sort(key=lambda item: item["class"])
    if {item["class"] for item in coverage} != _REQUIRED_COVERAGE_CLASSES:
        raise InventoryError("required VPS coverage dispositions are incomplete")

    findings = []
    for item in data.get("findings", []):
        if (not isinstance(item, dict)
                or not _ID.fullmatch(str(item.get("id", "")))
                or item.get("status") != "candidate"
                or item.get("reconciliation_result") != "inaccessible"
                or item.get("confidence") != "none"
                or not isinstance(item.get("evidence_receipt_ids"), list)
                or any(not _ID.fullmatch(str(value)) for value in item["evidence_receipt_ids"])):
            raise InventoryError("invalid required coverage finding")
        findings.append(copy.deepcopy(item))
    findings.sort(key=lambda item: item["id"])
    if {item["id"] for item in findings} != {item["finding_id"] for item in coverage}:
        raise InventoryError("coverage findings do not match their dispositions")
    return {"excluded": excluded, "observed_only": observed, "unresolved_aliases": aliases,
            "coverage_dispositions": coverage, "findings": findings}


def copy_exclusions(value: Mapping | None) -> dict:
    """Return a stable, detached exclusion payload for receipts."""
    payload = value or _DEFAULT_EXCLUSIONS
    return copy.deepcopy(payload)


def _bounded_regular_read(path: Path, *, root: Path | None = None, max_bytes: int = _MAX_SOURCE_BYTES) -> bytes:
    """Read one regular file with a hard cap and TOCTOU/containment checks."""
    if not path.is_absolute() or path.is_symlink():
        raise InventoryError("source must be an absolute regular non-symlink file")
    try:
        before_path = path.resolve(strict=True)
        if root is not None:
            fixed_root = root.resolve(strict=True)
            if before_path == fixed_root or fixed_root not in before_path.parents:
                raise InventoryError("source is outside its fixed root")
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(str(path), flags)
    except (OSError, RuntimeError, ValueError) as exc:
        raise InventoryError("source is inaccessible") from exc
    try:
        initial = os.fstat(fd)
        if not stat.S_ISREG(initial.st_mode):
            raise InventoryError("source is not a regular file")
        chunks = []
        remaining = max_bytes + 1
        while remaining:
            chunk = os.read(fd, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        final = os.fstat(fd)
        if len(raw) > max_bytes or initial.st_size != final.st_size or initial.st_size != len(raw):
            raise InventoryError("source changed or exceeds bounded metadata input size")
        if (initial.st_dev, initial.st_ino) != (final.st_dev, final.st_ino):
            raise InventoryError("source changed during bounded read")
    except OSError as exc:
        raise InventoryError("source read failed") from exc
    finally:
        os.close(fd)
    try:
        if path.is_symlink():
            raise InventoryError("source became a symlink")
        after_path = path.resolve(strict=True)
        if after_path != before_path:
            raise InventoryError("source changed during bounded read")
        if root is not None:
            fixed_root = root.resolve(strict=True)
            if after_path == fixed_root or fixed_root not in after_path.parents:
                raise InventoryError("source escaped its fixed root")
    except (OSError, RuntimeError, ValueError) as exc:
        raise InventoryError("source containment validation failed") from exc
    return raw

def extract_record(path: Path, adapter: SourceAdapter, *, source_revision: str | None = None, scope_ids=None):
    source_revision = source_revision or adapter.source_revision
    if not _REVISION.fullmatch(source_revision): raise InventoryError("accepted inventory requires an exact Git revision")
    raw = _bounded_regular_read(path, root=adapter.root)
    # Only inspect a bounded prefix; the complete body is hashed but never persisted.
    metadata_text = raw[:16 * 1024].decode("utf-8", errors="replace")
    title, explanation = _metadata(metadata_text, path)
    relative = path.resolve().relative_to(adapter.root.resolve()).as_posix()
    path_key = "/".join(_slug(p) for p in relative.split("/"))
    digest = hashlib.sha256(relative.encode()).hexdigest()[:12]
    kind = {"ci_gate": "gate", "runtime_policy": "policy"}.get(adapter.kind, adapter.kind)
    identity = f"{kind}:frank/{adapter.adapter_id}/{path_key}-{digest}"
    if not _ID.fullmatch(identity): raise InventoryError("generated stable ID violates catalog grammar")
    scopes = tuple(scope_ids or adapter.scope_ids)
    locator_root = adapter.canonical_root or str(adapter.root)
    locator = locator_root.rstrip("/") + "/" + relative
    receipt_ids = [adapter.evidence_receipt_id]
    if adapter.step1_receipt_id and adapter.step1_receipt_id not in receipt_ids:
        receipt_ids.append(adapter.step1_receipt_id)
    return {"id": identity, "kind": adapter.kind, "title": title, "eli5": explanation, "why_it_exists": "Provides a bounded, evidence-backed source reference.", "benefits": ["stable metadata", "scoped access"], "tradeoffs": ["body is not persisted"], "applies_when": ["source is selected by the allowlist"], "does_not_apply_when": ["cache or quarantine evidence"], "scope_ids": list(scopes), "source_locator": locator, "source_revision": source_revision, "content_hash": "sha256:" + hashlib.sha256(raw).hexdigest(), "authority_tier": adapter.authority_tier, "enforcement": adapter.enforcement, "state_axes": {"lifecycle": "approved", "trust": "reviewed", "installation": "installed", "enablement": "disabled", "production_authority": "read_only"}, "retirement_assessment": "Candidate only; retire after usage evidence and a named replacement.", "replacement_ids": [], "consolidation_group": None, "evidence_receipt_ids": receipt_ids, "oss_decision_id": adapter.oss_decision_id}


def _external_pin_verified(adapter: SourceAdapter) -> bool:
    """Accept a vendor pin only when the fixed root proves that exact commit.

    An arbitrary 40/64-character declaration is not provenance.  The only
    source of truth available to the collector is the immutable checkout's
    Git object database, and the checkout HEAD must equal the declared pin.
    """
    if adapter.revision_source != "external_pin":
        return False
    expected = adapter.source_revision.lower()
    if _git_head(adapter.root) == expected:
        return True
    # Archify and AgentTrail are pinned Git submodules inside Frank.  Their
    # authoritative revision is the superproject gitlink, not Frank's HEAD.
    gitlinks = {
        "frank-archify-cli": "apps/window/vendor/archify",
        "frank-archify-skill": "apps/window/vendor/archify",
        "frank-agenttrail": "apps/window/vendor/agenttrail",
    }
    relative = gitlinks.get(adapter.adapter_id)
    if relative is None or adapter.canonical_root != "/projects/frank":
        return False
    try:
        result = subprocess.run(
            ("git", "-C", str(adapter.root), "ls-tree", "HEAD", "--", relative),
            capture_output=True, text=True, timeout=2, check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    match = re.fullmatch(rf"160000 commit ([0-9a-f]{{40}})\t{re.escape(relative)}\n?", result.stdout)
    return bool(match and match.group(1) == expected)


def _candidate_state(record: dict) -> dict:
    candidate = copy.deepcopy(record)
    candidate["state_axes"] = {
        "lifecycle": "draft",
        "trust": "unreviewed",
        "installation": "not_installed",
        "enablement": "disabled",
        "production_authority": "none",
    }
    return candidate

def inventory(
    matrix,
    *,
    source_revision: str | None = None,
    source_revisions: Mapping[str, str] | None = None,
    prior_audit_counts: Mapping[str, int] | None = None,
    require_clean: bool = False,
):
    overrides = dict(source_revisions or {})
    unknown = set(overrides) - {adapter.adapter_id for adapter in matrix.adapters}
    if unknown:
        raise InventoryError(f"source revision overrides contain unknown adapters: {sorted(unknown)}")
    invalid_overrides = [key for key, value in overrides.items()
                         if not isinstance(value, str) or not _REVISION.fullmatch(value)]
    if invalid_overrides:
        raise InventoryError(f"source revision overrides are not exact revisions: {sorted(invalid_overrides)}")
    candidates, findings = matrix.scan()
    effective_revisions = {}
    for adapter in matrix.adapters:
        if adapter.revision_source == "git_head":
            head = _git_head(adapter.root)
            if head:
                effective_revisions[adapter.adapter_id] = head
            elif overrides.get(adapter.adapter_id) and _REVISION.fullmatch(overrides[adapter.adapter_id]):
                effective_revisions[adapter.adapter_id] = overrides[adapter.adapter_id].lower()
            elif source_revision and _REVISION.fullmatch(source_revision):
                effective_revisions[adapter.adapter_id] = source_revision.lower()
            elif adapter.source_revision and _REVISION.fullmatch(adapter.source_revision):
                effective_revisions[adapter.adapter_id] = adapter.source_revision.lower()
            else:
                findings.append(AllowlistedSourceMatrix._finding(
                    "unavailable_revision", adapter.adapter_id, adapter_id=adapter.adapter_id,
                    revision_source="git_head", root=str(adapter.root)))
        else:
            # External pins are immutable declarations.  A checkout HEAD must
            # never overwrite one; absent vendor provenance is explicit.
            effective_revisions[adapter.adapter_id] = adapter.source_revision.lower()
            requested = overrides.get(adapter.adapter_id)
            if requested and requested.lower() != adapter.source_revision.lower():
                findings.append(AllowlistedSourceMatrix._finding(
                    "external_pin_override_ignored", adapter.adapter_id,
                    adapter_id=adapter.adapter_id, declared_revision=adapter.source_revision))
            if not _external_pin_verified(adapter):
                findings.append(AllowlistedSourceMatrix._finding(
                    "unverified_external_pin", adapter.adapter_id, adapter_id=adapter.adapter_id,
                    source_revision=adapter.source_revision, evidence_receipt_id=adapter.evidence_receipt_id))
    records = []
    candidate_adapter_ids = set()
    # A finding is scoped to its adapter wherever possible.  Root findings
    # carry adapter_ids because several declarations can share a fixed root.
    for finding in findings:
        adapter_id = finding.get("adapter_id")
        if adapter_id:
            candidate_adapter_ids.add(adapter_id)
        candidate_adapter_ids.update(finding.get("adapter_ids", ()))
    dirty_root_set = set(dirty_roots := sorted({str(adapter.root) for adapter in matrix.adapters if _git_is_dirty(adapter.root)}))
    candidate_adapter_ids.update(
        adapter.adapter_id for adapter in matrix.adapters
        if str(adapter.root) in dirty_root_set
    )
    for path, adapter, _size in candidates:
        revision = adapter.source_revision if adapter.revision_source == "external_pin" else effective_revisions.get(adapter.adapter_id)
        if not revision or not _REVISION.fullmatch(revision):
            continue
        try:
            record = extract_record(path, adapter, source_revision=revision)
            is_candidate = (
                adapter.adapter_id in candidate_adapter_ids
                or (adapter.revision_source == "external_pin" and not _external_pin_verified(adapter))
            )
            records.append(_candidate_state(record) if is_candidate else record)
        except (OSError, InventoryError) as exc:
            findings.append(AllowlistedSourceMatrix._finding(
                "inaccessible_source", str(path), path=str(path), adapter_id=adapter.adapter_id,
                reason=type(exc).__name__))
    records.sort(key=lambda record: record["id"])
    if len({r["id"] for r in records}) != len(records): raise InventoryError("duplicate capability identity")
    candidate_records = [record for record in records if record["state_axes"]["trust"] != "reviewed"]
    accepted_records = [record for record in records if record["state_axes"]["trust"] == "reviewed"]
    accepted_counts = {kind: sum(r["kind"] == kind for r in accepted_records) for kind in sorted(KINDS)}
    candidate_counts = {kind: sum(r["kind"] == kind for r in candidate_records) for kind in sorted(KINDS)}
    if require_clean and dirty_roots:
        raise InventoryError("accepted inventory requires clean Git roots")
    all_findings = {finding["id"]: finding for finding in findings}
    status = "accepted" if not dirty_roots and not all_findings else "candidate_only"
    exclusions = copy_exclusions(matrix.exclusions)
    aliases = {n: "unknown_after_bounded_search" for n in ("grill", "grill-me", "grilling")}
    aliases.update({item["name"]: item["status"] for item in exclusions.get("unresolved_aliases", [])})
    revision_provenance = {
        adapter.adapter_id: {"source_revision": effective_revisions.get(adapter.adapter_id, adapter.source_revision),
                             "revision_source": adapter.revision_source,
                             "evidence_receipt_id": adapter.evidence_receipt_id}
        for adapter in matrix.adapters
    }
    return {"schema_version": 1, "status": status, "dirty_roots": dirty_roots,
            # ``records`` remains the complete bounded observation for audit
            # visibility.  Only accepted_records may be materialized.
            "records": records, "accepted_records": accepted_records,
            "candidate_records": candidate_records,
            "counts": accepted_counts, "accepted_counts": accepted_counts,
            "candidate_counts": candidate_counts,
            "record_count": len(records), "accepted_record_count": len(accepted_records),
            "prior_audit_counts_candidates": dict(prior_audit_counts or {}),
            "findings": sorted(all_findings.values(), key=lambda item: item["id"]),
            "aliases": aliases, "exclusions": exclusions,
            "revision_provenance": revision_provenance}


def _git_head(root: Path) -> str | None:
    if not (root / ".git").exists():
        return None
    try:
        result = subprocess.run(("git", "-C", str(root), "rev-parse", "HEAD"), capture_output=True, text=True, timeout=2, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    head = result.stdout.strip().lower()
    return head if _REVISION.fullmatch(head) else None


def _git_is_dirty(root: Path) -> bool:
    if _git_head(root) is None:
        return False
    try:
        result = subprocess.run(("git", "-C", str(root), "status", "--porcelain", "--untracked-files=all"), capture_output=True, text=True, timeout=2, check=True)
    except (OSError, subprocess.SubprocessError):
        return True
    return bool(result.stdout.strip())

def matrix_from_declarations(declaration_path: Path, repository_root: Path, fixed_roots: Mapping[str, Path] | None = None):
    if yaml is None: raise InventoryError("YAML support unavailable")
    try:
        data = yaml.load(_bounded_regular_read(declaration_path, max_bytes=_MAX_POLICY_BYTES).decode("utf-8"), Loader=_UniqueKeyLoader)
    except (OSError, ValueError, UnicodeError, yaml.YAMLError, InventoryError) as exc:
        raise InventoryError("source declarations are unavailable") from exc
    if not isinstance(data, dict) or data.get("closed_world") is not True: raise InventoryError("source declarations are not closed-world")
    adapters = []
    fixed = {"/projects/frank": Path(repository_root), "/home/hermes/.hermes/skills": Path("/home/hermes/.hermes/skills"), "/projects/blockwise-product-release-21a192cd2420": Path("/projects/blockwise-product-release-21a192cd2420"), "/root/.claude": Path("/root/.claude"), "/root/.codex": Path("/root/.codex")}
    if fixed_roots is not None:
        if set(fixed_roots) - set(fixed): raise InventoryError("fixed root mapping contains undeclared canonical root")
        for canonical, value in fixed_roots.items():
            candidate = Path(value)
            # Reject before resolve so a symlink cannot smuggle an external
            # tree into the fixed-root map.
            try:
                if candidate.is_symlink():
                    raise InventoryError(f"fixed root {canonical} is a symlink")
            except OSError as exc:
                raise InventoryError(f"fixed root {canonical} is inaccessible") from exc
            fixed[canonical] = candidate
    for item in data.get("adapters", []):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise InventoryError("each adapter must be a mapping with an id")
        required = {"id", "root", "classes", "patterns", "authority_tier", "enforcement", "scope_ids", "source_revision", "evidence_receipt_id", "oss_decision_id", "step1_receipt_id"}
        if not required.issubset(item) or not isinstance(item.get("classes"), (list, tuple)) or not isinstance(item.get("scope_ids"), (list, tuple)):
            raise InventoryError(f"adapter {item.get('id')} is missing typed fields")
        root_text = item.get("root", "")
        if not isinstance(root_text, str) or not (root_text.startswith("/") or Path(root_text).is_absolute()):
            raise InventoryError("declared adapter root must be absolute")
        if root_text not in fixed: raise InventoryError("declared root is not in fixed Step 0 mapping")
        root = fixed[root_text]
        patterns = tuple(item.get("patterns", ()))
        if not patterns or any(not isinstance(p, str) or p.startswith("/") or ".." in Path(p).parts for p in patterns): raise InventoryError("source patterns must be relative")
        kind = next((c for c in item.get("classes", ()) if c in KINDS), None)
        if kind is None: raise InventoryError(f"adapter {item.get('id')} lacks an inventory kind")
        # A syntactically valid receipt is not enough: the referenced Step 1
        # decision must be present in the versioned OSS register.  This keeps
        # declarations fail-closed when a typo or an invented receipt is
        # introduced.
        oss_decision_id = item["oss_decision_id"]
        decision_slug = oss_decision_id.removeprefix("receipt:oss-decision/") if isinstance(oss_decision_id, str) else ""
        decision_path = repository_root / "governance" / "control-plane" / "decisions" / "oss" / f"{decision_slug}.yaml"
        if not _SAFE.fullmatch(decision_slug) or decision_path.is_symlink() or not decision_path.is_file():
            raise InventoryError(f"adapter {item['id']} references an unavailable OSS decision")
        source_revision = str(item.get("source_revision", ""))
        revision_source = str(item.get("revision_source", "git_head"))
        if revision_source == "git_head":
            # ``git_head`` is a live selector.  Pinning it to the commit that
            # edits this declaration would make every release self-invalid.
            if source_revision not in {"", "git_head"} and not _REVISION.fullmatch(source_revision):
                raise InventoryError(f"adapter {item.get('id')} has an invalid Git revision selector")
        elif revision_source == "external_pin":
            if not _REVISION.fullmatch(source_revision):
                raise InventoryError(f"adapter {item.get('id')} lacks an exact external pin")
        else:
            raise InventoryError(f"adapter {item.get('id')} has an invalid revision source")
        if not _SAFE.fullmatch(item["id"]):
            raise InventoryError(f"adapter {item['id']} has an invalid id")
        adapters.append(SourceAdapter(item["id"], root, kind, patterns, item.get("authority_tier", "scoped"), item["evidence_receipt_id"], root_text, item.get("enforcement", "documentation"), tuple(item.get("scope_ids", ("project:frank",))), source_revision, revision_source, oss_decision_id, item["step1_receipt_id"]))
    exclusions_path = declaration_path.with_name("inventory-exclusions.yaml")
    exclusions = load_exclusions(exclusions_path) if exclusions_path.exists() else _DEFAULT_EXCLUSIONS
    return AllowlistedSourceMatrix(adapters, exclusions=exclusions)

def canonical_inventory(value: Mapping) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
