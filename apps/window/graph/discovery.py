"""Bounded, metadata-only discovery for Step 7B.

Discovery is deliberately not an installer.  Adapters return small metadata
snapshots, and normalisation turns them into candidate records suitable for
Control.  No source repository contents are fetched or persisted.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Iterable, Mapping, Sequence

from .control_plane import canonical_bytes

_ALLOWED_HOSTS = frozenset({
    "api.github.com", "github.com", "registry.modelcontextprotocol.io",
    "deps.dev", "api.deps.dev", "scorecard.dev", "api.scorecard.dev",
    "osv.dev", "api.osv.dev", "hermes-agent.nousresearch.com",
})
_REVISION = re.compile(r"^(?:[0-9a-f]{7,64}|v?[0-9]+(?:\.[0-9]+){1,3}[-+0-9A-Za-z.-]*)$")


class DiscoveryError(ValueError):
    """Fail-closed discovery input or provider error."""


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_source_url(url: str, allowlist: Iterable[str] = _ALLOWED_HOSTS) -> str:
    """Return a canonical URL, rejecting credentials, query tricks and hosts."""
    if not isinstance(url, str) or len(url) > 2048:
        raise DiscoveryError("source URL is invalid")
    parsed = urllib.parse.urlsplit(url)
    allowed = frozenset(allowlist)
    if parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username or parsed.password:
        raise DiscoveryError("source URL is outside the discovery allowlist")
    try:
        if parsed.port not in (None, 443):
            raise DiscoveryError("non-standard discovery port is not allowed")
    except ValueError as error:
        raise DiscoveryError("source URL has an invalid port") from error
    if parsed.fragment:
        raise DiscoveryError("source URL must not contain a fragment")
    if parsed.query:
        raise DiscoveryError("source URL must not contain a query")
    path = parsed.path or "/"
    return urllib.parse.urlunsplit(("https", parsed.hostname, path.rstrip("/") or "/", parsed.query, ""))


@dataclass(frozen=True)
class FetchLimits:
    timeout_seconds: float = 10.0
    max_bytes: int = 512_000
    max_pages: int = 3
    max_items: int = 100

    def __post_init__(self) -> None:
        if not (0 < self.timeout_seconds <= 30) or not (0 < self.max_bytes <= 2_000_000):
            raise DiscoveryError("unsafe fetch limits")
        if not (0 < self.max_pages <= 10 and 0 < self.max_items <= 500):
            raise DiscoveryError("unsafe pagination limits")


class MetadataFetcher:
    """HTTPS JSON fetcher with strict bounds; injectable for deterministic tests."""

    def __init__(self, *, limits: FetchLimits | None = None,
                 opener: Callable[..., Any] | None = None):
        self.limits = limits or FetchLimits()
        self.opener = opener or urllib.request.urlopen

    def get_json(self, url: str) -> tuple[Any, dict[str, Any]]:
        canonical = validate_source_url(url)
        request = urllib.request.Request(canonical, headers={"Accept": "application/json", "User-Agent": "Frank-Control-Discovery/1"})
        response = None
        try:
            response = self.opener(request, timeout=self.limits.timeout_seconds)
            # urllib follows redirects by default.  Re-validate the final URL
            # so an allowlisted provider cannot bounce discovery to an
            # arbitrary host (or a non-HTTPS endpoint).
            final_url = response.geturl() if callable(getattr(response, "geturl", None)) else canonical
            validate_source_url(final_url)
            raw = response.read(self.limits.max_bytes + 1)
        except Exception as error:
            raise DiscoveryError("metadata provider unavailable") from error
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()
        if len(raw) > self.limits.max_bytes:
            raise DiscoveryError("metadata response exceeds bound")
        try:
            return json.loads(raw.decode("utf-8")), {"url": canonical, "bytes": len(raw), "captured_at": _now()}
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DiscoveryError("metadata response is not JSON") from error


def _url_key(url: str) -> str:
    parsed = urllib.parse.urlsplit(validate_source_url(url, _ALLOWED_HOSTS | {"raw.githubusercontent.com"}))
    return urllib.parse.urlunsplit((parsed.scheme, parsed.hostname or "", parsed.path.rstrip("/").lower(), "", ""))


def normalize_candidate(raw: Mapping[str, Any], *, source_kind: str = "github", captured_at: str | None = None) -> dict[str, Any]:
    """Normalise provider metadata to a candidate-only, schema-compatible record."""
    if not isinstance(raw, Mapping):
        raise DiscoveryError("candidate metadata must be an object")
    url = raw.get("source_url") or raw.get("html_url") or raw.get("url")
    if not isinstance(url, str):
        raise DiscoveryError("candidate source URL is required")
    url = validate_source_url(url, _ALLOWED_HOSTS | {"raw.githubusercontent.com"})
    name = raw.get("name") or raw.get("full_name")
    if not isinstance(name, str) or not name.strip() or len(name) > 160:
        raise DiscoveryError("candidate name is required")
    revision = raw.get("source_revision") or raw.get("default_branch_sha") or raw.get("sha")
    if not isinstance(revision, str) or not _REVISION.fullmatch(revision):
        raise DiscoveryError("exact candidate revision is required")
    licence = raw.get("licence") or raw.get("license")
    if isinstance(licence, Mapping): licence = licence.get("spdx_id") or licence.get("name")
    if not isinstance(licence, str) or not licence.strip() or licence.upper() in {"NOASSERTION", "UNKNOWN"}:
        raise DiscoveryError("verified licence evidence is required")
    activity = str(raw.get("last_material_activity") or raw.get("pushed_at") or "unknown")
    snapshot = str(captured_at or raw.get("captured_at") or _now())
    evidence = [str(item) for item in raw.get("maintenance_evidence", []) if item]
    if not evidence:
        evidence = [f"{url} metadata snapshot at {snapshot}"]
    metadata_receipt = "receipt:discovery/metadata-" + _digest({"url": url, "revision": revision})[7:23]
    candidate = {
        "name": name.strip(), "source_url": url, "source_revision": revision,
        "licence": licence.strip(), "latest_release": str(raw.get("latest_release") or raw.get("tag_name") or "unknown"),
        "last_material_activity": activity, "maintenance_evidence": sorted(set(evidence)),
        "fit": str(raw.get("fit") or "Candidate requires owner review"),
        "gaps": list(dict.fromkeys(str(x) for x in raw.get("gaps", []) if x)),
        "runtime_cost": str(raw.get("runtime_cost") or "unknown"),
        "integration_cost": str(raw.get("integration_cost") or "unknown"),
        "overlaps": list(dict.fromkeys(str(x) for x in raw.get("overlaps", []) if x)),
        "export_removal_path": str(raw.get("export_removal_path") or "Disable discovery record and remove adapter reference"),
        "dependency_health_receipts": list(dict.fromkeys(str(x) for x in raw.get("dependency_health_receipts", []) if x)) or [metadata_receipt],
        "discovery": {"source_kind": source_kind, "captured_at": snapshot, "metadata_hash": _digest(dict(raw))},
        "state_axes": {"lifecycle": "draft", "trust": "unreviewed", "installation": "not_installed", "enablement": "disabled", "production_authority": "none"},
    }
    return candidate


def deduplicate_candidates(candidates: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Dedupe by canonical source URL, retaining the richest metadata."""
    result: dict[str, dict[str, Any]] = {}
    for item in candidates:
        candidate = copy.deepcopy(dict(item))
        key = _url_key(str(candidate.get("source_url", "")))
        prior = result.get(key)
        if prior is None or len(canonical_bytes(candidate)) > len(canonical_bytes(prior)):
            result[key] = candidate
    return [result[key] for key in sorted(result)]


def rank_candidates(candidates: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Rank using declared evidence only; trend/stars are never approval."""
    def score(item: Mapping[str, Any]) -> tuple[int, str]:
        fit = str(item.get("fit", "")).lower()
        evidence = len(item.get("maintenance_evidence", [])) if isinstance(item.get("maintenance_evidence"), list) else 0
        return (min(10, (2 if "unknown" not in fit else 0) + min(4, evidence) - min(4, len(item.get("gaps", [])))), str(item.get("name", "")))
    return sorted((copy.deepcopy(dict(c)) for c in candidates), key=score, reverse=True)


def metadata_snapshot(candidates: Sequence[Mapping[str, Any]], *, query_hash: str, producer: str = "discovery") -> dict[str, Any]:
    """Create a deterministic, immutable snapshot envelope."""
    if not isinstance(query_hash, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", query_hash):
        raise DiscoveryError("query hash is required")
    rows = deduplicate_candidates(candidates)
    return {"schema": "frank.discovery.snapshot/v1", "producer": producer, "captured_at": _now(), "query_hash": query_hash, "candidate_count": len(rows), "candidates": rows, "snapshot_hash": _digest(rows)}


class DiscoveryReceiptStore:
    """Receipt seam backed by the existing append-only immutable store."""

    def __init__(self, receipts: Any):
        if not hasattr(receipts, "write"):
            raise DiscoveryError("an immutable receipt store is required")
        self.receipts = receipts

    def write_snapshot(self, snapshot: Mapping[str, Any], *, idempotency_key: str) -> dict[str, Any]:
        value = copy.deepcopy(dict(snapshot))
        if not isinstance(idempotency_key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", idempotency_key):
            raise DiscoveryError("a valid snapshot idempotency key is required")
        fingerprint = _digest(value)
        receipt = {
            "id": "receipt:discovery/snapshot-" + fingerprint[7:23],
            "kind": "discovery_snapshot", "subject_ids": ["source:discovery"], "producer": "discovery",
            "source_revision_set": {"query": str(value.get("query_hash", "unknown"))},
            "deployed_revision_set": {}, "captured_at": str(value.get("captured_at", _now())),
            "fresh_until": (datetime.now(timezone.utc) + timedelta(hours=48)).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "outcome": "partial",
            "evidence_uris": [str(value.get("query_hash", "snapshot"))], "redaction": "secret_filtered",
            "snapshot_hash": str(value.get("snapshot_hash", fingerprint)), "candidate_count": int(value.get("candidate_count", 0)),
        }
        return self.receipts.write(receipt, key=idempotency_key, fingerprint=fingerprint)


__all__ = ["DiscoveryError", "DiscoveryReceiptStore", "FetchLimits", "MetadataFetcher", "deduplicate_candidates", "metadata_snapshot", "normalize_candidate", "rank_candidates", "validate_source_url"]
