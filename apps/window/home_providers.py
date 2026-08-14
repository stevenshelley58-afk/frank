"""Registered, failure-isolated providers for entity home widgets.

Providers are read-only projections. They receive a scoped context and return a
common snapshot contract; they never mutate project, account, connection, or
Hermes state.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import re
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


Provider = Callable[["ProviderContext"], dict]
PROVIDERS: dict[str, Provider] = {}
_probe_cache: dict[str, tuple[float, dict]] = {}
_probe_lock = threading.RLock()
PROBE_CACHE_SECONDS = 15
PROBE_TIMEOUT_SECONDS = 1.5
KNOWN_INTERNAL_VIEWS = {
    "hub", "files", "tools", "trace", "releases", "project", "entity-home",
    "accounts", "connections", "widget-builder", "campaigns",
}
KNOWN_ENTITY_KINDS = {"project", "tool", "agent", "service"}
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")


@dataclass
class ProviderContext:
    kind: str
    entity_id: str
    entity: dict
    project: dict
    connections: list[dict]
    bound_connection: dict | None
    accounts: list[dict]
    hermes_health: Callable[[], dict]
    hermes_sessions: Callable[[], dict] | None
    roots: dict[str, Path]
    catalog: list[dict]
    widget_catalog: list[dict]
    now: int
    probe_health: Callable[[dict], dict | None]
    extra: dict = field(default_factory=dict)


def register(*widget_ids: str):
    def decorator(function: Provider) -> Provider:
        for widget_id in widget_ids:
            PROVIDERS[widget_id] = function
        return function

    return decorator


def snapshot(status: str, summary: str, data: dict | None = None, links: list[dict] | None = None, *, now: int = 0) -> dict:
    return {
        "schema": "schema://frank.widget-snapshot/v1",
        "status": status,
        "summary": summary,
        "data": data or {},
        "links": links or [],
        "generated_at": now or int(time.time()),
        "source_truth": "provider",
    }


def internal_link(label: str, *, view: str | None = None, kind: str | None = None, entity_id: str | None = None, name: str | None = None) -> dict | None:
    if view is not None and view not in KNOWN_INTERNAL_VIEWS:
        return None
    if kind is not None and kind not in KNOWN_ENTITY_KINDS:
        return None
    if entity_id is not None and not SAFE_ID.fullmatch(str(entity_id)):
        return None
    if kind is not None and entity_id is None:
        return None
    target = {key: value for key, value in {
        "view": view,
        "kind": kind,
        "id": entity_id,
        "name": name,
    }.items() if value is not None}
    return {"label": label, "kind": "internal", "target": target}


def external_link(label: str, url: str) -> dict | None:
    parsed = urlparse(str(url or ""))
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        return None
    return {"label": label, "kind": "external", "url": str(url)}


def _profile(ctx: ProviderContext) -> dict:
    return ctx.project or ctx.entity or {}


def _project_path(ctx: ProviderContext) -> tuple[Path | None, str]:
    profile = _profile(ctx)
    root_name = str(profile.get("root") or ctx.entity_id)
    base = ctx.roots.get("vps")
    if not base:
        return None, root_name
    projects = (base / "projects").resolve()
    target = (projects / root_name).resolve()
    try:
        target.relative_to(projects)
    except ValueError:
        return None, root_name
    return target, root_name


def _git_directory(target: Path) -> Path | None:
    git = target / ".git"
    if git.is_dir():
        return git
    if git.is_file():
        try:
            match = re.match(r"gitdir:\s*(.+)", git.read_text(encoding="utf-8").strip(), re.I)
        except OSError:
            return None
        if not match:
            return None
        path = Path(match.group(1))
        return path if path.is_absolute() else (target / path).resolve()
    return None


def _git_branch(target: Path) -> str:
    git = _git_directory(target)
    if not git:
        return "unknown"
    try:
        head = (git / "HEAD").read_text(encoding="utf-8").strip()
    except OSError:
        return "unknown"
    return head.rsplit("/", 1)[-1] if head.startswith("ref:") else head[:12] or "unknown"


def _repo_rows(target: Path, limit: int = 5) -> list[dict]:
    git = _git_directory(target)
    if not git:
        return []
    candidates = [git / "logs" / "HEAD"]
    rows: list[dict] = []
    try:
        lines = candidates[0].read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return rows
    for line in reversed(lines):
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        metadata, subject = parts
        fields = metadata.split(" ")
        if len(fields) < 4:
            continue
        author = " ".join(fields[2:-2]).strip() or "unknown author"
        author = re.sub(r"\s*<[^>]*>\s*$", "", author).strip() or "unknown author"
        try:
            timestamp = int(fields[-2])
        except ValueError:
            timestamp = 0
        rows.append({
            "subject": subject[:160],
            "author": author[:100],
            "timestamp": timestamp,
            "short_id": fields[1][:12],
        })
        if len(rows) >= limit:
            break
    return rows


def _repo_files(target: Path, limit: int = 8) -> dict:
    if not target.is_dir():
        return {"files": 0, "folders": 0, "recent": []}
    files = 0
    folders = 0
    recent: list[tuple[float, str, bool]] = []
    try:
        for child in target.iterdir():
            if child.name.startswith(".") or child.name in {"node_modules", "dist", "__pycache__"}:
                continue
            is_dir = child.is_dir()
            folders += int(is_dir)
            files += int(not is_dir)
            try:
                recent.append((child.stat().st_mtime, child.name, is_dir))
            except OSError:
                continue
    except OSError:
        return {"files": 0, "folders": 0, "recent": []}
    recent.sort(reverse=True)
    return {
        "files": files,
        "folders": folders,
        "recent": [{"name": name, "kind": "folder" if is_dir else "file", "timestamp": int(mtime)} for mtime, name, is_dir in recent[:limit]],
    }


def _scoped_connections(ctx: ProviderContext) -> list[dict]:
    return list(ctx.connections)


def _attention_connections(ctx: ProviderContext) -> list[dict]:
    return [item for item in _scoped_connections(ctx) if item.get("status") in {"connected", "setup_needed", "error"}]


@register("entity-overview")
def entity_overview(ctx: ProviderContext) -> dict:
    profile = _profile(ctx)
    links = []
    live = external_link("Open application", profile.get("live")) if profile.get("live") else None
    if live:
        links.append(live)
    setup_only = bool(profile.get("setup_only"))
    return snapshot(
        "setup_needed" if setup_only else "ready",
        "This service is a setup surface; provider status is not configured yet." if setup_only else f"{ctx.entity.get('name') or ctx.entity_id} home",
        {
            "kind": ctx.kind,
            "name": ctx.entity.get("name") or ctx.entity_id,
            "description": str(profile.get("blurb") or ctx.entity.get("blurb") or "No description recorded."),
            "root": profile.get("root"),
            "capabilities": list(profile.get("capabilities") or ctx.entity.get("capabilities") or []),
            "live": profile.get("live", ""),
            "setup_only": setup_only,
        },
        links,
        now=ctx.now,
    )


@register("application-status")
def application_status(ctx: ProviderContext) -> dict:
    profile = _profile(ctx)
    live = str(profile.get("live") or "")
    health_url = str(profile.get("health") or "")
    links = []
    for label, url in (("Open application", live), ("Open health endpoint", health_url)):
        link = external_link(label, url)
        if link:
            links.append(link)
    if not live:
        return snapshot("setup_needed", "No live application is verified for this entity.", {"health": "not_configured"}, links, now=ctx.now)
    if not health_url:
        return snapshot("attention", "Live application is recorded; no health endpoint is configured.", {"live": live, "health": "not_configured"}, links, now=ctx.now)
    probe = ctx.probe_health(profile)
    if probe and probe.get("ok"):
        return snapshot("ready", "Application health check passed.", {"live": live, "health": probe}, links, now=ctx.now)
    detail = (probe or {}).get("reason", "Health check did not pass.")
    return snapshot("error", "Application health check failed.", {"live": live, "health": probe or {"reason": detail}}, links, now=ctx.now)


@register("repository-status")
def repository_status(ctx: ProviderContext) -> dict:
    target, root_name = _project_path(ctx)
    if not target:
        return snapshot("unavailable", "Repository mount is unavailable.", {"root": root_name}, now=ctx.now)
    if not target.is_dir():
        return snapshot("setup_needed", "Repository is not present on the VPS.", {"root": root_name}, [internal_link("Open Files", view="files")], now=ctx.now)
    branch = _git_branch(target)
    git = _git_directory(target)
    return snapshot("ready", f"Repository present on {branch}.", {"root": root_name, "branch": branch, "git": bool(git)}, now=ctx.now)


@register("repository-activity")
def repository_activity(ctx: ProviderContext) -> dict:
    target, root_name = _project_path(ctx)
    if not target or not target.is_dir():
        return snapshot("setup_needed", "Repository activity is available when the project checkout is mounted.", {"root": root_name}, now=ctx.now)
    rows = _repo_rows(target)
    if not rows:
        return snapshot("empty", "No recent repository activity was found in the read-only Git log.", {"root": root_name, "rows": []}, now=ctx.now)
    return snapshot("ready", f"{len(rows)} recent repository change{'s' if len(rows) != 1 else ''}.", {"root": root_name, "branch": _git_branch(target), "rows": rows}, now=ctx.now)


@register("project-files")
def project_files(ctx: ProviderContext) -> dict:
    target, root_name = _project_path(ctx)
    if not target or not target.is_dir():
        return snapshot("setup_needed", "Project files are available when the checkout is mounted.", {"root": root_name}, [internal_link("Open Files", view="files")], now=ctx.now)
    data = _repo_files(target)
    return snapshot("ready", f"{data['files']} files and {data['folders']} folders at the project root.", data, [internal_link("Open Files", view="files")], now=ctx.now)


@register("accounts-summary")
def accounts_summary(ctx: ProviderContext) -> dict:
    accounts = [item for item in ctx.accounts if ctx.kind != "project" or item.get("project_id") == ctx.entity_id]
    customers = sum(1 for item in accounts if item.get("kind") == "customer")
    attention = sum(1 for item in accounts if item.get("status") == "attention")
    status = "attention" if attention else ("ready" if accounts else "empty")
    return snapshot(status, f"{len(accounts)} account record{'s' if len(accounts) != 1 else ''}.", {
        "customers": customers, "attention": attention, "total": len(accounts), "status_is_recorded": True,
    }, [internal_link("Open Accounts", view="accounts")], now=ctx.now)


@register("connections-summary")
def connections_summary(ctx: ProviderContext) -> dict:
    connections = _scoped_connections(ctx)
    counts = {status: sum(1 for item in connections if item.get("status") == status) for status in ("setup_needed", "connected", "verified", "error")}
    pending = counts["setup_needed"] + counts["connected"] + counts["error"]
    status = "attention" if pending else ("ready" if counts["verified"] else "setup_needed")
    return snapshot(status, f"{len(connections)} recorded connection{'s' if len(connections) != 1 else ''}.", {
        "counts": counts,
        "connections": [{
            "id": item.get("id"), "name": item.get("name"), "provider": item.get("provider"),
            "status": item.get("status"),
            "credential_ref_present": bool(item.get("credential_ref")),
            "last_verified_at": item.get("last_verified_at") or "",
        } for item in connections[:6]],
        "status_is_recorded": True,
    }, [internal_link("Open Connections", view="connections")], now=ctx.now)


@register("connection-attention")
def connection_attention(ctx: ProviderContext) -> dict:
    rows = _attention_connections(ctx)
    if not rows:
        status = "ready" if ctx.connections else "setup_needed"
        summary = "No connection setup, verification, or error items are recorded." if ctx.connections else "No connections are recorded yet."
    else:
        status = "attention"
        awaiting = sum(1 for item in rows if item.get("status") == "connected")
        summary = (
            f"{awaiting} connection record{'s' if awaiting != 1 else ''} await verification"
            + (f"; {len(rows) - awaiting} other item{'s' if len(rows) - awaiting != 1 else ''} need setup or review." if len(rows) > awaiting else ".")
            if awaiting else
            f"{len(rows)} connection item{'s' if len(rows) != 1 else ''} need setup or review."
        )
    return snapshot(status, summary, {"rows": [{"name": item.get("name"), "provider": item.get("provider"), "status": item.get("status")} for item in rows]}, [internal_link("Review setup", view="connections")], now=ctx.now)


@register("provider-catalog")
def provider_catalog(ctx: ProviderContext) -> dict:
    rows = [{"provider": item.get("provider"), "name": item.get("title"), "capabilities": item.get("capabilities", []), "setup_mode": item.get("setup_mode")} for item in ctx.catalog]
    return snapshot("ready", f"{len(rows)} provider types are available for setup.", {"rows": rows}, [internal_link("Open Connections", view="connections")], now=ctx.now)


@register("provider-coverage")
def provider_coverage(ctx: ProviderContext) -> dict:
    recorded = {str(item.get("provider")) for item in ctx.connections}
    rows = []
    for item in ctx.catalog:
        connection = next((candidate for candidate in ctx.connections if candidate.get("provider") == item.get("provider")), None)
        raw_status = str(connection.get("status") or "") if connection else ""
        # A connection record is evidence of metadata only. Keep that state
        # distinct from provider verification so setup/error records cannot
        # accidentally look healthy in a coverage summary.
        status = {
            "connected": "recorded",
            "verified": "verified",
            "setup_needed": "setup_needed",
            "error": "error",
        }.get(raw_status, "recorded" if connection else "setup_needed")
        rows.append({"provider": item.get("provider"), "name": item.get("title"), "status": status, "recorded": bool(connection)})
    recorded_count = sum(1 for row in rows if row["provider"] in recorded)
    verified = sum(1 for row in rows if row["status"] == "verified")
    configured = sum(1 for row in rows if row["status"] in {"recorded", "verified"})
    setup_needed = sum(1 for row in rows if row["status"] == "setup_needed")
    errors = sum(1 for row in rows if row["status"] == "error")
    if errors:
        status = "error"
    elif setup_needed or configured != verified:
        status = "attention" if recorded_count else "setup_needed"
    else:
        status = "ready" if rows else "setup_needed"
    return snapshot(status, f"{recorded_count} of {len(rows)} provider types have recorded metadata; {verified} verified.", {
        "rows": rows, "recorded": recorded_count, "verified": verified,
        "configured": configured, "setup_needed": setup_needed, "error": errors, "total": len(rows),
    }, [internal_link("Configure coverage", view="connections")], now=ctx.now)


@register("hermes-status")
def hermes_status(ctx: ProviderContext) -> dict:
    health = ctx.hermes_health() or {}
    ok = bool(health.get("ok"))
    return snapshot("ready" if ok else "unavailable", "Hermes is reachable." if ok else "Hermes is not reachable.", {
        "profile": health.get("profile", "default"), "reason": health.get("reason", ""),
    }, [internal_link("Open Hub", view="hub")], now=ctx.now)


@register("hermes-session")
def hermes_session(ctx: ProviderContext) -> dict:
    if not ctx.hermes_sessions:
        return snapshot("unavailable", "Hermes session summaries are not configured.", {}, [internal_link("Open Hub", view="hub")], now=ctx.now)
    try:
        result = ctx.hermes_sessions() or {}
    except Exception as error:  # Provider isolation keeps home rendering alive.
        return snapshot("error", "Hermes session summary failed.", {"reason": str(error)[:180]}, [internal_link("Open Hub", view="hub")], now=ctx.now)
    if not result.get("ok", True):
        return snapshot("unavailable", "Hermes session summaries are unavailable.", {"reason": result.get("reason", "")}, [internal_link("Open Hub", view="hub")], now=ctx.now)
    sessions = list(result.get("sessions") or [])
    rows = [{key: session.get(key) for key in ("id", "title", "updated_at", "message_count", "preview", "model")} for session in sessions[:6]]
    return snapshot("ready" if rows else "empty", f"{len(sessions)} Hermes session{'s' if len(sessions) != 1 else ''} available.", {"rows": rows, "total": len(sessions)}, [internal_link("Open Hub", view="hub")], now=ctx.now)


@register("widget-catalog")
def widget_catalog(ctx: ProviderContext) -> dict:
    rows = [{"id": item.get("id"), "title": item.get("title"), "provider": item.get("provider"), "surfaces": item.get("surfaces", []), "custom": bool(item.get("custom"))} for item in ctx.widget_catalog]
    custom = sum(1 for row in rows if row["custom"])
    return snapshot("ready", f"{len(rows)} widgets registered; {custom} custom.", {"rows": rows, "custom": custom, "total": len(rows)}, [internal_link("Open Widget Builder", view="widget-builder")], now=ctx.now)


@register("analytics-summary")
def analytics_summary(ctx: ProviderContext) -> dict:
    analytics = ctx.bound_connection or next((item for item in ctx.connections if "analytics.read" in item.get("capabilities", []) or "umami" in str(item.get("name", "")).lower()), None)
    if not analytics:
        return snapshot("setup_needed", "Connect an analytics provider to show selected metrics.", {"metrics": [], "adapter": "not_configured"}, [internal_link("Set up analytics", view="connections")], now=ctx.now)
    if analytics.get("status") != "verified":
        return snapshot("attention", f"{analytics.get('name')} is recorded but not verified.", {"metrics": [], "status": analytics.get("status"), "status_is_recorded": True}, [internal_link("Review analytics connection", view="connections")], now=ctx.now)
    return snapshot("setup_needed", "Analytics connection is verified; no live metrics adapter is configured.", {"metrics": [], "adapter": "not_configured", "status_is_recorded": True}, [internal_link("Review analytics connection", view="connections")], now=ctx.now)


@register("work-status")
def work_status(ctx: ProviderContext) -> dict:
    return snapshot("setup_needed", "No work-event provider is configured for this home.", {"running": 0, "waiting": 0}, [internal_link("Configure a provider", view="connections")], now=ctx.now)


@register("recent-receipts")
def recent_receipts(ctx: ProviderContext) -> dict:
    return snapshot("setup_needed", "No receipt provider is configured for this home.", {"receipts": []}, [internal_link("Configure a provider", view="connections")], now=ctx.now)


@register("quick-links")
def quick_links(ctx: ProviderContext) -> dict:
    links = [internal_link("Open Connections", view="connections"), internal_link("Open Hub", view="hub")]
    live = external_link("Open application", _profile(ctx).get("live")) if _profile(ctx).get("live") else None
    if live:
        links.insert(0, live)
    return snapshot("ready", f"{len(links)} safe shortcut{'s' if len(links) != 1 else ''} available.", {"count": len(links)}, links, now=ctx.now)


def probe_profile_health(profile: dict, allowed_urls: set[str] | frozenset[str] | None = None) -> dict | None:
    """Probe only the exact health URL declared by the canonical profile."""
    url = str(profile.get("health") or "")
    if not url:
        return None
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or url not in (allowed_urls or set())
    ):
        return {"ok": False, "reason": "health URL is not an allowlisted canonical profile URL"}
    with _probe_lock:
        cached = _probe_cache.get(url)
        if cached and time.monotonic() - cached[0] < PROBE_CACHE_SECONDS:
            return {**cached[1], "cached": True}
    started = time.monotonic()
    result: dict
    try:
        with urlopen(Request(url, headers={"Accept": "application/json", "User-Agent": "Frank-Window/1"}), timeout=PROBE_TIMEOUT_SECONDS) as response:
            status = int(getattr(response, "status", response.getcode()))
        result = {"ok": 200 <= status < 400, "status": status, "latency_ms": round((time.monotonic() - started) * 1000)}
    except HTTPError as error:
        result = {"ok": False, "status": int(error.code), "reason": f"HTTP {error.code}", "latency_ms": round((time.monotonic() - started) * 1000)}
    except (URLError, TimeoutError, OSError) as error:
        result = {"ok": False, "reason": str(error).split("\n", 1)[0][:160], "latency_ms": round((time.monotonic() - started) * 1000)}
    with _probe_lock:
        _probe_cache[url] = (time.monotonic(), result)
    return result


def render(widget_id: str, context: ProviderContext) -> dict:
    """Render one widget and quarantine provider failures to that widget."""
    provider = PROVIDERS.get(widget_id)
    if provider is None:
        if widget_id.startswith("custom-"):
            manifest = next((item for item in context.widget_catalog if item.get("id") == widget_id), None)
            if manifest:
                definition = manifest.get("definition") if isinstance(manifest.get("definition"), dict) else {}
                config = context.extra.get("config") if isinstance(context.extra.get("config"), dict) else {}
                url = str(config.get("url") or definition.get("url") or "")
                link = external_link(str(config.get("label") or definition.get("label") or "Open link"), url) if url else None
                links = [link] if link else []
                body = str(config.get("body") or definition.get("body") or "No content configured.")[:800]
                return snapshot("ready" if links or body else "empty", body, {}, links, now=context.now)
        return snapshot("error", "Widget provider is not registered.", {"widget_id": widget_id}, now=context.now)
    try:
        return provider(context)
    except Exception as error:  # A broken provider must not break its neighbors.
        return snapshot("error", "This widget provider failed; the rest of the home is still available.", {"provider": widget_id, "reason": str(error)[:180]}, now=context.now)
