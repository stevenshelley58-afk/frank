"""Project-scoped, display-only bridge to Hermes-owned Hindsight memory."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Callable
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, abort, jsonify, request


SCHEMA = "schema://frank.memory-inspector/v1"
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$")
_SAFE_BANK_PART = re.compile(r"[^A-Za-z0-9_-]+")
_SAFE_WORKSPACE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
_METADATA_KEYS = {
    "source", "platform", "session_id", "turn_index", "retained_at",
    "message_count", "agent_identity", "corrected_at", "corrected_by",
}


class HindsightUnavailable(RuntimeError):
    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


class HindsightClient:
    """Small HTTP client for the native Hindsight API; it stores no memory."""

    def __init__(self, base_url: str, timeout: float = 8.0):
        self.base_url = str(base_url or "").rstrip("/")
        self.timeout = timeout
        if not self.base_url.startswith("http://"):
            raise ValueError("Hindsight must use the private HTTP bridge")

    def request(self, method: str, path: str, payload: dict | None = None, *, timeout: float | None = None) -> dict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=body, headers=headers, method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            raw = error.read(16_384)
            detail = f"Hindsight returned HTTP {error.code}."
            try:
                parsed = json.loads(raw.decode("utf-8", errors="replace"))
                detail = str(parsed.get("detail") or parsed.get("message") or detail)
            except (json.JSONDecodeError, AttributeError):
                pass
            raise HindsightUnavailable(detail[:300], error.code) from error
        except (OSError, urllib.error.URLError) as error:
            raise HindsightUnavailable("Hindsight memory is unavailable.") from error
        if len(raw) > 2 * 1024 * 1024:
            raise HindsightUnavailable("Hindsight returned an oversized response.", 502)
        try:
            value = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError as error:
            raise HindsightUnavailable("Hindsight returned an invalid response.", 502) from error
        if not isinstance(value, dict):
            raise HindsightUnavailable("Hindsight returned an unsupported response.", 502)
        return value


def _text(value: object, limit: int = 10_000) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def _count(value: object) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _metadata(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        key: _text(raw, 500)
        for key, raw in value.items()
        if key in _METADATA_KEYS and isinstance(raw, (str, int, float, bool))
    }


def _bank_id(project: dict) -> str:
    workspace = _SAFE_BANK_PART.sub("-", _text(project.get("root"), 80)).strip("-_")
    if not workspace:
        raise HindsightUnavailable("Project memory workspace is invalid.", 500)
    return f"steven-{workspace}"


def _resource_id(value: str, label: str) -> str:
    value = str(value or "").strip()
    if not _SAFE_ID.fullmatch(value):
        abort(400, f"invalid {label}")
    return value


def _path(bank_id: str, suffix: str = "") -> str:
    bank = urllib.parse.quote(bank_id, safe="")
    return f"/v1/default/banks/{bank}{suffix}"


def _memory_item(item: object, documents: list[dict], bank_id: str) -> dict | None:
    if not isinstance(item, dict) or not item.get("id"):
        return None
    chunk = _text(item.get("chunk_id"), 300)
    document_id = next(
        (
            str(document["id"])
            for document in documents
            if chunk.startswith(f"{bank_id}_{document['id']}_")
        ),
        "",
    )
    tags = [str(tag)[:120] for tag in item.get("tags", []) if isinstance(tag, str)][:30]
    return {
        "id": _text(item.get("id"), 200),
        "text": _text(item.get("text"), 20_000),
        "type": _text(item.get("fact_type") or item.get("type"), 40),
        "context": _text(item.get("context"), 1_000),
        "entities": _text(item.get("entities"), 2_000),
        "tags": tags,
        "occurred_at": _text(item.get("date") or item.get("occurred_start"), 80),
        "retained_at": _text(item.get("mentioned_at"), 80),
        "proof_count": _count(item.get("proof_count")),
        "source_document_id": document_id,
        "consolidation_failed_at": _text(item.get("consolidation_failed_at"), 80),
    }


def _document_item(item: object) -> dict | None:
    if not isinstance(item, dict) or not item.get("id"):
        return None
    tags = [str(tag)[:120] for tag in item.get("tags", []) if isinstance(tag, str)][:30]
    return {
        "id": _text(item.get("id"), 200),
        "created_at": _text(item.get("created_at"), 80),
        "updated_at": _text(item.get("updated_at"), 80),
        "memory_count": _count(item.get("memory_unit_count")),
        "tags": tags,
        "context": _text((item.get("retain_params") or {}).get("context"), 1_000)
        if isinstance(item.get("retain_params"), dict) else "",
        "metadata": _metadata(item.get("document_metadata")),
    }


def _operation_item(item: object) -> dict | None:
    if not isinstance(item, dict) or not item.get("id"):
        return None
    return {
        "id": _text(item.get("id"), 200),
        "type": _text(item.get("task_type"), 80),
        "status": _text(item.get("status"), 40),
        "created_at": _text(item.get("created_at"), 80),
        "document_id": _text(item.get("document_id"), 200),
        "error": _text(item.get("error_message"), 1_000),
        "retry_count": _count(item.get("retry_count")),
    }


def _audit_item(item: object) -> dict | None:
    if not isinstance(item, dict):
        return None
    return {
        "id": _text(item.get("id"), 200),
        "action": _text(item.get("action"), 80),
        "status": _text(item.get("status"), 40),
        "timestamp": _text(item.get("created_at") or item.get("timestamp"), 80),
        "transport": _text(item.get("transport"), 40),
        "duration_ms": item.get("duration_ms") if isinstance(item.get("duration_ms"), (int, float)) else None,
        "error": _text(item.get("error") or item.get("error_message"), 1_000),
    }


def _mental_model_item(item: object) -> dict | None:
    if not isinstance(item, dict) or not item.get("id") or not item.get("name"):
        return None
    reflect_response = item.get("reflect_response") if isinstance(item.get("reflect_response"), dict) else {}
    content = _text(item.get("content"), 100_000)
    reflected = _text(reflect_response.get("text"), 100_000)
    if reflected and (not content or content == "Generating content..."):
        content = reflected
    return {
        "id": _text(item.get("id"), 200),
        "name": _text(item.get("name"), 200),
        "content": content,
        "source_query": _text(item.get("source_query"), 2_000),
        "tags": [str(tag)[:120] for tag in item.get("tags", []) if isinstance(tag, str)][:30],
        "last_refreshed_at": _text(item.get("last_refreshed_at"), 80),
        "created_at": _text(item.get("created_at"), 80),
    }


def _directive_item(item: object) -> dict | None:
    if not isinstance(item, dict) or not item.get("id") or not item.get("name"):
        return None
    try:
        priority = int(item.get("priority") or 0)
    except (TypeError, ValueError):
        priority = 0
    return {
        "id": _text(item.get("id"), 200),
        "name": _text(item.get("name"), 200),
        "content": _text(item.get("content"), 20_000),
        "priority": max(-10_000, min(10_000, priority)),
        "is_active": bool(item.get("is_active", True)),
        "tags": [str(tag)[:120] for tag in item.get("tags", []) if isinstance(tag, str)][:30],
        "updated_at": _text(item.get("updated_at") or item.get("created_at"), 80),
    }


def _entity_graph(value: object) -> dict:
    if not isinstance(value, dict):
        return {"nodes": [], "edges": [], "total_entities": 0, "total_edges": 0}
    nodes = []
    allowed_ids = set()
    for item in value.get("nodes", [])[:500] if isinstance(value.get("nodes"), list) else []:
        data = item.get("data") if isinstance(item, dict) else None
        if not isinstance(data, dict):
            continue
        node_id = _text(data.get("id"), 200)
        label = _text(data.get("label"), 300)
        if not node_id or not label:
            continue
        allowed_ids.add(node_id)
        nodes.append({
            "id": node_id,
            "label": label,
            "mention_count": _count(data.get("mentionCount")),
        })
    edges = []
    for item in value.get("edges", [])[:1000] if isinstance(value.get("edges"), list) else []:
        data = item.get("data") if isinstance(item, dict) else None
        if not isinstance(data, dict):
            continue
        source = _text(data.get("source"), 200)
        target = _text(data.get("target"), 200)
        if source not in allowed_ids or target not in allowed_ids:
            continue
        edges.append({
            "id": _text(data.get("id"), 420) or f"{source}:{target}",
            "source": source,
            "target": target,
            "weight": _count(data.get("weight")),
            "type": _text(data.get("linkType"), 80) or "cooccurrence",
        })
    return {
        "nodes": nodes,
        "edges": edges,
        "total_entities": max(len(nodes), _count(value.get("total_entities"))),
        "total_edges": max(len(edges), _count(value.get("total_edges"))),
    }


def _code_pages(root: Path | None, project: dict) -> list[dict]:
    workspace = _text(project.get("root"), 80)
    if root is None or not _SAFE_WORKSPACE.fullmatch(workspace):
        return []
    try:
        base = root.resolve(strict=False)
        project_root = (base / workspace).resolve(strict=False)
        if project_root.parent != base or not project_root.is_dir() or project_root.is_symlink():
            return []
    except OSError:
        return []
    pages = []
    try:
        candidates = sorted(project_root.rglob("*.md"), key=lambda path: (path.name != "overview.md", str(path)))[:40]
    except OSError:
        return []
    for path in candidates:
        try:
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 300_000:
                continue
            resolved = path.resolve(strict=True)
            if project_root not in resolved.parents:
                continue
            content = resolved.read_text(encoding="utf-8")
            title = next((line.lstrip("# ").strip() for line in content.splitlines() if line.startswith("# ")), "")
            pages.append({
                "id": str(resolved.relative_to(project_root)).replace("\\", "/"),
                "name": _text(title, 200) or resolved.stem.replace("-", " ").title(),
                "content": _text(content, 250_000),
                "source": "CodeWiki",
                "updated_at": datetime.fromtimestamp(resolved.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
            })
        except (OSError, UnicodeDecodeError, ValueError):
            continue
    return pages


class MemoryInspector:
    def __init__(self, project_loader: Callable[[str], dict | None], client: HindsightClient, knowledge_root: Path | None = None, global_bank_id: str | None = None):
        self.project_loader = project_loader
        self.client = client
        self.knowledge_root = knowledge_root
        self.global_bank_id = global_bank_id

    def project(self, project_id: str) -> dict:
        project = self.project_loader(project_id)
        if not project:
            abort(404, "project not found")
        return deepcopy(project)

    def snapshot(self, project: dict) -> dict:
        bank_id = _bank_id(project)
        health = self.client.request("GET", "/health")
        version = self.client.request("GET", "/version")
        bank_data = self.client.request("GET", "/v1/default/banks")
        banks = bank_data.get("banks") if isinstance(bank_data.get("banks"), list) else []
        bank_exists = any(isinstance(item, dict) and item.get("bank_id") == bank_id for item in banks)
        stats = self.client.request("GET", _path(bank_id, "/stats")) if bank_exists else {}
        document_data = self.client.request("GET", _path(bank_id, "/documents?limit=100&offset=0")) if bank_exists else {"items": [], "total": 0}
        raw_documents = document_data.get("items") if isinstance(document_data.get("items"), list) else []
        documents = [item for value in raw_documents if (item := _document_item(value))]
        memory_data = self.client.request("GET", _path(bank_id, "/memories/list?limit=100&offset=0")) if bank_exists else {"items": [], "total": 0}
        raw_memories = memory_data.get("items") if isinstance(memory_data.get("items"), list) else []
        memories = [item for value in raw_memories if (item := _memory_item(value, documents, bank_id))]
        operations_data = self.client.request("GET", _path(bank_id, "/operations?limit=50&offset=0")) if bank_exists else {"operations": []}
        raw_operations = operations_data.get("operations") if isinstance(operations_data.get("operations"), list) else []
        operations = [item for value in raw_operations if (item := _operation_item(value))]
        audit_data = self.client.request("GET", _path(bank_id, "/audit-logs?limit=50&offset=0")) if bank_exists else {"items": []}
        raw_audit = audit_data.get("items") if isinstance(audit_data.get("items"), list) else []
        audit = [item for value in raw_audit if (item := _audit_item(value))]
        mental_model_data = self.client.request("GET", _path(bank_id, "/mental-models?detail=full&limit=20&offset=0")) if bank_exists else {"items": []}
        raw_mental_models = mental_model_data.get("items") if isinstance(mental_model_data.get("items"), list) else []
        mental_models = [item for value in raw_mental_models if (item := _mental_model_item(value))]
        directive_data = self.client.request("GET", _path(bank_id, "/directives?active_only=true&limit=100&offset=0")) if bank_exists else {"items": []}
        raw_directives = directive_data.get("items") if isinstance(directive_data.get("items"), list) else []
        directives = [item for value in raw_directives if (item := _directive_item(value))]
        graph_data = self.client.request("GET", _path(bank_id, "/entities/graph?limit=250&min_count=1")) if bank_exists else {}
        code_pages = _code_pages(self.knowledge_root, project)
        living_rule_pages = sum(
            1 for item in mental_models
            if re.search(r"\b(rule|policy|decision)", item["name"], re.IGNORECASE)
        )
        failed = sum(1 for item in operations if item["status"] == "failed")
        pending = sum(1 for item in operations if item["status"] in {"pending", "processing", "running"})
        return {
            "schema": SCHEMA,
            "project": {
                "id": _text(project.get("id"), 80),
                "name": _text(project.get("name"), 120),
                "workspace": f"/projects/{_text(project.get('root'), 80)}",
            },
            "provider": {
                "name": "Hindsight",
                "status": "ready" if health.get("status") in {None, "healthy", "ok"} or health.get("ok") else "attention",
                "version": _text(version.get("version") or version.get("api_version"), 80),
                "bank_id": bank_id,
                "bank_exists": bank_exists,
                "isolation": "workspace",
            },
            "counts": {
                "memories": max(len(memories), _count(memory_data.get("total"))),
                "documents": max(len(documents), _count(document_data.get("total"))),
                "pending": max(pending, _count(stats.get("pending_operations"))),
                "failed": max(failed, _count(stats.get("failed_operations"))),
                "pages": len(mental_models),
                "rules": len(directives) + living_rule_pages,
                "code_pages": len(code_pages),
            },
            "knowledge_pages": mental_models,
            "code_pages": code_pages,
            "directives": directives,
            "entity_graph": _entity_graph(graph_data),
            "memories": memories,
            "documents": documents,
            "operations": operations,
            "audit": audit,
        }

    def document(self, project: dict, document_id: str) -> dict:
        bank_id = _bank_id(project)
        document_id = _resource_id(document_id, "document id")
        value = self.client.request("GET", _path(bank_id, f"/documents/{urllib.parse.quote(document_id, safe='')}"))
        summary = _document_item(value) or {"id": document_id, "metadata": {}, "tags": []}
        summary["content"] = _text(value.get("original_text"), 100_000)
        return {"schema": SCHEMA, "bank_id": bank_id, "document": summary}

    def correct_document(self, project: dict, document_id: str, content: str) -> dict:
        bank_id = _bank_id(project)
        document_id = _resource_id(document_id, "document id")
        content = _text(content, 100_000)
        if not content:
            abort(400, "corrected memory source is required")
        existing = self.client.request("GET", _path(bank_id, f"/documents/{urllib.parse.quote(document_id, safe='')}"))
        retain_params = existing.get("retain_params") if isinstance(existing.get("retain_params"), dict) else {}
        metadata = _metadata(existing.get("document_metadata"))
        metadata.update({"source": "frank-memory-inspector", "corrected_by": "steven"})
        tags = [str(tag)[:120] for tag in existing.get("tags", []) if isinstance(tag, str)][:29]
        if "correction" not in tags:
            tags.append("correction")
        payload = {
            "items": [{
                "content": content,
                "context": _text(retain_params.get("context"), 1_000) or "Manual correction in Frank",
                "document_id": document_id,
                "metadata": metadata,
                "tags": tags,
                "update_mode": "replace",
            }],
            "async": False,
        }
        result = self.client.request("POST", _path(bank_id, "/memories"), payload, timeout=120)
        return {"ok": True, "schema": SCHEMA, "bank_id": bank_id, "document_id": document_id, "result": result}

    def forget_document(self, project: dict, document_id: str, confirmation: str) -> dict:
        bank_id = _bank_id(project)
        document_id = _resource_id(document_id, "document id")
        if confirmation != f"FORGET {document_id}":
            abort(409, "exact forget confirmation is required")
        result = self.client.request("DELETE", _path(bank_id, f"/documents/{urllib.parse.quote(document_id, safe='')}"))
        return {"ok": True, "schema": SCHEMA, "bank_id": bank_id, "document_id": document_id, "result": result}

    def promote_document_global(self, project: dict, document_id: str, confirmation: str, idempotency_key: str) -> dict:
        """Explicit "Remember everywhere" promotion into the global operator scope.

        Requires exact confirmation and a stable idempotency key. Provenance
        records the origin bank and document so the promoted copy is always
        traceable; Hindsight re-extracts in the global bank. Never called on
        arbitrary chat prose.
        """
        if not self.global_bank_id:
            abort(503, "global memory scope is not configured")
        document_id = _resource_id(document_id, "document id")
        if confirmation != f"PROMOTE {document_id}":
            abort(409, "exact promotion confirmation is required")
        idempotency_key = _resource_id(idempotency_key, "idempotency key")
        source = self.document(project, document_id)
        content = str(source.get("document", {}).get("content") or "").strip()
        if not content:
            abort(409, "source document has no content to promote")
        origin_bank = source.get("bank_id")
        payload = {
            "items": [{
                "content": content,
                "context": "Global operator preference promoted from project memory in Frank",
                "document_id": f"admitted-promoted-{idempotency_key}",
                "metadata": {
                    "source": "frank-memory-promotion",
                    "origin_bank": origin_bank,
                    "origin_document": document_id,
                    "attributed_to": "steven",
                },
                "tags": ["admitted", "global-preference"],
                "update_mode": "replace",
            }],
            "async": False,
        }
        result = self.client.request("POST", _path(self.global_bank_id, "/memories"), payload, timeout=120)
        return {
            "ok": True, "schema": SCHEMA, "origin_bank": origin_bank, "origin_document": document_id,
            "global_bank_id": self.global_bank_id, "promoted_document_id": f"admitted-promoted-{idempotency_key}",
            "result": result,
        }

    def recall(self, project: dict, query: str) -> dict:
        bank_id = _bank_id(project)
        query = _text(query, 600)
        if not query:
            abort(400, "recall query is required")
        value = self.client.request("POST", _path(bank_id, "/memories/recall"), {
            "query": query, "budget": "mid", "max_tokens": 2048, "trace": True,
        }, timeout=120)
        raw_results = value.get("results") if isinstance(value.get("results"), list) else []
        results = []
        for item in raw_results[:30]:
            if not isinstance(item, dict):
                continue
            results.append({
                "id": _text(item.get("id") or item.get("memory_id"), 200),
                "text": _text(item.get("text") or item.get("content"), 20_000),
                "type": _text(item.get("type") or item.get("fact_type"), 40),
                "score": item.get("score") if isinstance(item.get("score"), (int, float)) else None,
            })
        return {
            "schema": SCHEMA,
            "bank_id": bank_id,
            "query": query,
            "answer": _text(value.get("text") or value.get("answer"), 30_000),
            "results": results,
            "trace": value.get("trace") if isinstance(value.get("trace"), dict) else {},
        }


def _require_same_origin_json() -> None:
    """Strict same-origin + JSON content type for memory mutations."""
    origin = request.headers.get("Origin", "").rstrip("/")
    if not origin:
        abort(403, "same-origin request required")
    base = request.host_url.rstrip("/")
    if origin != base:
        abort(403, "cross-origin memory mutation refused")
    if not (request.content_type or "").startswith("application/json"):
        abort(415, "JSON content type required")


def create_blueprint(inspector: MemoryInspector) -> Blueprint:
    api = Blueprint("memory_inspector", __name__)

    @api.errorhandler(HindsightUnavailable)
    def unavailable(error: HindsightUnavailable):
        return jsonify({"error": str(error)}), error.status

    @api.get("/api/projects/<project_id>/memory")
    def memory_snapshot(project_id: str):
        return jsonify(inspector.snapshot(inspector.project(project_id)))

    @api.post("/api/projects/<project_id>/memory/recall")
    def memory_recall(project_id: str):
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"query"}:
            abort(400, "unsupported recall fields")
        return jsonify(inspector.recall(inspector.project(project_id), body.get("query", "")))

    @api.get("/api/projects/<project_id>/memory/documents/<document_id>")
    def memory_document(project_id: str, document_id: str):
        return jsonify(inspector.document(inspector.project(project_id), document_id))

    @api.put("/api/projects/<project_id>/memory/documents/<document_id>")
    def memory_document_correct(project_id: str, document_id: str):
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"content"}:
            abort(400, "unsupported correction fields")
        return jsonify(inspector.correct_document(inspector.project(project_id), document_id, body.get("content", "")))

    @api.delete("/api/projects/<project_id>/memory/documents/<document_id>")
    def memory_document_forget(project_id: str, document_id: str):
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"confirmation"}:
            abort(400, "unsupported forget fields")
        return jsonify(inspector.forget_document(inspector.project(project_id), document_id, str(body.get("confirmation") or "")))

    @api.post("/api/projects/<project_id>/memory/documents/<document_id>/promote-global")
    def memory_document_promote_global(project_id: str, document_id: str):
        _require_same_origin_json()
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict) or set(body) - {"confirmation", "idempotency_key"}:
            abort(400, "unsupported promotion fields")
        return jsonify(
            inspector.promote_document_global(
                inspector.project(project_id), document_id,
                str(body.get("confirmation") or ""), str(body.get("idempotency_key") or ""),
            )
        )

    return api
