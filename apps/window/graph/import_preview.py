"""Preview-only import of discovery rows.

This module computes a diff and immutable receipt. It intentionally has no
filesystem or canonical-source write path; Step 6C owns applying a validated
``tool:import-source-row`` proposal.
"""
from __future__ import annotations

import copy
import hashlib
from datetime import datetime, timezone
import re
from typing import Any, Mapping

from .control_plane import canonical_bytes
from .discovery import DiscoveryError, deduplicate_candidates, normalize_candidate


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def preview_import(*, existing: list[Mapping[str, Any]], incoming: list[Mapping[str, Any]], source_revision: str, query_hash: str, actor: str = "operator") -> dict[str, Any]:
    """Return a no-write candidate diff with an immutable receipt payload."""
    if not isinstance(source_revision, str) or not re.fullmatch(r"(?:rev_[0-9a-f]{40,64}|[0-9a-f]{40,64})", source_revision) or not isinstance(query_hash, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", query_hash):
        raise DiscoveryError("source and query revisions are required")
    normalised = [normalize_candidate(item, source_kind="import") for item in incoming]
    before = deduplicate_candidates([normalize_candidate(item, source_kind="existing") for item in existing])
    after = deduplicate_candidates(before + normalised)
    before_by_url = {item["source_url"]: item for item in before}
    after_by_url = {item["source_url"]: item for item in after}
    added = [after_by_url[key] for key in sorted(after_by_url.keys() - before_by_url.keys())]
    unchanged, changed = [], []
    for key in sorted(after_by_url.keys() & before_by_url.keys()):
        if canonical_bytes(after_by_url[key]) == canonical_bytes(before_by_url[key]): unchanged.append(key)
        else: changed.append({"source_url": key, "before": before_by_url[key], "after": after_by_url[key]})
    payload = {"schema": "frank.discovery.import-preview/v1", "status": "preview", "applies": False, "actor": actor, "source_revision": source_revision, "query_hash": query_hash, "diff": {"added": added, "changed": changed, "unchanged": unchanged}, "provenance": {"source_revision": source_revision, "query_hash": query_hash}, "state_effect": {"installation": "unchanged", "enablement": "unchanged", "production_authority": "unchanged"}}
    captured = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    receipt = {"id": "receipt:discovery-import/" + _digest(payload)[7:23], "kind": "discovery_import_preview", "subject_ids": ["source:discovery"], "producer": "discovery", "source_revision_set": {"source": source_revision, "query": query_hash}, "deployed_revision_set": {}, "captured_at": captured, "fresh_until": None, "outcome": "partial", "redaction": "secret_filtered", "payload_hash": _digest(payload), "evidence_uris": ["snapshot:" + query_hash]}
    return {"preview": payload, "receipt": receipt, "preview_hash": _digest(payload)}


__all__ = ["preview_import"]
