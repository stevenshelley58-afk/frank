"""Deterministic run state; execution is supplied by Hermes adapters."""

from dataclasses import dataclass, field
from enum import Enum
from .core import PIPELINE_STAGES, AdIntelligenceManifest, TraceRecord

class PipelineStage(str, Enum):
    DISCOVER = "discover"; RESOLVE = "resolve"; CAPTURE = "capture"; NORMALIZE = "normalize"; CLASSIFY = "classify"; MEDIA_QA = "media-qa"; PUBLISH = "publish"

class StageFailure(Exception):
    def __init__(self, message: str, *, retryable: bool = True, reason: str = "execution"):
        super().__init__(message); self.retryable = retryable; self.reason = reason

@dataclass
class PipelineRun:
    run_id: str
    manifest: AdIntelligenceManifest
    stage: str = PIPELINE_STAGES[0]
    status: str = "ready"
    attempts: dict[str, int] = field(default_factory=dict)
    quarantine_reason: str | None = None
    approval_receipt_ref: str | None = None
    traces: list[TraceRecord] = field(default_factory=list)

    def advance(self, stage: str):
        if stage not in PIPELINE_STAGES: raise ValueError(f"unknown pipeline stage: {stage}")
        expected = PIPELINE_STAGES.index(self.stage)
        actual = PIPELINE_STAGES.index(stage)
        if self.status in {"quarantined", "published", "awaiting_approval"}: raise ValueError(f"run is {self.status}")
        if actual != expected and not (self.status == "ready" and actual == 0):
            raise ValueError(f"expected {PIPELINE_STAGES[expected]}, got {stage}")
        self.stage = stage; self.status = "running"

    def record_failure(self, failure: StageFailure):
        count = self.attempts.get(self.stage, 0) + 1; self.attempts[self.stage] = count
        if not failure.retryable or count > self.manifest.retry.max_retries:
            self.status = "quarantined"; self.quarantine_reason = f"{failure.reason}: {failure}"
        else: self.status = "retryable_failure"
        self.traces.append(TraceRecord(self.run_id, self.stage, self.status, error=str(failure)))

    def succeed(self, *, model=None, cost=None, evidence_refs=(), receipt_refs=()):
        if self.status not in {"running", "ready"}: raise ValueError(f"cannot succeed run in state {self.status}")
        completed = self.stage
        self.traces.append(TraceRecord(self.run_id, completed, "ok", model, cost or {}, tuple(evidence_refs), tuple(receipt_refs)))
        if completed == PIPELINE_STAGES[-1]:
            self.status = "awaiting_approval"
            self.approval_receipt_ref = f"receipt://{self.run_id}/publish-approval"
            self.traces.append(TraceRecord(self.run_id, completed, "awaiting_approval", receipt_refs=(self.approval_receipt_ref,)))
        else:
            self.stage = PIPELINE_STAGES[PIPELINE_STAGES.index(completed) + 1]
            self.status = "ready"

    def approve_publish(self, approved_by: str, *, receipt_ref: str | None = None):
        """Cross the immutable publish boundary only after an explicit approval receipt."""
        if self.status != "awaiting_approval": raise ValueError("publish approval is not pending")
        if self.manifest.approval.publish in {"never", "disabled"}: raise ValueError("manifest approval policy forbids publish")
        if not isinstance(approved_by, str) or not approved_by.strip(): raise ValueError("approved_by is required")
        if not isinstance(receipt_ref, str) or not receipt_ref.strip(): raise ValueError("approval receipt_ref is required")
        self.approval_receipt_ref = receipt_ref
        self.traces.append(TraceRecord(self.run_id, self.stage, "approved", receipt_refs=(receipt_ref,)))
        self.status = "published"

    def retry_delay_seconds(self, attempt: int) -> float:
        """Bounded exponential backoff: base * 2**(attempt-1), capped at max."""
        if not isinstance(attempt, int) or attempt < 1: raise ValueError("attempt must be >= 1")
        policy = self.manifest.retry
        return min(policy.max_delay_seconds, policy.base_delay_seconds * (2 ** (attempt - 1)))

    def next_stage(self):
        index = PIPELINE_STAGES.index(self.stage)
        if index == len(PIPELINE_STAGES) - 1: return None
        return PIPELINE_STAGES[index + 1]
