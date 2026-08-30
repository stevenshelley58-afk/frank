"""Read-only runtime evidence adapter.

This module is deliberately provider-neutral at its public boundary.  A
provider supplies a small JSON observation; this adapter validates and
normalizes it for Frank/Blockwise without copying logs, credentials, or a
monitoring UI into the application.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import ipaddress
import re
from datetime import datetime, timezone
from typing import Any, Mapping, Protocol
from urllib.parse import quote, urlsplit

HEALTH = frozenset({"healthy", "degraded", "unhealthy", "unavailable", "unknown"})
FRESHNESS = frozenset({"fresh", "stale", "unavailable", "unknown"})
MONITORING_AUTHORITIES = frozenset({"runtime", "monitoring", "observability"})
_FOREIGN_PROVIDERS = frozenset({"agenttrail", "archify"})
_SECRET = re.compile(
    r"(?i)([\"']?(?:authorization|bearer|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key)[\"']?\s*[:=]\s*[\"']?)([^\"'\s,;}]+)"
)
_RECEIPT = re.compile(r"receipt:[A-Za-z0-9][A-Za-z0-9._/-]{0,158}\Z")


class RuntimeEvidenceError(ValueError):
    """Input is not a valid runtime evidence observation."""


class RuntimeProvider(Protocol):
    name: str

    def observe(self, system_id: str) -> Mapping[str, Any]: ...


class BeszelProvider:
    """Small transport seam for the selected Beszel hub.

    ``fetch`` is injected so production can use its authenticated HTTP client
    while tests remain isolated and never need credentials or a live VPS.
    """

    name = "beszel"

    def __init__(self, base_url: str, fetch: Any):
        self.base_url = (_safe_url(base_url) or "").rstrip("/")
        if not self.base_url:
            raise RuntimeEvidenceError("Beszel base URL must be an internal HTTP(S) URL")
        self.fetch = fetch

    def observe(self, system_id: str) -> Mapping[str, Any]:
        if not isinstance(system_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", system_id):
            raise RuntimeEvidenceError("invalid system ID")
        value = self.fetch(f"{self.base_url}/api/runtime/{quote(system_id, safe='')}")
        if not isinstance(value, Mapping):
            raise RuntimeEvidenceError("Beszel response is not an object")
        return value

class HealthProvider:
    """Fixed, read-only health endpoints for deployments without Beszel."""
    name = "health"
    def __init__(self, endpoints: Mapping[str, str], fetch: Any, revisions: Mapping[str, str] | None = None):
        if set(endpoints) != {"frank", "blockwise"}:
            raise RuntimeEvidenceError("health endpoints must declare exactly frank and blockwise")
        self.endpoints = {k: (_safe_url(v) or "") for k, v in endpoints.items() if k in {"frank", "blockwise"}}
        if set(self.endpoints) != {"frank", "blockwise"} or any(not v for v in self.endpoints.values()):
            raise RuntimeEvidenceError("health endpoints must be fixed internal URLs")
        self.fetch = fetch
        self.revisions = dict(revisions or {})
    def observe(self, system_id: str) -> Mapping[str, Any]:
        if system_id not in self.endpoints: raise RuntimeEvidenceError("invalid system ID")
        value = self.fetch(self.endpoints[system_id])
        if not isinstance(value, Mapping): raise RuntimeEvidenceError("health response is not an object")
        if "health" in value and value.get("health") not in HEALTH:
            raise RuntimeEvidenceError("health response contains an invalid health value")
        if "health" not in value:
            if isinstance(value.get("ok"), bool):
                value = {**value, "health": "healthy" if value["ok"] else "unhealthy"}
            elif (
                system_id == "blockwise"
                and isinstance(value.get("app"), str)
                and value["app"].strip().lower() == "blockwise"
                and isinstance(value.get("status"), str)
            ):
                status = value["status"].strip().lower()
                normalized = {"ok": "healthy", "ready": "healthy", "healthy": "healthy", "degraded": "degraded", "unhealthy": "unhealthy", "unavailable": "unavailable", "unknown": "unknown"}.get(status)
                if normalized is None:
                    raise RuntimeEvidenceError("Blockwise health response contains an invalid status")
                value = {**value, "health": normalized}
            else:
                raise RuntimeEvidenceError("health response contains no truthful health signal")
        from datetime import datetime, timezone
        value = {**value, "route": self.endpoints[system_id], "evidence_url": self.endpoints[system_id], "deployed_revision": value.get("deployed_revision") or self.revisions.get(system_id), "observed_at": value.get("observed_at") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "freshness": value.get("freshness", "fresh")}
        return value


@dataclass(frozen=True)
class RuntimeSummary:
    system_id: str
    provider: str
    health: str
    freshness: str
    deployed_revision: str | None
    route: str | None
    errors: int | None
    error_summary: str | None
    worker_queue: str | None
    data_store: str | None
    backup_freshness: str | None
    observed_at: str | None
    evidence_url: str | None
    evidence_receipt_id: str | None
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return compact JSON-safe data; never include raw provider payload."""
        return asdict(self)


def _text(value: Any, *, limit: int = 256) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    cleaned = _SECRET.sub(r"\1[REDACTED]", value).replace("\x00", " ").strip()
    return cleaned[:limit]


def _component(value: Any) -> str | None:
    """Keep component health compact when providers return an object."""
    if isinstance(value, Mapping):
        value = value.get("health", value.get("status"))
    return _text(value, limit=64)


def _safe_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.netloc or parts.username or parts.password:
        return None
    # Query strings commonly carry bearer tokens.  Evidence links are paths,
    # not a transport for secrets.
    if parts.query or parts.fragment:
        return None
    host = parts.hostname
    if not host:
        return None
    try:
        if not (ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback):
            return None
    except ValueError:
        # Hostnames are accepted only for explicitly internal/authenticated
        # routes; callers should still place them behind Caddy auth.
        if host.lower() not in {"localhost", "beszel", "beszel-hub", "monitoring"} and not host.lower().endswith(".internal"):
            allowed = {("https", "frank.fail", "/frank/"), ("https", "frank.fail", "/api/health"), ("https", "blockwise.sale", "/api/health")}
            if (parts.scheme, host.lower(), parts.path) not in allowed: return None
    return f"{parts.scheme}://{parts.netloc}{parts.path or '/'}"


def _freshness(raw: Mapping[str, Any], now: datetime) -> str:
    value = raw.get("freshness")
    deadline = raw.get("fresh_until")
    if isinstance(deadline, str):
        try:
            parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            # A provider cannot override an expired freshness deadline with a
            # contradictory ``fresh`` label.
            if parsed <= now:
                return "stale"
            if value in FRESHNESS:
                return str(value)
            return "fresh"
        except ValueError:
            pass
    if value in FRESHNESS:
        return str(value)
    return "unknown"


def _reject_foreign_authority(raw: Mapping[str, Any]) -> None:
    authority = raw.get("authority")
    if isinstance(authority, str) and authority.lower() not in MONITORING_AUTHORITIES:
        raise RuntimeEvidenceError("runtime evidence authority is not a monitoring provider")


def _reject_foreign_provider(provider: Any) -> None:
    if isinstance(provider, str) and provider.strip().lower() in _FOREIGN_PROVIDERS:
        raise RuntimeEvidenceError("agent activity or architecture is not runtime health evidence")


def normalize_observation(system_id: str, raw: Mapping[str, Any], *, provider: str = "unknown", now: datetime | None = None) -> RuntimeSummary:
    """Normalize one provider observation into the frozen runtime contract."""
    if not isinstance(system_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", system_id):
        raise RuntimeEvidenceError("invalid system ID")
    if not isinstance(raw, Mapping):
        raise RuntimeEvidenceError("provider observation must be an object")
    _reject_foreign_provider(provider)
    _reject_foreign_authority(raw)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    health = raw.get("health", "unknown") if raw.get("health", "unknown") in HEALTH else "unknown"
    freshness = _freshness(raw, now)
    errors = raw.get("errors", raw.get("error_count"))
    if isinstance(errors, bool) or not isinstance(errors, int) or errors < 0:
        errors = None
    receipt = _text(raw.get("evidence_receipt_id"), limit=160)
    if receipt and not _RECEIPT.fullmatch(receipt):
        receipt = None
    observed = _text(raw.get("observed_at"), limit=64)
    return RuntimeSummary(
        system_id=system_id, provider=_text(provider, limit=64) or "unknown",
        health=health, freshness=freshness,
        deployed_revision=_text(raw.get("deployed_revision", raw.get("revision")), limit=128),
        route=_safe_url(raw.get("route")), errors=errors,
        error_summary=_text(raw.get("error_summary")),
        worker_queue=_component(raw.get("worker_queue")), data_store=_component(raw.get("data_store")),
        backup_freshness=_component(raw.get("backup_freshness")), observed_at=observed,
        evidence_url=_safe_url(raw.get("evidence_url")), evidence_receipt_id=receipt,
        reason=_text(raw.get("reason")),
    )


class RuntimeEvidenceAdapter:
    """Read-only adapter for the two supported systems."""

    SYSTEMS = frozenset({"frank", "blockwise"})

    def __init__(self, provider: RuntimeProvider, *, release_revisions: Mapping[str, str] | None = None, evidence_base_url: str | None = None):
        self.provider = provider
        self.release_revisions = dict(release_revisions or {})
        self.evidence_base_url = _safe_url(evidence_base_url) if evidence_base_url else None

    def deep_link(self, system_id: str) -> str | None:
        """Return the authenticated provider surface, never a Frank clone."""
        if system_id not in self.SYSTEMS or not self.evidence_base_url:
            return None
        return f"{self.evidence_base_url.rstrip('/')}/systems/{system_id}"

    def summary(self, system_id: str) -> RuntimeSummary:
        if system_id not in self.SYSTEMS:
            raise RuntimeEvidenceError("unsupported runtime system")
        try:
            raw = self.provider.observe(system_id)
            result = normalize_observation(system_id, raw, provider=getattr(self.provider, "name", "unknown"))
        except RuntimeEvidenceError:
            raise
        except Exception:
            return RuntimeSummary(system_id, getattr(self.provider, "name", "unknown"), "unavailable", "unavailable", None, None, None, None, None, None, None, None, None, None, "provider unavailable")
        expected = self.release_revisions.get(system_id)
        if not result.evidence_url:
            link = self.deep_link(system_id)
            if link:
                result = replace(result, evidence_url=link)
        if expected and expected != result.deployed_revision:
            return replace(result, health="degraded", reason="deployed revision does not match release receipt")
        return result
