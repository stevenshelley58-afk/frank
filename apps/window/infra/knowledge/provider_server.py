"""Standalone private Hermes Graphiti gateway; Frank never imports this."""

from __future__ import annotations

from datetime import date, datetime, timezone
import asyncio
import json
import logging
import os
import re
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

from provider_contract import MemoryRequest, validate_project_namespace


logger = logging.getLogger(__name__)

TOKEN = os.environ.get("HERMES_GRAPHITI_PROVIDER_TOKEN", "")
ALLOWED = tuple(
    value.strip()
    for value in os.environ.get("HERMES_ALLOWED_NAMESPACES", "").split(",")
    if value.strip()
)
MAX_BODY = 1_048_576
MAX_CONTENT = 256 * 1024
MAX_QUERY = 4_096
MAX_RESULTS = 50
# Correction targets are Graphiti opaque IDs, never namespace-qualified
# references.  Rejecting ':' and '/' prevents a caller from smuggling a
# project/profile identity into a correction episode.
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MEMORY_EXISTS_QUERY = """
MATCH (n)
WHERE n.uuid = $memory_id AND n.group_id = $group_id
RETURN n.uuid AS uuid
LIMIT 1
"""


def parse_allowed_namespaces(raw: str) -> tuple[str, ...]:
    values = tuple(value.strip() for value in raw.split(",") if value.strip())
    if not values:
        raise RuntimeError("HERMES_ALLOWED_NAMESPACES is required")
    if len(set(values)) != len(values):
        raise RuntimeError("HERMES_ALLOWED_NAMESPACES must not contain duplicates")
    for value in values:
        validate_project_namespace(value)
    return values


def validate_startup_config() -> tuple[str, tuple[str, ...]]:
    token = os.environ.get("HERMES_GRAPHITI_PROVIDER_TOKEN", "").strip()
    if not token:
        raise RuntimeError("HERMES_GRAPHITI_PROVIDER_TOKEN is required")
    allowed = parse_allowed_namespaces(os.environ.get("HERMES_ALLOWED_NAMESPACES", ""))
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        raise RuntimeError("OPENAI_API_KEY is required for the Graphiti model")
    for name in ("NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD"):
        if not os.environ.get(name, "").strip():
            raise RuntimeError(f"{name} is required")
    return token, allowed


def _json_safe(value: Any, depth: int = 0) -> Any:
    """Project only bounded JSON primitives; never stringify Graphiti objects."""

    if depth > 3:
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_json_safe(item, depth + 1) for item in value[:32]]
    if isinstance(value, dict):
        return {
            str(key): _json_safe(item, depth + 1)
            for key, item in list(value.items())[:32]
            if isinstance(key, (str, int, float, bool))
        }
    return None


def project_search_hit(hit: Any, namespace: str) -> dict[str, Any] | None:
    """Return an explicit, JSON-safe and namespace-scoped hit projection."""

    group_id = getattr(hit, "group_id", None)
    if group_id != namespace:
        return None
    fields = (
        "uuid",
        "name",
        "fact",
        "valid_at",
        "invalid_at",
        "created_at",
        "expired_at",
        "group_id",
        "source_node_uuid",
        "target_node_uuid",
    )
    return {field: _json_safe(getattr(hit, field, None)) for field in fields}


class GraphitiBackend:
    def __init__(self) -> None:
        from graphiti_core import Graphiti
        from graphiti_core.nodes import EpisodeType

        self._uri = os.environ["NEO4J_URI"]
        self._user = os.environ["NEO4J_USER"]
        self._password = os.environ["NEO4J_PASSWORD"]
        self._graphiti = Graphiti
        self._episode_type = EpisodeType
        self._ready = False
        self._ready_lock = threading.Lock()

    def _new_client(self):
        return self._graphiti(
            self._uri,
            self._user,
            self._password,
            store_raw_episode_content=False,
        )

    async def ready_async(self) -> bool:
        if not os.environ.get("OPENAI_API_KEY", "").strip():
            raise RuntimeError("OPENAI_API_KEY is required for the Graphiti model")
        with self._ready_lock:
            if self._ready:
                return True
            await self._initialize()
            self._ready = True
        return True

    def ready(self) -> bool:
        return asyncio.run(self.ready_async())

    async def _initialize(self) -> None:
        client = None
        try:
            client = self._new_client()
            await client.build_indices_and_constraints()
        finally:
            if client is not None:
                await client.close()

    def call(self, operation: str, namespace: str, payload: dict[str, Any]) -> dict[str, Any]:
        return asyncio.run(self._call(operation, namespace, payload))

    async def _call(
        self, operation: str, namespace: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        client = None
        try:
            client = self._new_client()
            request_id = payload["request_id"]
            if operation == "episode":
                body = {
                    "user_content": payload.get("user_content", ""),
                    "assistant_content": payload.get("assistant_content", ""),
                    "session_id": payload.get("session_id", ""),
                }
                await client.add_episode(
                    name=f"episode-{request_id}",
                    episode_body=json.dumps(body, ensure_ascii=False),
                    source_description=f"hermes:{namespace}",
                    reference_time=datetime.now(timezone.utc),
                    source=self._episode_type.json,
                    group_id=namespace,
                )
                return {
                    "accepted": True,
                    "request_id": request_id,
                    "namespace": namespace,
                    "episode_name": f"episode-{request_id}",
                }
            if operation == "correction_episode":
                if not await self._memory_exists(client, namespace, payload["memory_id"]):
                    raise ValueError("correction target not found in namespace")
                correction_name = f"correction-{request_id}"
                body = {"correction_of": payload["memory_id"], "replacement": payload["replacement"]}
                await client.add_episode(
                    name=correction_name,
                    episode_body=json.dumps(body, ensure_ascii=False),
                    source_description=f"hermes:{namespace}:correction",
                    reference_time=datetime.now(timezone.utc),
                    source=self._episode_type.json,
                    group_id=namespace,
                )
                return {
                    "accepted": True,
                    "request_id": request_id,
                    "namespace": namespace,
                    "episode_name": correction_name,
                    "correction_of": payload["memory_id"],
                }
            if operation == "search":
                hits = await client.search(query=payload["query"], group_ids=[namespace], num_results=payload["limit"])
                results = []
                for hit in hits[:MAX_RESULTS]:
                    projected = project_search_hit(hit, namespace)
                    if projected is not None:
                        results.append(projected)
                return {"namespace": namespace, "results": results}
            raise ValueError("unsupported_operation")
        finally:
            if client is not None:
                await client.close()

    async def _memory_exists(self, client: Any, namespace: str, memory_id: str) -> bool:
        driver = getattr(client, "driver", None)
        if driver is None:
            raise RuntimeError("Graphiti driver is unavailable for correction validation")
        result = await driver.execute_query(
            MEMORY_EXISTS_QUERY,
            memory_id=memory_id,
            group_id=namespace,
        )
        records = result.records if hasattr(result, "records") else result[0] if isinstance(result, tuple) else result
        for record in records or []:
            if hasattr(record, "data"):
                record = record.data()
            if isinstance(record, dict) and record.get("uuid") == memory_id:
                return True
        return False


def _expect_object(payload: Any, allowed: set[str], required: set[str]) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) - allowed or not required.issubset(payload):
        raise ValueError("invalid payload")
    return payload


def _validate_payload(operation: str, payload: Any) -> dict[str, Any]:
    if operation == "episode":
        data = _expect_object(
            payload,
            {"request_id", "user_content", "assistant_content", "session_id"},
            {"request_id", "user_content", "assistant_content"},
        )
        if not all(isinstance(data[name], str) for name in ("user_content", "assistant_content")):
            raise ValueError("episode content must be strings")
        if len(data["user_content"]) > MAX_CONTENT or len(data["assistant_content"]) > MAX_CONTENT:
            raise ValueError("episode content is too large")
        if "session_id" in data and (
            not isinstance(data["session_id"], str) or len(data["session_id"]) > 256
        ):
            raise ValueError("session_id is invalid")
        return data
    if operation == "correction_episode":
        data = _expect_object(
            payload,
            {"request_id", "memory_id", "replacement"},
            {"request_id", "memory_id", "replacement"},
        )
        if (
            not isinstance(data["memory_id"], str)
            or SAFE_ID.fullmatch(data["memory_id"]) is None
            or not isinstance(data["replacement"], str)
            or len(data["replacement"]) > MAX_CONTENT
        ):
            raise ValueError("correction payload is invalid")
        return data
    if operation == "search":
        data = _expect_object(payload, {"request_id", "query", "limit"}, {"request_id", "query"})
        if not isinstance(data["query"], str) or not data["query"].strip() or len(data["query"]) > MAX_QUERY:
            raise ValueError("query is invalid")
        limit = data.get("limit", 20)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_RESULTS:
            raise ValueError("limit is invalid")
        data["limit"] = limit
        return data
    raise ValueError("unsupported operation")


class Handler(BaseHTTPRequestHandler):
    backend: GraphitiBackend | Any = None

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("gateway request %s", args[0] if args else "")

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
        if len(raw) > MAX_BODY:
            status = 502
            raw = b'{"error":"response_too_large"}'
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def auth(self) -> bool:
        return bool(TOKEN) and secrets.compare_digest(
            self.headers.get("Authorization", ""), "Bearer " + TOKEN
        )

    def body(self) -> Any:
        length = self.headers.get("Content-Length", "")
        if not length.isdigit() or int(length) < 1 or int(length) > MAX_BODY:
            raise ValueError("invalid_content_length")
        raw = self.rfile.read(int(length))
        if len(raw) != int(length):
            raise ValueError("truncated_body")
        return json.loads(raw)

    def do_GET(self) -> None:
        request_path = urlsplit(self.path)
        if request_path.path == "/healthz":
            self.send_json(200, {"ok": True})
            return
        if request_path.path == "/readyz":
            try:
                self.backend.ready()
            except Exception:
                self.send_json(503, {"ready": False})
            else:
                self.send_json(200, {"ready": True})
            return
        self.send_json(404, {"error": "not_found"})

    def dispatch(self, operation: str, payload: Any) -> None:
        if not self.auth():
            self.send_json(401, {"error": "unauthorized"})
            return
        namespace = self.headers.get("X-Hermes-Namespace", "")
        if namespace not in ALLOWED:
            self.send_json(403, {"error": "namespace_forbidden"})
            return
        try:
            data = _validate_payload(operation, payload)
            request = MemoryRequest(namespace, data.get("request_id", ""), operation)
            request.validate()
            result = self.backend.call(operation, namespace, data)
        except ValueError:
            self.send_json(400, {"error": "invalid_request"})
        except Exception as exc:
            # Do not log exception text: Graphiti/OpenAI errors can echo
            # request content or provider credentials.
            logger.warning("Graphiti backend request failed (%s)", type(exc).__name__)
            self.send_json(502, {"error": "provider_unavailable"})
        else:
            self.send_json(200, result)

    def do_POST(self) -> None:
        routes = {
            "/v1/episodes": "episode",
            "/v1/search": "search",
            "/v1/corrections": "correction_episode",
        }
        operation = routes.get(self.path)
        if operation is None:
            self.send_json(404, {"error": "not_found"})
            return
        try:
            payload = self.body()
        except (ValueError, json.JSONDecodeError):
            self.send_json(413, {"error": "invalid_body"})
            return
        self.dispatch(operation, payload)


def main() -> None:
    global ALLOWED, TOKEN

    TOKEN, ALLOWED = validate_startup_config()
    Handler.backend = GraphitiBackend()
    bind_host = os.getenv("BIND_HOST", "127.0.0.1")
    bind_port = int(os.getenv("BIND_PORT", "8091"))
    server = ThreadingHTTPServer((bind_host, bind_port), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
