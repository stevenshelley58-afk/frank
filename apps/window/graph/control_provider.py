"""Read-only provider for one validated control-graph snapshot."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .control_plane import ControlContractError


STATUSES = frozenset({"ready", "empty", "attention", "unavailable", "error"})


class ControlProvider:
    """Translate store outcomes into the frozen five-state provider contract."""

    def __init__(self, store: Any):
        self.store = store

    @staticmethod
    def _empty(status: str, error: str | None = None) -> dict[str, Any]:
        result: dict[str, Any] = {
            "status": status,
            "manifest": None,
            "graph": None,
            "assertions": None,
            "findings": None,
        }
        if error is not None:
            result["error"] = error
        return result

    @staticmethod
    def _freshness_attention(manifest: dict[str, Any], graph: dict[str, Any]) -> str | None:
        """Return a stable explanation when evidence is not current.

        Legacy snapshots without an observation envelope remain readable for
        compatibility.  Once freshness is present, unknown/unavailable/stale
        are all non-ready; an expired ``fresh_until`` is checked at read time.
        This method intentionally does not inspect health or invent health
        claims from runtime status fields.
        """
        metadata = manifest.get("observation_metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        freshness = metadata.get("freshness", manifest.get("freshness"))
        if freshness in {"stale", "unavailable", "unknown"}:
            return f"control graph evidence is {freshness}"
        if freshness is not None and freshness != "fresh":
            return "control graph evidence freshness is invalid"
        fresh_until = metadata.get("fresh_until", manifest.get("fresh_until"))
        if isinstance(fresh_until, str) and fresh_until:
            try:
                expires = datetime.fromisoformat(fresh_until.replace("Z", "+00:00"))
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if expires <= datetime.now(timezone.utc):
                    return "control graph evidence is stale"
            except ValueError:
                return "control graph freshness deadline is invalid"
        # Observed nodes carry the frozen freshness axis where available.
        for node in graph.get("nodes", []):
            if not isinstance(node, dict) or node.get("layer") != "observed":
                continue
            axes = node.get("state_axes")
            value = axes.get("freshness") if isinstance(axes, dict) else None
            if value in {"stale", "unavailable", "unknown"}:
                return f"control graph evidence is {value}"
        return None

    @staticmethod
    def _finding_attention(findings: list[Any]) -> str | None:
        # Findings are emitted only for non-match reconciliation results.  Do
        # not collapse or reinterpret them into a health score.
        for finding in findings:
            if not isinstance(finding, dict):
                return "control graph findings are malformed"
            result = finding.get("reconciliation_result")
            if result not in (None, "match"):
                return "control graph has reconciliation findings"
        return None

    def snapshot(self) -> dict[str, Any]:
        try:
            snapshot = self.store.read_snapshot()
            if not snapshot:
                return self._empty("empty")
            if not isinstance(snapshot, dict) or not all(
                key in snapshot for key in ("manifest", "graph", "assertions", "findings")
            ):
                return self._empty("attention", "control graph snapshot is malformed")
            if not isinstance(snapshot["manifest"], dict) or not isinstance(snapshot["graph"], dict):
                return self._empty("attention", "control graph snapshot is malformed")
            if not isinstance(snapshot["assertions"], dict) or not isinstance(snapshot["findings"], list):
                return self._empty("attention", "control graph snapshot is malformed")
            reason = self._freshness_attention(snapshot["manifest"], snapshot["graph"])
            reason = reason or self._finding_attention(snapshot["findings"])
            if reason:
                return {"status": "attention", "error": reason, **snapshot}
            return {"status": "ready", **snapshot}
        except FileNotFoundError:
            return self._empty("empty")
        except ControlContractError:
            return self._empty("attention", "control graph snapshot is invalid")
        except OSError:
            return self._empty("unavailable", "control graph storage is unavailable")
        except Exception:
            return self._empty("error", "control graph provider failed")

    def get(self) -> dict[str, Any]:
        return self.snapshot()
