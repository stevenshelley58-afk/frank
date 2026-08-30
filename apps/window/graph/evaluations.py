"""Bounded, fresh-context evaluations for canonical rules and skills.

The runner is intentionally an adapter seam: Hermes (or a selected evaluator)
supplies a callable, while this module owns task validation, deterministic
scoring and receipt-shaped evidence.  No chat, prompt, memory or model output
is persisted in the result.
"""
from __future__ import annotations

import copy
import hashlib
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping, Sequence

from .control_plane import canonical_bytes


class EvaluationError(ValueError):
    """Raised when an evaluation would be unsafe, unbounded or ambiguous."""


MAX_TASKS = 100
MAX_TEXT = 4000
_ALLOWED_TASK_KEYS = frozenset({"id", "kind", "scope", "input", "expected", "source_ids"})
_FORBIDDEN_KEYS = frozenset({"prompt", "transcript", "messages", "conversation", "memory", "chain_of_thought", "reasoning"})
_ID = re.compile(r"^(?:rule|skill|eval|project|receipt):[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$")


def _digest(value: object) -> str:
    return "sha256:" + hashlib.sha256(canonical_bytes(value)).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe(value: object, path: str = "value") -> None:
    if isinstance(value, str):
        if len(value) > MAX_TEXT:
            raise EvaluationError(f"{path} exceeds bounded length")
        return
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = key.casefold().replace("-", "_") if isinstance(key, str) else ""
            if (not isinstance(key, str) or normalized in _FORBIDDEN_KEYS
                    or any(token in normalized for token in ("transcript", "conversation_body", "chain_of_thought"))):
                raise EvaluationError(f"private evaluation field at {path}")
            _safe(child, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        if len(value) > 100:
            raise EvaluationError(f"{path} exceeds bounded list length")
        for index, child in enumerate(value):
            _safe(child, f"{path}[{index}]")
    elif isinstance(value, float) and not math.isfinite(value):
        raise EvaluationError(f"non-finite value at {path}")
    elif value is not None and type(value) not in (bool, int, float):
        raise EvaluationError(f"unsupported value at {path}")


def normalize_task(task: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(task, Mapping) or set(task) - _ALLOWED_TASK_KEYS:
        raise EvaluationError("golden task has unsupported fields")
    required = {"id", "kind", "scope", "input", "expected"}
    if not required.issubset(task):
        raise EvaluationError("golden task is incomplete")
    values = {key: copy.deepcopy(task[key]) for key in task}
    for key in ("id", "kind", "scope"):
        if not isinstance(values[key], str) or not values[key] or len(values[key]) > 160:
            raise EvaluationError(f"invalid task {key}")
    _safe(values["input"], "task.input")
    _safe(values["expected"], "task.expected")
    sources = values.get("source_ids", [])
    if not isinstance(sources, list) or any(not isinstance(item, str) or not item for item in sources):
        raise EvaluationError("task.source_ids must be a list of IDs")
    values["source_ids"] = sorted(set(sources))
    return values


def _score(expected: Any, actual: Any) -> tuple[bool, float]:
    """Deterministic structural score; evaluator output is never retained."""
    if expected == actual:
        return True, 1.0
    if isinstance(expected, Mapping) and isinstance(actual, Mapping) and expected:
        matched = sum(key in actual and actual[key] == value for key, value in expected.items())
        score = matched / len(expected)
        return score == 1.0, score
    if isinstance(expected, list) and isinstance(actual, list) and expected:
        matched = sum(item in actual for item in expected)
        score = matched / len(expected)
        return score == 1.0, score
    return False, 0.0


def run_evaluation(
    tasks: Sequence[Mapping[str, Any]],
    evaluator: Callable[[Mapping[str, Any]], Any],
    *,
    source_revisions: Mapping[str, str],
    evaluation_id: str = "eval:rules-skills/regression",
    timeout_seconds: int = 1800,
) -> dict[str, Any]:
    """Run a bounded suite with a fresh task context for every invocation.

    The callable receives only one normalized task and its return value is
    scored in memory. Exceptions/timeouts become failures rather than leaking
    their message (which could contain private model context).
    """
    if not isinstance(tasks, Sequence) or isinstance(tasks, (str, bytes)) or not tasks or len(tasks) > MAX_TASKS:
        raise EvaluationError("evaluation task count is outside bounds")
    if not isinstance(source_revisions, Mapping) or not source_revisions or any(not isinstance(k, str) or not isinstance(v, str) or not v for k, v in source_revisions.items()):
        raise EvaluationError("source revisions are required")
    if not isinstance(timeout_seconds, int) or timeout_seconds < 1 or timeout_seconds > 1800:
        raise EvaluationError("invalid evaluation timeout")
    normalized = [normalize_task(task) for task in tasks]
    if len({task["id"] for task in normalized}) != len(normalized):
        raise EvaluationError("golden task IDs must be unique")
    started = time.monotonic()
    deadline = started + timeout_seconds
    results = []
    for task in normalized:
        if time.monotonic() >= deadline:
            results.append({"task_id": task["id"], "kind": task["kind"], "scope": task["scope"], "score": 0.0, "outcome": "timeout", "source_ids": task["source_ids"]})
            continue
        try:
            # Deep copy prevents an evaluator from mutating the suite fixture.
            remaining = max(0.001, deadline - time.monotonic())
            pool = ThreadPoolExecutor(max_workers=1)
            future = pool.submit(evaluator, copy.deepcopy(task))
            try:
                actual = future.result(timeout=remaining)
            except FutureTimeout:
                future.cancel()
                pool.shutdown(wait=False, cancel_futures=True)
                raise TimeoutError
            else:
                pool.shutdown(wait=True)
            if time.monotonic() > deadline:
                raise TimeoutError
            _safe(actual, "evaluator.result")
            passed, score = _score(task["expected"], actual)
            outcome = "pass" if passed else "fail"
        except Exception:
            actual, score, outcome = None, 0.0, "error"
        results.append({"task_id": task["id"], "kind": task["kind"], "scope": task["scope"], "score": score, "outcome": outcome, "source_ids": task["source_ids"]})
    captured = _now()
    suite_hash = _digest(normalized)
    return {
        "schema": "frank.evaluation-run/v1", "evaluation_id": evaluation_id,
        "suite_hash": suite_hash, "source_revisions": dict(sorted(source_revisions.items())),
        "captured_at": captured, "fresh_until": (datetime.now(timezone.utc) + timedelta(days=8)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "results": results, "passed": all(item["outcome"] == "pass" for item in results),
        "task_count": len(results), "elapsed_seconds": round(time.monotonic() - started, 3),
        "mutated": False,
    }


def make_receipt(result: Mapping[str, Any], *, receipt_id: str, producer: str = "runtime:hermes-default") -> dict[str, Any]:
    if not isinstance(receipt_id, str) or not _ID.fullmatch(receipt_id) or not receipt_id.startswith("receipt:"):
        raise EvaluationError("evaluation receipt ID is invalid")
    if not isinstance(result, Mapping) or not isinstance(result.get("evaluation_id"), str) or not _ID.fullmatch(result["evaluation_id"]):
        raise EvaluationError("evaluation ID is invalid")
    payload = {"evaluation_id": result.get("evaluation_id"), "suite_hash": result.get("suite_hash"), "source_revisions": result.get("source_revisions"), "results": result.get("results", [])}
    return {"id": receipt_id, "kind": "evaluation_run", "subject_ids": [str(result.get("evaluation_id", "eval:rules-skills/regression"))], "producer": producer, "source_revision_set": dict(result.get("source_revisions", {})), "deployed_revision_set": {}, "captured_at": result.get("captured_at", _now()), "fresh_until": result.get("fresh_until"), "outcome": "pass" if result.get("passed") else "fail", "evidence_uris": [f"evaluation/{_digest(payload)[7:]}.json"], "redaction": "secret_filtered", "schema": "frank.evaluation-run/v1", "facts": {"suite_hash": result.get("suite_hash"), "task_count": result.get("task_count", 0), "mutated": False}}


__all__ = ["EvaluationError", "make_receipt", "normalize_task", "run_evaluation"]
