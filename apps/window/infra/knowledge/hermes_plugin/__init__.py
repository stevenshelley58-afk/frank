"""Hermes MemoryProvider adapter for the private Graphiti gateway."""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError
import json
import logging
import os
import re
import threading
from typing import Any
from urllib.parse import urlparse
import urllib.error
import urllib.request

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

MAX_RESPONSE = 512 * 1024
MAX_QUERY = 4_096
MAX_CONTENT = 256 * 1024
PREFETCH_WAIT_SECONDS = 0.25
SHUTDOWN_WAIT_SECONDS = 0.5
MAX_PREFETCH_TASKS = 2
MAX_SYNC_TASKS = 8
NAMESPACE_RE = re.compile(r"^project/[a-z0-9][a-z0-9._-]{0,63}$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
MEMORY_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def validate_project_namespace(namespace: Any) -> str:
    if not isinstance(namespace, str) or NAMESPACE_RE.fullmatch(namespace) is None:
        raise ValueError("namespace must be project/<id>")
    return namespace


def _configured_namespace() -> str:
    namespace = validate_project_namespace(os.environ.get("HERMES_GRAPHITI_NAMESPACE", ""))
    allowed = tuple(item.strip() for item in os.environ.get("HERMES_ALLOWED_NAMESPACES", "").split(",") if item.strip())
    if allowed != (namespace,):
        raise RuntimeError("Graphiti memory requires exactly one matching Hermes namespace")
    return namespace


def validate_request_id(request_id: Any) -> str:
    if not isinstance(request_id, str) or REQUEST_ID_RE.fullmatch(request_id) is None:
        raise ValueError("request_id is required and bounded")
    return request_id


def _provider_url() -> str:
    value = os.environ.get("HERMES_GRAPHITI_PROVIDER_URL", "").strip()
    parsed = urlparse(value)
    allowed_hosts = {item.strip().lower() for item in os.environ.get("HERMES_GRAPHITI_ALLOWED_HOSTS", "127.0.0.1,localhost,hermes-graphiti-provider").split(",") if item.strip()}
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or (parsed.hostname or "").lower() not in allowed_hosts:
        raise RuntimeError("HERMES_GRAPHITI_PROVIDER_URL must be an absolute HTTP URL")
    return value.rstrip("/")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, *args, **kwargs):
        raise urllib.error.HTTPError(req.full_url, 502, "redirects are disabled", {}, None)


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _call(method: str, path: str, namespace: str, payload: dict[str, Any] | None = None) -> Any:
    """Call the gateway without putting credentials or content in logs."""

    validate_project_namespace(namespace)
    token = os.environ.get("HERMES_GRAPHITI_PROVIDER_TOKEN", "")
    if not token:
        raise RuntimeError("HERMES_GRAPHITI_PROVIDER_TOKEN is required")

    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(
        _provider_url() + path,
        data=body,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "X-Hermes-Namespace": namespace,
            "Content-Type": "application/json",
        },
    )
    with _OPENER.open(request, timeout=3.0) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise RuntimeError("provider response too large")
    return json.loads(raw)


class GraphitiMemoryProvider(MemoryProvider):
    """Single Hermes memory provider backed by the private gateway."""

    @property
    def name(self) -> str:
        return "frank-graphiti-memory"

    def is_available(self) -> bool:
        """Check local configuration only; never make a network call here."""

        try:
            _provider_url()
            if not os.environ.get("HERMES_GRAPHITI_PROVIDER_TOKEN"):
                return False
            _configured_namespace()
            return True
        except (RuntimeError, ValueError):
            return False

    def initialize(self, session_id: str, **kwargs) -> None:
        namespace = _configured_namespace()
        if not os.environ.get("HERMES_GRAPHITI_PROVIDER_TOKEN"):
            raise RuntimeError("HERMES_GRAPHITI_PROVIDER_TOKEN is required")
        _provider_url()

        self._session_id = session_id
        self._namespace = namespace
        self._state_lock = threading.RLock()
        self._closed = False
        self._prefetch_executor = ThreadPoolExecutor(
            max_workers=MAX_PREFETCH_TASKS,
            thread_name_prefix="frank-graphiti-prefetch",
        )
        self._sync_executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="frank-graphiti-sync",
        )
        self._prefetch_slots = threading.BoundedSemaphore(MAX_PREFETCH_TASKS)
        self._sync_slots = threading.BoundedSemaphore(MAX_SYNC_TASKS)
        self._prefetch_futures: dict[tuple[str, str], Future[Any]] = {}
        self._prefetch_results: dict[tuple[str, str], tuple[int, str]] = {}
        self._prefetch_generation = 0
        self._current_prefetch_key: tuple[str, str] | None = None
        self._sync_futures: set[Future[Any]] = set()

    def system_prompt_block(self) -> str:
        return "Private Graphiti recall is available through Hermes."

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        if isinstance(message, str) and message.strip():
            self.queue_prefetch(message, session_id=kwargs.get("session_id", ""))

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """Start recall for exactly one future query, bounded and non-blocking."""

        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY:
            return
        key = (session_id or self._session_id, query)
        with self._state_lock:
            if self._closed:
                return
            self._select_prefetch_key_locked(key)
            if key in self._prefetch_results or key in self._prefetch_futures:
                return
            if not self._prefetch_slots.acquire(blocking=False):
                logger.warning("Graphiti prefetch capacity reached; skipping query")
                return
            generation = self._prefetch_generation
            try:
                future = self._prefetch_executor.submit(
                    self._run_prefetch, key, generation
                )
            except Exception:
                self._prefetch_slots.release()
                logger.warning("Graphiti prefetch submission failed")
                return
            self._prefetch_futures[key] = future

    def _select_prefetch_key_locked(self, key: tuple[str, str]) -> None:
        if self._current_prefetch_key == key:
            return
        self._current_prefetch_key = key
        self._prefetch_generation += 1
        self._prefetch_results.clear()

    def _run_prefetch(self, key: tuple[str, str], generation: int) -> None:
        try:
            result = self.search(
                self._namespace,
                "prefetch-" + os.urandom(8).hex(),
                key[1],
            )
            rendered = json.dumps(result, separators=(",", ":"), ensure_ascii=False)
        except Exception:
            logger.warning("Graphiti prefetch failed (%s)", "backend_error")
            rendered = ""
        finally:
            with self._state_lock:
                self._prefetch_futures.pop(key, None)
                if (
                    not self._closed
                    and self._current_prefetch_key == key
                    and self._prefetch_generation == generation
                ):
                    self._prefetch_results[key] = (generation, rendered)
            self._prefetch_slots.release()

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Recall only ``query`` and wait briefly on the hot path."""

        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY:
            return ""
        key = (session_id or self._session_id, query)
        with self._state_lock:
            if self._closed:
                return ""
            self._select_prefetch_key_locked(key)
            cached = self._prefetch_results.pop(key, None)
            future = self._prefetch_futures.get(key)
            if cached is not None:
                return cached[1]
        if future is None:
            self.queue_prefetch(query, session_id=session_id)
            with self._state_lock:
                future = self._prefetch_futures.get(key)
        if future is not None:
            try:
                future.result(timeout=PREFETCH_WAIT_SECONDS)
            except TimeoutError:
                pass
            except Exception:
                logger.warning("Graphiti prefetch future failed")
        with self._state_lock:
            cached = self._prefetch_results.pop(key, None)
            if self._current_prefetch_key != key:
                return ""
            return cached[1] if cached is not None else ""

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: list[dict[str, Any]] | None = None,
    ) -> None:
        """Queue a bounded write without sharing prefetch synchronization."""

        if not isinstance(user_content, str) or not isinstance(assistant_content, str):
            return
        if len(user_content) > MAX_CONTENT or len(assistant_content) > MAX_CONTENT:
            logger.warning("Graphiti sync content exceeds configured bound")
            return
        with self._state_lock:
            if self._closed or not self._sync_slots.acquire(blocking=False):
                logger.warning("Graphiti sync capacity reached; skipping turn")
                return
            try:
                future = self._sync_executor.submit(
                    self._run_sync,
                    user_content,
                    assistant_content,
                    session_id or self._session_id,
                )
            except Exception:
                self._sync_slots.release()
                logger.warning("Graphiti sync submission failed")
                return
            self._sync_futures.add(future)
            future.add_done_callback(self._sync_done)

    def _sync_done(self, future: Future[Any]) -> None:
        with self._state_lock:
            self._sync_futures.discard(future)

    def _run_sync(self, user_content: str, assistant_content: str, session_id: str) -> None:
        try:
            self.add(
                self._namespace,
                "turn-" + os.urandom(8).hex(),
                {
                    "user_content": user_content,
                    "assistant_content": assistant_content,
                    "session_id": session_id,
                },
            )
        except Exception:
            logger.warning("Graphiti sync failed")
        finally:
            self._sync_slots.release()

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        return []

    def handle_tool_call(self, tool_name: str, args: dict[str, Any], **kwargs) -> str:
        return json.dumps({"error": "no tools exposed"})

    def shutdown(self) -> None:
        with self._state_lock:
            if self._closed:
                return
            self._closed = True
            futures = list(self._prefetch_futures.values()) + list(self._sync_futures)
            for future in futures:
                future.cancel()
            prefetch_executor = self._prefetch_executor
            sync_executor = self._sync_executor
        prefetch_executor.shutdown(wait=False, cancel_futures=True)
        sync_executor.shutdown(wait=False, cancel_futures=True)
        for future in futures:
            try:
                future.result(timeout=SHUTDOWN_WAIT_SECONDS)
            except (TimeoutError, Exception):
                pass

    def get_config_schema(self) -> list[dict[str, Any]]:
        return [
            {
                "key": "provider_url",
                "description": "Private Hermes Graphiti gateway URL",
                "required": True,
                "env_var": "HERMES_GRAPHITI_PROVIDER_URL",
                "secret": False,
                "type": "text",
            },
            {
                "key": "provider_token",
                "description": "Hermes Graphiti gateway bearer token",
                "required": True,
                "env_var": "HERMES_GRAPHITI_PROVIDER_TOKEN",
                "secret": True,
                "type": "text",
            },
            {
                "key": "namespace",
                "description": "Explicit project namespace (project/<id>)",
                "required": True,
                "env_var": "HERMES_GRAPHITI_NAMESPACE",
                "secret": False,
                "type": "text",
            },
        ]

    def add(self, namespace: str, request_id: str, episode: dict[str, Any]) -> Any:
        validate_project_namespace(namespace)
        validate_request_id(request_id)
        if not isinstance(episode, dict):
            raise ValueError("episode must be an object")
        payload = {"request_id": request_id}
        for key in ("user_content", "assistant_content", "session_id"):
            if key in episode:
                payload[key] = episode[key]
        return _call("POST", "/v1/episodes", namespace, payload)

    def search(self, namespace: str, request_id: str, query: str, limit: int = 20) -> Any:
        validate_project_namespace(namespace)
        validate_request_id(request_id)
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY:
            raise ValueError("query is required and bounded")
        if isinstance(limit, bool) or not isinstance(limit, int):
            raise ValueError("limit must be an integer")
        return _call(
            "POST",
            "/v1/search",
            namespace,
            {"request_id": request_id, "query": query, "limit": max(1, min(limit, 50))},
        )

    def correct(
        self, namespace: str, request_id: str, memory_id: str, replacement: str
    ) -> Any:
        validate_project_namespace(namespace)
        validate_request_id(request_id)
        if not isinstance(memory_id, str) or MEMORY_ID_RE.fullmatch(memory_id) is None:
            raise ValueError("memory_id must be an opaque target ID")
        if not isinstance(replacement, str) or len(replacement) > MAX_CONTENT:
            raise ValueError("replacement is required and bounded")
        return _call(
            "POST",
            "/v1/corrections",
            namespace,
            {
                "request_id": request_id,
                "memory_id": memory_id,
                "replacement": replacement,
            },
        )


def register(ctx) -> None:
    """Hermes' one-argument memory plugin entry point."""

    ctx.register_memory_provider(GraphitiMemoryProvider())
