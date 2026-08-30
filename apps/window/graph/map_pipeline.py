"""Bounded, preview-only orchestration for the first Archify maps.

This module deliberately owns orchestration, not rendering.  The Archify adapter
owns graph-to-IR projection and the artifact store owns immutable generations and
pointers.  Both are duck-typed here so the control plane can be upgraded without
making the window/server depend on either implementation.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


PROJECTION_IDS = ("projection:vps/world", "projection:frank/architecture", "projection:blockwise/runtime", "projection:mini-frank/knowledge-flow", "projection:ad-template-builder/architecture", "projection:ad-template-builder/workflow")
_MAX_OUTPUT = 1_000_000
_DEFAULT_TIMEOUT = 120.0
SHOWCASE_CHECKS = (
    "single_svg", "finite_svg", "orthogonal_arrows", "label_route_clearance",
    "relationship_crossings", "relationship_corridors", "container_border_runs",
    "route_rhythm", "legend_clearance",
)
_RUN_KEY_RE = re.compile(r"^(?:run:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*|[a-z0-9]+(?:-[a-z0-9]+)*)$")


class MapPipelineError(RuntimeError):
    """A typed, safe-to-persist map generation failure."""


@dataclass(frozen=True)
class ArchifyPin:
    executable: Path
    sha256: str
    version: str | None
    node: str


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_yaml(path: Path) -> Mapping[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise MapPipelineError("build-context is not a regular file")
    try:
        import yaml  # type: ignore

        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - malformed config must be typed
        raise MapPipelineError("build-context could not be read") from error
    if not isinstance(value, Mapping):
        raise MapPipelineError("build-context must be an object")
    return value


def load_archify_pin(context_path: Path, *, repo_root: Path | None = None) -> ArchifyPin:
    """Load and verify the Archify executable pin before any command runs."""
    context = _read_yaml(Path(context_path))
    raw = context.get("pinned_upstreams")
    archify = raw.get("archify") if isinstance(raw, Mapping) else None
    if not isinstance(archify, Mapping):
        raise MapPipelineError("build-context has no Archify pin")
    relative = archify.get("executable_path")
    expected = archify.get("executable_sha256_vps")
    if not isinstance(relative, str) or not relative or not isinstance(expected, str) or len(expected) != 64:
        raise MapPipelineError("Archify pin is incomplete")
    root = Path(repo_root) if repo_root is not None else Path(context_path).resolve().parents[2]
    executable = (root / relative).resolve()
    try:
        executable.relative_to(root.resolve())
    except ValueError as error:
        raise MapPipelineError("Archify executable escapes repository root") from error
    if executable.is_symlink() or not executable.is_file():
        raise MapPipelineError("pinned Archify executable is unavailable")
    actual = _sha256(executable)
    if actual.lower() != expected.lower():
        raise MapPipelineError("pinned Archify executable hash mismatch")
    node = archify.get("node_executable_path", context.get("node_executable_path", "node"))
    if not isinstance(node, str) or not node or node.startswith("-"):
        raise MapPipelineError("invalid Node executable path")
    version = archify.get("version")
    return ArchifyPin(executable, actual, version if isinstance(version, str) else None, node)


def _call(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Call adapters with either the keyword or positional contract."""
    try:
        return function(*args, **kwargs)
    except TypeError as first:
        if kwargs:
            try:
                return function(*args)
            except TypeError:
                raise first
        raise


def _project(adapter: Any, graph: Mapping[str, Any], projection_id: str) -> Mapping[str, Any]:
    for name in ("project", "project_graph", "build_projection", "to_archify"):
        function = getattr(adapter, name, None)
        if callable(function):
            result = _call(function, graph, projection_id=projection_id)
            if isinstance(result, Mapping):
                return result
            raise MapPipelineError(f"Archify adapter returned invalid {projection_id} projection")
    raise MapPipelineError("Archify adapter does not expose a projection method")


def _run(runner: Any, argv: Sequence[str], timeout: float) -> Mapping[str, Any]:
    if not all(isinstance(item, str) and item for item in argv):
        raise MapPipelineError("Archify command contains an invalid argument")
    function = getattr(runner, "run", None)
    if not callable(function):
        raise MapPipelineError("Archify runner does not expose run(argv, timeout)")
    try:
        result = function(tuple(argv), timeout=timeout, max_output_bytes=_MAX_OUTPUT, shell=False)
    except TypeError:
        result = function(tuple(argv), timeout=timeout)
    if isinstance(result, Mapping):
        return result
    if getattr(result, "returncode", 1) != 0:
        raise MapPipelineError("Archify command failed")
    return {"returncode": 0, "stdout": getattr(result, "stdout", ""), "stderr": getattr(result, "stderr", "")}


def _ok(result: Mapping[str, Any], phase: str) -> None:
    code = result.get("returncode", result.get("exit_code", 0))
    if code not in (0, None):
        raise MapPipelineError(f"Archify {phase} failed")
    if result.get("ok") is False or result.get("passed") is False:
        raise MapPipelineError(f"Archify {phase} failed")


def _quality_checks(result: Mapping[str, Any]) -> None:
    """Reject an explicit incomplete/failed showcase report.

    Archify versions differ in whether the JSON is returned as ``checks`` or in
    stdout.  We normalize both forms while keeping the runner's output bounded.
    """
    checks: Any = result.get("checks")
    if checks is None and isinstance(result.get("stdout"), str):
        try:
            decoded = json.loads(result["stdout"])
            checks = decoded.get("checks") if isinstance(decoded, Mapping) else None
        except (TypeError, ValueError):
            checks = None
    if checks is None:
        return
    if isinstance(checks, Mapping):
        missing = [name for name in SHOWCASE_CHECKS if name not in checks]
        failed = [name for name in SHOWCASE_CHECKS if name in checks and checks[name] not in (True, "passed", "pass", "ok")]
    elif isinstance(checks, Sequence) and not isinstance(checks, (str, bytes)):
        values = {item.get("name"): item for item in checks if isinstance(item, Mapping)}
        missing = [name for name in SHOWCASE_CHECKS if name not in values]
        failed = [name for name in SHOWCASE_CHECKS if name in values and values[name].get("ok", values[name].get("status", values[name].get("passed"))) not in (True, "passed", "pass", "ok")]
    else:
        raise MapPipelineError("Archify showcase checks are malformed")
    if missing or failed:
        raise MapPipelineError("Archify showcase checks incomplete or failed")


def _store_call(store: Any, names: Sequence[str], *args: Any, **kwargs: Any) -> Any:
    for name in names:
        function = getattr(store, name, None)
        if callable(function):
            return _call(function, *args, **kwargs)
    raise MapPipelineError(f"map artifact store lacks {names[0]} contract")


def _accepted(graph: Mapping[str, Any]) -> tuple[str, str]:
    graph_revision = graph.get("graph_revision") or graph.get("revision")
    if not isinstance(graph_revision, str) or not graph_revision:
        raise MapPipelineError("accepted graph has no revision")
    status = graph.get("status", graph.get("acceptance", "accepted"))
    if status not in ("accepted", "passing", "ok", True):
        raise MapPipelineError("graph revision is not accepted")
    deployment = graph.get("deployed_revision", graph.get("deployment_revision", graph_revision))
    if not isinstance(deployment, str) or not deployment:
        raise MapPipelineError("accepted graph has no deployed revision")
    return graph_revision, deployment


def generate_maps(
    graph_snapshot: Mapping[str, Any],
    *,
    run_key: str,
    build_context_path: Path,
    repo_root: Path,
    preview_root: Path,
    adapter: Any,
    artifact_store: Any,
    runner: Any,
    now: str | None = None,
    timeout_seconds: float = _DEFAULT_TIMEOUT,
) -> Mapping[str, Any]:
    """Generate both mandatory maps and publish their preview pointers atomically.

    A failed projection or Archify command never calls the publish contract.  The
    artifact store therefore retains its last-known-good pointer by construction.
    """
    started = time.monotonic()
    graph_revision = graph_snapshot.get("graph_revision", graph_snapshot.get("revision"))
    deployed_revision = graph_snapshot.get("deployed_revision", graph_snapshot.get("deployment_revision", graph_revision))
    if not isinstance(run_key, str) or _RUN_KEY_RE.fullmatch(run_key) is None:
        raise MapPipelineError("invalid preview run key")
    generated_at = now or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    generation_ids: dict[str, str] = {}
    manifests: dict[str, Mapping[str, Any]] = {}
    command_receipts: list[Mapping[str, Any]] = []
    # Stable IDs may contain ``:`` and ``/``; encode them before crossing the
    # local filesystem boundary (including Windows preview runners).
    staging_name = run_key.replace(":", "_").replace("/", "_")
    staging = Path(preview_root).resolve() / ".staging" / staging_name
    staging.mkdir(parents=True, exist_ok=True)
    try:
        graph_revision, deployed_revision = _accepted(graph_snapshot)
        needs = getattr(artifact_store, "needs_generation", None)
        if callable(needs) and not bool(_call(needs, graph_revision, deployed_revision)):
            return {"status": "skipped", "run_key": run_key, "graph_revision": graph_revision, "deployed_revision": deployed_revision, "reason": "no accepted graph or deployment revision changed", "preview_published": False}
        pin = load_archify_pin(build_context_path, repo_root=repo_root)
        for projection_id in PROJECTION_IDS:
            if time.monotonic() - started >= timeout_seconds:
                raise MapPipelineError("map generation deadline exceeded")
            projection = _project(adapter, graph_snapshot, projection_id)
            if projection.get("projection_id", projection_id) != projection_id:
                raise MapPipelineError("projection id mismatch")
            generation_id = f"generation:{run_key.removeprefix('run:')}-{projection_id.split(':', 1)[1].replace('/', '-') }"
            generation_ids[projection_id] = generation_id
            generation_name = generation_id.replace(":", "_").replace("/", "_")
            input_path = staging / f"{generation_name}.json"
            input_document = projection.get("diagram", projection)
            if not isinstance(input_document, Mapping):
                raise MapPipelineError("Archify projection document is invalid")
            input_path.write_bytes(_canonical(input_document))
            # The adapter receives no command authority: every argv is assembled here.
            type_name = "workflow_data_flow" if projection_id.endswith("/workflow") else "architecture"
            remaining = max(0.1, timeout_seconds - (time.monotonic() - started))
            for phase, argv in (
                ("validate", (pin.node, str(pin.executable), "validate", type_name, str(input_path), "--quality", "showcase", "--json")),
                ("deliver", (pin.node, str(pin.executable), "deliver", type_name, str(input_path), str(staging / generation_name / "artifact.html"))),
            ):
                result = _run(runner, argv, min(remaining, timeout_seconds))
                _ok(result, phase)
                if phase == "validate":
                    _quality_checks(result)
                command_receipts.append({"phase": phase, "argv": list(argv), "result": {"returncode": result.get("returncode", result.get("exit_code", 0))}})
            artifact = staging / generation_name / "artifact.html"
            artifact_hint = getattr(adapter, "artifact_path", None)
            if callable(artifact_hint):
                candidate = _call(artifact_hint, projection_id, generation_id=generation_id)
                if isinstance(candidate, (str, Path)):
                    hinted = Path(candidate)
                    # Adapter hints are data, not filesystem authority.  Keep
                    # them confined to this run's staging tree so a malformed
                    # adapter cannot make visual-check or hashing read an
                    # arbitrary local file (including a symlink target).
                    try:
                        resolved_hint = hinted.resolve(strict=False)
                        resolved_hint.relative_to(staging.resolve())
                    except (OSError, ValueError) as error:
                        raise MapPipelineError("Archify artifact path escapes staging root") from error
                    if hinted.is_symlink():
                        raise MapPipelineError("Archify artifact path may not be a symlink")
                    artifact = resolved_hint
            result = _run(runner, (pin.node, str(pin.executable), "visual-check", str(artifact), "--json"), min(remaining, timeout_seconds))
            _ok(result, "visual-check")
            _quality_checks(result)
            command_receipts.append({"phase": "visual-check", "argv": [pin.node, str(pin.executable), "visual-check", str(artifact), "--json"], "result": {"returncode": result.get("returncode", result.get("exit_code", 0))}})
            coverage = projection.get("coverage", graph_snapshot.get("coverage", {}))
            missing_coverage = []
            if isinstance(coverage, Mapping):
                missing_coverage = list(coverage.get("missing", ()))
                coverage = list(coverage.get("present", ()))
            if not isinstance(coverage, list):
                raise MapPipelineError("map coverage is invalid")
            manifest = {
                "projection_id": projection_id,
                "graph_revision": graph_revision,
                "generation_id": generation_id,
                "source_revisions": graph_snapshot.get("source_revisions", {}),
                "deployed_revisions": graph_snapshot.get("deployed_revisions", {"release": deployed_revision}),
                "generated_at": generated_at,
                "archify_version": pin.version,
                "archify_hash": f"sha256:{pin.sha256}",
                "artifact_hash": f"sha256:{hashlib.sha256(artifact.read_bytes()).hexdigest()}" if artifact.is_file() else None,
                "validation_receipt_id": f"receipt:map/{generation_id.replace(':', '-').replace('/', '-')}-validation",
                "prior_passing_manifest": None,
                "coverage": coverage,
                "missing_coverage": missing_coverage,
                "exclusions": projection.get("exclusions", graph_snapshot.get("exclusions", [])),
                "findings": projection.get("findings", []),
                "status": "generated",
                "preview_only": True,
                "freshness": "fresh",
                "stale_reason": None,
            }
            manifests[projection_id] = manifest
            _store_call(artifact_store, ("write_generation", "commit_generation"), projection_id, generation_id, manifest, artifact, root=staging)
        _store_call(artifact_store, ("publish_preview", "advance_preview"), run_key, manifests)
        return {"status": "passed", "run_key": run_key, "graph_revision": graph_revision, "deployed_revision": deployed_revision, "generation_ids": generation_ids, "manifests": manifests, "commands": command_receipts}
    except Exception as error:  # noqa: BLE001 - receipt must not expose command output
        reason = str(error)[:240]
        receipt = {"status": "failed", "run_key": run_key, "graph_revision": graph_revision, "deployed_revision": deployed_revision, "reason": reason, "generation_ids": generation_ids, "preview_published": False}
        record = getattr(artifact_store, "record_failure", None)
        if callable(record):
            _call(record, receipt)
        return receipt
    finally:
        # The store owns durable generations; transient JSON inputs are disposable.
        for path in staging.glob("*.json"):
            try:
                path.unlink()
            except OSError:
                pass


__all__ = ["ArchifyPin", "MapPipelineError", "PROJECTION_IDS", "generate_maps", "load_archify_pin"]
