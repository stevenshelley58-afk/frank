"""Validation and payload helpers for the bounded template review facade."""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

PROJECT_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
PLACEMENTS = frozenset({"feed", "story"})


class ReviewChatError(ValueError):
    pass


def _text(value: Any, field: str, maximum: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise ReviewChatError(f"{field} must be a string")
    value = value.strip()
    if required and not value:
        raise ReviewChatError(f"{field} is required")
    if len(value) > maximum:
        raise ReviewChatError(f"{field} exceeds {maximum} characters")
    return value


def validate_review_message(body: Any) -> dict:
    if not isinstance(body, Mapping):
        raise ReviewChatError("review body must be an object")
    required = {"project_id", "message", "annotations", "expected_revision", "idempotency_key"}
    if set(body) != required:
        raise ReviewChatError("review body contains unsupported or missing fields")
    project_id = _text(body["project_id"], "project_id", 48, required=True)
    if not PROJECT_ID.fullmatch(project_id):
        raise ReviewChatError("project_id is invalid")
    message = _text(body["message"], "message", 1200)
    expected = body["expected_revision"]
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
        raise ReviewChatError("expected_revision is invalid")
    key = _text(body["idempotency_key"], "idempotency_key", 128, required=True)
    if not IDEMPOTENCY_KEY.fullmatch(key):
        raise ReviewChatError("idempotency_key is invalid")
    raw_annotations = body["annotations"]
    if not isinstance(raw_annotations, list) or len(raw_annotations) > 8:
        raise ReviewChatError("annotations must contain no more than 8 items")
    annotations = []
    total = len(message)
    for item in raw_annotations:
        if not isinstance(item, Mapping) or set(item) != {"placement", "x", "y", "width", "height", "message"}:
            raise ReviewChatError("annotation fields are invalid")
        placement = item["placement"]
        if placement not in PLACEMENTS:
            raise ReviewChatError("annotation placement is invalid")
        numbers = []
        for field in ("x", "y", "width", "height"):
            value = item[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                raise ReviewChatError("annotation geometry must be finite numbers")
            numbers.append(float(value))
        x, y, width, height = numbers
        if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > 1 or y + height > 1:
            raise ReviewChatError("annotation rectangle must be contained in the canvas")
        note = _text(item["message"], "annotation message", 200, required=not bool(message))
        total += len(note)
        annotations.append({"placement": placement, "x": round(x, 6), "y": round(y, 6), "width": round(width, 6), "height": round(height, 6), "message": note})
    if not message and not annotations:
        raise ReviewChatError("review needs a message or annotation")
    if total > 4000:
        raise ReviewChatError("review instructions exceed 4,000 characters")
    return {"project_id": project_id, "message": message, "annotations": annotations, "expected_revision": expected, "idempotency_key": key}


def hermes_review_payload(review: Mapping[str, Any]) -> dict:
    return {"project_id": review["project_id"], "review": {"message": review["message"], "annotations": review["annotations"]}, "expected_revision": review["expected_revision"], "idempotency_key": review["idempotency_key"]}


def validate_undo_body(body: Any) -> dict:
    if not isinstance(body, Mapping) or set(body) != {"project_id", "expected_revision", "idempotency_key"}:
        raise ReviewChatError("undo body contains unsupported or missing fields")
    project_id = _text(body["project_id"], "project_id", 48, required=True)
    if not PROJECT_ID.fullmatch(project_id): raise ReviewChatError("project_id is invalid")
    expected = body["expected_revision"]
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1: raise ReviewChatError("expected_revision is invalid")
    key = _text(body["idempotency_key"], "idempotency_key", 128, required=True)
    if not IDEMPOTENCY_KEY.fullmatch(key): raise ReviewChatError("idempotency_key is invalid")
    return {"project_id": project_id, "expected_revision": expected, "idempotency_key": key}


def hermes_undo_payload(body: Mapping[str, Any], revision_id: str) -> dict:
    return {"project_id": body["project_id"], "review": {"message": "Restore previous revision", "annotations": []}, "expected_revision": body["expected_revision"], "idempotency_key": body["idempotency_key"], "undo_of": revision_id}
