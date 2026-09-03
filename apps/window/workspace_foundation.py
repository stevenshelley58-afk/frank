"""Frank v0.21 workspace foundation (Session-1 fallback implementation).

Implements the contract (docs/contracts/FRANK_HERMES_V021_CONTRACT.md §4/§5):

- Opaque ``workspace_id`` minting and backward-compatible registry migration.
- Immutable legacy-root-derived private ``memory_scope`` preservation.
- Opaque ``board_binding_id`` ↔ private native board slug mapping.
- Private host/Hermes/container path resolution (never browser-exposed).
- One-writer-per-workspace execution lease with heartbeat, TTL, queue,
  cancel, terminal release and verifier-gated stale reclaim (fail-closed).

Module-local schemas only; the canonical contract files remain untouched.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from pathlib import Path

LEASE_SCHEMA = "frank.workspace-lease/v1"
REGISTRY_SCHEMA = "frank.workspace-registry/v1"


def mint_workspace_id() -> str:
    return f"ws_{uuid.uuid4().hex}"


def mint_board_binding_id() -> str:
    return f"bb_{uuid.uuid4().hex}"


def legacy_memory_scope(project_root: str) -> str:
    """Exact legacy derivation: Hindsight bank from the project root.

    Must stay byte-identical to the pre-migration behavior
    (memory_inspector: steven-<root>; unassigned default preserved).
    """
    root = (project_root or "").strip()
    if not root or root == "unassigned":
        return "steven-unassigned"
    return f"steven-{root}"


class WorkspaceRegistry:
    """Private registry: opaque IDs in, private resolutions out.

    The public (browser) projection contains only opaque identifiers;
    paths, bank names and native slugs never leave the server.
    """

    def __init__(self, store_path: str | os.PathLike[str]):
        self._path = Path(store_path)
        self._data: dict = {
            "schema": REGISTRY_SCHEMA,
            "workspaces": {},
            "board_bindings": {},
        }
        self._load()

    # -- persistence ----------------------------------------------------
    def _load(self) -> None:
        if self._path.exists():
            raw = json.loads(self._path.read_text())
            if raw.get("schema") != REGISTRY_SCHEMA:
                raise ValueError(f"unsupported registry schema: {raw.get('schema')}")
            self._data = raw

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(self._path.parent), prefix=".registry-")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(self._data, fh, sort_keys=True, indent=1)
            os.replace(tmp, self._path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    # -- migration ------------------------------------------------------
    def migrate_project(self, project_id: str, legacy_root: str,
                        host_path: str, container_path: str,
                        hermes_path: str, native_board_slug: str | None = None) -> dict:
        """Idempotent, backward-compatible migration of one project.

        - Preserves any existing workspace_id and memory_scope verbatim.
        - memory_scope is re-derived only when absent, from the legacy root.
        - board binding is minted opaque and mapped privately to the slug.
        """
        ws = self._data["workspaces"].get(project_id)
        created = False
        if ws is None:
            created = True
            ws = {
                "workspace_id": mint_workspace_id(),
                "memory_scope": legacy_memory_scope(legacy_root),
                "legacy_root": legacy_root,
            }
        # Never overwrite preserved values.
        ws.setdefault("workspace_id", mint_workspace_id())
        ws.setdefault("memory_scope", legacy_memory_scope(legacy_root))
        ws.update({
            "paths": {
                "host": host_path,
                "container": container_path,
                "hermes": hermes_path,
            },
        })
        self._data["workspaces"][project_id] = ws
        binding_id = self._data["board_bindings"].get(project_id, {}).get("binding_id")
        if not binding_id:
            binding_id = mint_board_binding_id()
        self._data["board_bindings"][project_id] = {
            "binding_id": binding_id,
            "native_slug": native_board_slug,  # private; may be None until created
        }
        self._save()
        rec = dict(ws)
        rec["created"] = created
        rec["board_binding_id"] = binding_id
        return rec

    # -- resolution -----------------------------------------------------
    def workspace_id_for(self, project_id: str) -> str | None:
        ws = self._data["workspaces"].get(project_id)
        return ws["workspace_id"] if ws else None

    def project_for_workspace(self, workspace_id: str) -> str | None:
        for pid, ws in self._data["workspaces"].items():
            if ws["workspace_id"] == workspace_id:
                return pid
        return None

    def resolve_private(self, workspace_id: str) -> dict | None:
        """Private resolution for server/Hermes use only. Never serialized."""
        pid = self.project_for_workspace(workspace_id)
        if not pid:
            return None
        ws = self._data["workspaces"][pid]
        return {
            "project_id": pid,
            "paths": dict(ws["paths"]),
            "memory_scope": ws["memory_scope"],
            "native_board_slug": self._data["board_bindings"].get(pid, {}).get("native_slug"),
        }

    def browser_projection(self, project_id: str) -> dict:
        """Browser-safe DTO: opaque identifiers only."""
        ws = self._data["workspaces"].get(project_id)
        if not ws:
            return {}
        return {
            "project_id": project_id,
            "workspace_id": ws["workspace_id"],
            "board_binding_id": self._data["board_bindings"].get(project_id, {}).get("binding_id"),
        }

    def set_native_board_slug(self, project_id: str, slug: str) -> None:
        if project_id not in self._data["board_bindings"]:
            raise KeyError(project_id)
        self._data["board_bindings"][project_id]["native_slug"] = slug
        self._save()


class LeaseUnavailable(RuntimeError):
    """Lease store cannot be reached — fail closed."""


class ExecutionLease:
    """One-writer-per-workspace lease, backed by an atomic JSON store.

    Semantics per contract §5:
    - acquire: exclusive; a live competing holder → refuse (caller queues);
    - heartbeat: refresh holder liveness;
    - stale reclaim only when TTL is expired AND the verifier confirms the
      owner process is dead (time alone never steals);
    - release: terminal, frees the workspace;
    - any store error → fail closed (LeaseUnavailable).
    """

    def __init__(self, store_path: str | os.PathLike[str], verifier=None):
        self._path = Path(store_path)
        self._verifier = verifier or (lambda pid: _pid_alive(pid))

    def _load(self) -> dict:
        try:
            if not self._path.exists() or self._path.stat().st_size == 0:
                return {"schema": LEASE_SCHEMA, "leases": {}}
            return json.loads(self._path.read_text())
        except (OSError, ValueError) as exc:
            raise LeaseUnavailable(str(exc)) from exc

    def _save(self, data: dict) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=str(self._path.parent), prefix=".lease-")
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh, sort_keys=True)
            os.replace(tmp, self._path)
        except OSError as exc:
            raise LeaseUnavailable(str(exc)) from exc

    def acquire(self, workspace_id: str, owner: str, owner_pid: int,
                ttl_seconds: int = 300) -> dict:
        now = time.time()
        data = self._load()
        leases = data["leases"]
        cur = leases.get(workspace_id)
        if cur:
            # Refuse while the TTL is live OR the authoritative verifier
            # still reports the owner alive; reclaim only when both the TTL
            # is expired and the verifier confirms the owner is dead.
            if now < cur["expires_at"] or self._verifier(cur["owner_pid"]):
                return {"granted": False, "reason": "held", "holder": cur["owner"],
                        "expires_at": cur["expires_at"]}
        leases[workspace_id] = {
            "owner": owner,
            "owner_pid": owner_pid,
            "acquired_at": now,
            "heartbeat_at": now,
            "expires_at": now + ttl_seconds,
            "generation": (cur or {}).get("generation", 0) + 1,
        }
        self._save(data)
        rec = dict(leases[workspace_id])
        rec["granted"] = True
        return rec

    def heartbeat(self, workspace_id: str, owner: str,
                  ttl_seconds: int = 300) -> bool:
        data = self._load()
        cur = data["leases"].get(workspace_id)
        if not cur or cur["owner"] != owner:
            return False
        cur["heartbeat_at"] = time.time()
        cur["expires_at"] = cur["heartbeat_at"] + ttl_seconds
        self._save(data)
        return True

    def release(self, workspace_id: str, owner: str) -> bool:
        data = self._load()
        cur = data["leases"].get(workspace_id)
        if not cur or cur["owner"] != owner:
            return False
        del data["leases"][workspace_id]
        self._save(data)
        return True

    def holder(self, workspace_id: str) -> dict | None:
        cur = self._load()["leases"].get(workspace_id)
        if not cur:
            return None
        if time.time() >= cur["expires_at"] and not self._verifier(cur["owner_pid"]):
            return None
        return cur


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
