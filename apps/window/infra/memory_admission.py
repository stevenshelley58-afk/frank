"""Narrow memory-admission adapter for the supported Hindsight retain API.

Only three admission kinds are accepted, all with explicit provenance:

- ``direct-user``: a project fact/correction Steven authored directly.
- ``global-preference``: a stable operator preference explicitly confirmed
  through the Memory view's "Remember everywhere" action.
- ``authoritative-source``: an explicitly selected source with provenance.

Arbitrary chat prose, assistant-only messages, tool calls/output, secrets,
and transient failures are refused here — never patched into the vendor
provider. Hindsight still performs semantic extraction and storage; this
adapter only gates what is submitted and stamps provenance.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

SECRET_PATTERNS = (
    re.compile(r"(?i)\b(api[_-]?key|secret|token|password|passwd|credential)\b\s*[:=]"),
    re.compile(r"\b(?:sk|xoxb|ghp|gho|AKIA)[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\b(?:\d{1,4}[ -]?){12,19}\b"),  # card-shaped numbers
)
ADMISSION_KINDS = frozenset({"direct-user", "global-preference", "authoritative-source"})


class AdmissionRefused(ValueError):
    """The content is not admissible under the memory policy."""


@dataclass
class AdmissionRequest:
    kind: str
    content: str
    provenance: dict = field(default_factory=dict)
    user_attributed: bool = False
    idempotency_key: str = ""
    scope: str = "project"  # project | global

    def validate(self) -> None:
        if self.kind not in ADMISSION_KINDS:
            raise AdmissionRefused("unsupported admission kind")
        if self.scope not in {"project", "global"}:
            raise AdmissionRefused("unsupported admission scope")
        if not self.user_attributed:
            raise AdmissionRefused("only directly user-authored or explicitly confirmed content is admissible")
        content = (self.content or "").strip()
        if not content:
            raise AdmissionRefused("admission content is empty")
        if len(content) > 100_000:
            raise AdmissionRefused("admission content exceeds the size limit")
        for pattern in SECRET_PATTERNS:
            if pattern.search(content):
                raise AdmissionRefused("content matches a secret pattern and is refused")
        if not self.provenance.get("source"):
            raise AdmissionRefused("provenance source is required")
        if not self.idempotency_key:
            raise AdmissionRefused("stable idempotency key is required")


class MemoryAdmission:
    def __init__(self, client, global_bank_id: str):
        self.client = client
        self.global_bank_id = global_bank_id

    def admit(self, request: AdmissionRequest) -> dict:
        """Submit one admitted item; Hindsight performs extraction/storage."""
        request.validate()
        bank = self.global_bank_id if request.scope == "global" else None
        if request.scope == "global" and not bank:
            raise AdmissionRefused("global scope is not configured")
        if request.scope == "global" and (
            not request.provenance.get("origin_bank") or not request.provenance.get("origin_document")
        ):
            raise AdmissionRefused("global admission requires origin bank and document provenance")
        if request.scope == "project" and not request.provenance.get("bank_id"):
            raise AdmissionRefused("project admission requires the exact bank id in provenance")
        bank_id = bank or request.provenance["bank_id"]
        metadata = {
            "source": "frank-memory-admission",
            "admission_kind": request.kind,
            "provenance": request.provenance.get("source"),
            "origin_bank": request.provenance.get("origin_bank", ""),
            "origin_document": request.provenance.get("origin_document", ""),
            "attributed_to": "steven",
        }
        payload = {
            "items": [
                {
                    "content": request.content.strip(),
                    "context": request.provenance.get("context") or "Explicit operator admission via Frank",
                    "document_id": f"admitted-{request.idempotency_key}",
                    "metadata": metadata,
                    "tags": ["admitted", request.kind],
                    "update_mode": "replace",
                }
            ],
            "async": False,
        }
        result = self.client.request("POST", f"/v1/default/banks/{bank_id}/memories", payload, timeout=120)
        return {"ok": True, "bank_id": bank_id, "document_id": f"admitted-{request.idempotency_key}", "result": result}
