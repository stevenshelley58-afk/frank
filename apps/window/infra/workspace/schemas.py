"""Typed, module-local schemas for the shared workspace estate (Session 5).

Canonical shared schema files remain Session 1-owned; these module-local
definitions mirror the frozen v0.21 interface contract without claiming a
canonical path. Browser DTOs are built only from the explicit public shapes
below and can never carry private host/Hermes/container paths, bank names,
or native board slugs.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

WORKSPACE_RESOLVER_SCHEMA = "schema://frank.workspace-resolver/v1"
WORKSPACE_LEASE_SCHEMA = "schema://frank.workspace-lease/v1"

ROOT_KINDS = frozenset({"live-reference", "upload-staging"})
WORKSPACE_STATUSES = frozenset({"active", "quarantined"})
EXECUTOR_KINDS = frozenset({"hermes", "codex", "gateway", "routine"})
LEASE_STATES = frozenset({"active", "queued", "reconciling", "released"})


@dataclass(frozen=True)
class PrivateWorkspaceRecord:
    """Server-side only record. Never serialized to the browser."""

    workspace_id: str
    project_id: str
    slug: str
    host_path: str
    hermes_path: str
    container_path: str
    memory_scope: str
    board_binding_id: str
    board_slug_private: str | None
    root_kind: str
    status: str
    quarantine_reason: str = ""
    created_at: str = ""


@dataclass(frozen=True)
class WorkspacePublic:
    """The only workspace shape a browser DTO may be built from."""

    workspace_id: str
    project_id: str
    root_kind: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "project_id": self.project_id,
            "root_kind": self.root_kind,
            "status": self.status,
        }


@dataclass(frozen=True)
class ResolvedPath:
    """Result of resolving a normalized relative path under one root."""

    display_path: str
    private_path: str
    workspace_id: str


@dataclass
class LeaseOwner:
    executor_kind: str
    executor_id: str
    session_id: str = ""
    task_id: str = ""
    job_id: str = ""
    run_id: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "executor_kind": self.executor_kind,
            "executor_id": self.executor_id,
            "session_id": self.session_id,
            "task_id": self.task_id,
            "job_id": self.job_id,
            "run_id": self.run_id,
        }

    @staticmethod
    def from_dict(raw: Any) -> "LeaseOwner | None":
        if not isinstance(raw, dict):
            return None
        return LeaseOwner(
            executor_kind=str(raw.get("executor_kind") or ""),
            executor_id=str(raw.get("executor_id") or ""),
            session_id=str(raw.get("session_id") or ""),
            task_id=str(raw.get("task_id") or ""),
            job_id=str(raw.get("job_id") or ""),
            run_id=str(raw.get("run_id") or ""),
        )


@dataclass
class LeaseGrant:
    """One active lease generation for one workspace."""

    workspace_id: str
    generation: str
    owner: LeaseOwner
    acquired_at: float
    heartbeat_at: float
    expires_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "generation": self.generation,
            "owner": self.owner.to_dict(),
            "acquired_at": self.acquired_at,
            "heartbeat_at": self.heartbeat_at,
            "expires_at": self.expires_at,
        }


@dataclass
class QueuedRequest:
    generation: str
    owner: LeaseOwner
    enqueued_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "generation": self.generation,
            "owner": self.owner.to_dict(),
            "enqueued_at": self.enqueued_at,
        }


@dataclass
class LeaseEvent:
    at: float
    action: str
    generation: str = ""
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"at": self.at, "action": self.action, "generation": self.generation, "detail": self.detail}


@dataclass
class LeaseRecord:
    """Durable per-workspace lease state under the operational-data root."""

    workspace_id: str
    state: str
    grant: LeaseGrant | None = None
    queue: list[QueuedRequest] = field(default_factory=list)
    events: list[LeaseEvent] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "state": self.state,
            "grant": self.grant.to_dict() if self.grant else None,
            "queue": [item.to_dict() for item in self.queue],
            "events": [item.to_dict() for item in self.events[-50:]],
        }
