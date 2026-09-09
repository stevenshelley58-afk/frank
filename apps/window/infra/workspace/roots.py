"""Typed workspace root contracts for safe attachment and path service.

A root is either a read-only ``live-reference`` into a validated canonical
workspace (VPS folder) or an ``upload-staging`` root for finalized local
snapshots. Browser requests carry ``workspace_id`` + ``root_id`` plus a
normalized relative path — never an accepted absolute path.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .resolver import PathRejected, WorkspaceRegistry

_SAFE_ROOT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_FILES = 2_000
DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024


@dataclass(frozen=True)
class RootContract:
    """Server-side contract for one attachable root."""

    root_id: str
    workspace_id: str
    kind: str  # live-reference | upload-staging
    container_path: str
    host_path: str
    hermes_path: str
    permitted_scopes: tuple[str, ...]
    allowed_extensions: tuple[str, ...] | None  # None = any safe type
    max_file_bytes: int
    max_files: int
    max_total_bytes: int
    read_only: bool

    def public(self) -> dict:
        return {
            "root_id": self.root_id,
            "workspace_id": self.workspace_id,
            "kind": self.kind,
            "read_only": self.read_only,
        }


class RootCatalog:
    """Derives typed roots from the migrated workspace registry."""

    def __init__(
        self,
        registry: WorkspaceRegistry,
        uploads_container_root: str = "/data/uploads",
        uploads_host_root: str = "/srv/frank/data/window/uploads",
        max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
        max_files: int = DEFAULT_MAX_FILES,
        max_total_bytes: int = DEFAULT_MAX_TOTAL_BYTES,
    ):
        self.registry = registry
        self.uploads_container_root = uploads_container_root.rstrip("/")
        self.uploads_host_root = uploads_host_root.rstrip("/")
        self.max_file_bytes = max_file_bytes
        self.max_files = max_files
        self.max_total_bytes = max_total_bytes

    def roots_for(self, workspace_id: str) -> list[RootContract]:
        record = self.registry.get_active(workspace_id)
        roots = []
        if record.slug == "unassigned":
            partition = "unassigned"
        else:
            partition = f"projects/{record.project_id}"
        roots.append(
            RootContract(
                root_id=f"{workspace_id}-staging",
                workspace_id=workspace_id,
                kind="upload-staging",
                container_path=f"{self.uploads_container_root}/{partition}",
                host_path=f"{self.uploads_host_root}/{partition}",
                hermes_path="",
                permitted_scopes=(record.project_id,),
                allowed_extensions=None,
                max_file_bytes=self.max_file_bytes,
                max_files=self.max_files,
                max_total_bytes=self.max_total_bytes,
                read_only=False,
            )
        )
        if record.slug != "unassigned" and record.host_path:
            roots.append(
                RootContract(
                    root_id=f"{workspace_id}-live",
                    workspace_id=workspace_id,
                    kind="live-reference",
                    container_path=record.container_path,
                    host_path=record.host_path,
                    hermes_path=record.hermes_path,
                    permitted_scopes=(record.project_id,),
                    allowed_extensions=None,
                    max_file_bytes=self.max_file_bytes,
                    max_files=self.max_files,
                    max_total_bytes=self.max_total_bytes,
                    read_only=True,
                )
            )
        return roots

    def get(self, workspace_id: str, root_id: str) -> RootContract:
        if not _SAFE_ROOT_ID.fullmatch(str(root_id or "")):
            raise PathRejected("invalid root id")
        for root in self.roots_for(workspace_id):
            if root.root_id == root_id:
                return root
        raise PathRejected("root is not registered for this workspace")
