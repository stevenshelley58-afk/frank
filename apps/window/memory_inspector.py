"""Project-scoped, display-only bridge to Hermes-owned Hindsight memory."""
from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Callable
import urllib.error
import urllib.parse
import urllib.request

from flask import Blueprint, abort, jsonify, request


SCHEMA = "schema://frank.memory-inspector/v1"
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$")
_SAFE_BANK_PART = re.compile(r"[^A-Za-z0-9_-]+")
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

    def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=body, headers=headers, method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
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


class MemoryInspector:
    def __init__(self, project_loader: Callable[[str], dict | None], client: HindsightClient):
        self.project_loader = project_loader
        self.client = client

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
            },
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
        result = self.client.request("POST", _path(bank_id, "/memories"), payload)
        return {"ok": True, "schema": SCHEMA, "bank_id": bank_id, "document_id": document_id, "result": result}

    def forget_document(self, project: dict, document_id: str, confirmation: str) -> dict:
        bank_id = _bank_id(project)
        document_id = _resource_id(document_id, "document id")
        if confirmation != f"FORGET {document_id}":
            abort(409, "exact forget confirmation is required")
        result = self.client.request("DELETE", _path(bank_id, f"/documents/{urllib.parse.quote(document_id, safe='')}"))
        return {"ok": True, "schema": SCHEMA, "bank_id": bank_id, "document_id": document_id, "result": result}

    def recall(self, project: dict, query: str) -> dict:
        bank_id = _bank_id(project)
        query = _text(query, 600)
        if not query:
            abort(400, "recall query is required")
        value = self.client.request("POST", _path(bank_id, "/memories/recall"), {
            "query": query, "budget": "mid", "max_tokens": 2048, "trace": True,
        })
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

    return api
