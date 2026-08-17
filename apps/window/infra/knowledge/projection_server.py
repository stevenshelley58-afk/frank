"""Dedicated read-only Frank projection listener.

This process intentionally has no episode, search, correction, or Graphiti
mutation routes.  It is the only knowledge service attached to Frank's
external Docker network.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from knowledge_projection import build_combined_projection, validate_project

logger = logging.getLogger(__name__)
TOKEN = ""
ALLOWED: tuple[str, ...] = ()
VAULT_DIR = ""
GRAPHIFY_DIR = ""
MAX_BODY = 8 * 1024 * 1024
KNOWLEDGE_LENS = "knowledge.combined"
FIXED_PROJECT = "project/frank"
MAX_RECORDS = 10_000
PROJECTION_QUERY = """
MATCH (n)
WHERE n.group_id = $group_id
RETURN n.uuid AS uuid, n.name AS name,
       n.valid_at AS valid_at, n.invalid_at AS invalid_at,
       n.created_at AS created_at, n.expired_at AS expired_at,
       n.group_id AS group_id,
       null AS source_node_uuid, null AS target_node_uuid
UNION ALL
MATCH (source)-[r]->(target)
WHERE source.group_id = $group_id AND target.group_id = $group_id
RETURN null AS uuid, null AS name,
       null AS valid_at, null AS invalid_at,
       null AS created_at, null AS expired_at,
       $group_id AS group_id,
       source.uuid AS source_node_uuid, target.uuid AS target_node_uuid
LIMIT 10000
"""


class Neo4jProjectionBackend:
    """Read-only Neo4j metadata adapter for the Frank projection listener.

    This process deliberately uses the pinned Neo4j driver directly. It does
    not import or construct Graphiti, so the Frank-facing container requires
    no model client or ``OPENAI_API_KEY`` and has no mutation methods.
    """

    def __init__(self, uri: str, user: str, password: str, *, driver_factory=None):
        if driver_factory is None:
            from neo4j import GraphDatabase

            driver_factory = GraphDatabase.driver
        self._driver = driver_factory(uri, auth=(user, password))

    def projection_records(self, project: str) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        with self._driver.session() as session:
            result = session.run(PROJECTION_QUERY, group_id=project)
            for record in result:
                if hasattr(record, "data"):
                    record = record.data()
                if isinstance(record, dict) and record.get("group_id") == project:
                    records.append(record)
                    if len(records) >= MAX_RECORDS:
                        break
        return records

    def close(self) -> None:
        self._driver.close()


def _source_file(root: str, project: str, names: tuple[str, ...]) -> str | None:
    base = Path(root)
    for name in names:
        candidate = base / project / name
        try:
            if candidate.is_file() and not candidate.is_symlink():
                return str(candidate)
        except OSError:
            continue
    return None


def validate_config() -> tuple[str, tuple[str, ...]]:
    token = os.environ.get("FRANK_KNOWLEDGE_PROJECTION_TOKEN", "").strip()
    if not token:
        raise RuntimeError("FRANK_KNOWLEDGE_PROJECTION_TOKEN is required")
    raw = os.environ.get("FRANK_KNOWLEDGE_ALLOWED_PROJECTS", "")
    projects = tuple(value.strip() for value in raw.split(",") if value.strip())
    if projects != (FIXED_PROJECT,):
        raise RuntimeError("FRANK_KNOWLEDGE_ALLOWED_PROJECTS must be exactly project/frank")
    for project in projects:
        validate_project(project)
    return token, projects


def make_projection(project: str) -> dict[str, Any]:
    project = validate_project(project)
    records = Handler.backend.projection_records(project)
    vault = _source_file(VAULT_DIR, project, ("vault-projection.json", "vault.json"))
    graphify = _source_file(GRAPHIFY_DIR, project, ("graph.json", "graphify-out/graph.json", "graphify/graphify-out/graph.json"))
    return build_combined_projection(project, graphiti=records, vault=vault, graphify=graphify)


class Handler(BaseHTTPRequestHandler):
    backend: Neo4jProjectionBackend | Any = None

    def log_message(self, format: str, *args: Any) -> None:
        logger.info("projection request %s", args[0] if args else "")

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
        if len(raw) > MAX_BODY:
            status, raw = 502, b'{"error":"response_too_large"}'
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/healthz":
            self.send_json(200, {"ok": True, "mode": "projection-only"})
            return
        if parsed.path == "/readyz":
            self.send_json(200, {"ready": True, "mode": "projection-only"})
            return
        if parsed.path != "/v2/knowledge/projection":
            self.send_json(404, {"error": "not_found"})
            return
        if not TOKEN or not secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            self.send_json(401, {"error": "unauthorized"})
            return
        query = parse_qs(parsed.query, keep_blank_values=True)
        if (
            set(query) != {"project", "lens"}
            or len(query.get("project", [])) != 1
            or len(query.get("lens", [])) != 1
            or query["lens"][0] != KNOWLEDGE_LENS
        ):
            self.send_json(400, {"error": "invalid_request"})
            return
        project = query["project"][0]
        if project not in ALLOWED:
            self.send_json(403, {"error": "project_forbidden"})
            return
        try:
            result = make_projection(project)
        except Exception as exc:
            logger.warning("projection failed (%s)", type(exc).__name__)
            self.send_json(503, {"error": "projection_unavailable"})
        else:
            self.send_json(200, result)

    def do_POST(self) -> None:
        self.send_json(405, {"error": "projection_get_only"})


def main() -> None:
    global TOKEN, ALLOWED, VAULT_DIR, GRAPHIFY_DIR
    TOKEN, ALLOWED = validate_config()
    VAULT_DIR = os.environ.get("FRANK_KNOWLEDGE_VAULT_DIR", "/knowledge")
    GRAPHIFY_DIR = os.environ.get("FRANK_KNOWLEDGE_GRAPHIFY_DIR", "/knowledge")
    Handler.backend = Neo4jProjectionBackend(
        os.environ["NEO4J_URI"],
        os.environ["NEO4J_USER"],
        os.environ["NEO4J_PASSWORD"],
    )
    server = ThreadingHTTPServer((os.getenv("BIND_HOST", "0.0.0.0"), int(os.getenv("BIND_PORT", "8092"))), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        Handler.backend.close()


if __name__ == "__main__":
    main()
