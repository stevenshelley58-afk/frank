#!/usr/bin/env python3
"""Fixed-input, host-owned reconciliation receipt collector.

The executable intentionally has a very small interface: ``fast``, ``full``
or ``post_deploy``.  Host facts are supplied by the service's fixed input
directory (never by command line paths or commands) and are copied into an
immutable, redacted receipt before the latest pointer is advanced.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import re
import shutil
import stat
import sys
import tempfile
import time
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
try:
    import yaml
except ImportError:  # pragma: no cover - production image does not collect host declarations
    yaml = None
try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:  # pragma: no cover - host collector can still emit runtime evidence
    Draft202012Validator = None

VERSION = "control-reconcile/v1"
MODES = frozenset(("fast", "full", "post_deploy"))
ALLOWED_SOURCES = frozenset((
    "identity", "revision", "compose", "systemd", "caddy", "health",
    "monitoring", "deployment", "capabilities",
))
SECRET_KEYS = re.compile(r"(pass(word)?|secret|token|api[_-]?key|private[_-]?key|credential|authorization|cookie)", re.I)
BODY_KEYS = re.compile(r"(instruction|prompt|body|content|markdown|full_text)", re.I)
MAX_INPUT_BYTES = 64 * 1024
# Individual host commands and fixture inputs stay at 64 KiB. A full
# metadata-only inventory legitimately contains hundreds of bounded records,
# so durable artifacts use a separate aggregate ceiling.
MAX_FACTS_BYTES = 4 * 1024 * 1024
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
MODE_TIMEOUT_SECONDS = {"fast": 5 * 60.0, "full": 15 * 60.0}
FRESHNESS_SECONDS = {"fast": 15 * 60.0, "full": 24 * 60.0 * 60.0}
RECEIPT_SCHEMA_RELATIVE = Path("governance/control-plane/schema/receipt.schema.json")

if yaml is not None:
    class _UniqueKeyLoader(yaml.SafeLoader):
        pass

    def _construct_unique_mapping(loader, node, deep=False):
        keys = set()
        for key_node, _value_node in node.value:
            if key_node.tag == "tag:yaml.org,2002:merge":
                continue
            key = loader.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in keys:
                raise ValueError("duplicate or non-string catalog key")
            keys.add(key)
        loader.flatten_mapping(node)
        return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)

    _UniqueKeyLoader.add_constructor(
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
        _construct_unique_mapping,
    )


class HostFactSource:
    """The sole production input source; all paths/commands are constants."""
    ROOT = Path("/projects/frank")
    FILES = (".git/HEAD", "apps/window/docker-compose.yml",
             "apps/window/Caddyfile", "apps/window/deploy.sh", "governance/control-plane/build-context.yaml")
    UNITS = ("agenttrail-only-process-frank.service", "agenttrail-only-process-hermes.service",
             "agenttrail-only-process-blockwise.service", "hermes-frank-vault-broker.service",
             "hermes-gateway.service", "hermes-serve.service", "hindsight-frank-proxy.service",
             "hindsight-frank-proxy.socket", "frank-control-reconcile-fast.service", "frank-control-reconcile-full.service")
    CONTAINERS = frozenset(("frank-window", "frank-agenttrail", "frank-caddy", "blockwise-product-product-app-1",
        "blockwise-product-product-auth-1", "blockwise-product-product-caddy-1", "blockwise-product-product-db-1",
        "blockwise-product-product-rest-1", "blockwise-product-product-storage-1", "blockwise-research-db",
        "blockwise-e2e-tls-proxy", "blockwise-migration-rehearsal", "infisical-backend", "infisical-db",
        "infisical-redis", "frank-entity-home-preview"))
    HEALTH = ("http://127.0.0.1:18080/api/health", "https://frank.fail/frank/", "https://blockwise.sale/api/health")
    SYSTEMD_FIELDS = ("LoadState", "ActiveState", "SubState", "UnitFileState", "FragmentPath")
    APPROVED_SHA = Path("/var/lib/frank/release/approved-sha")
    MAX_COMMAND_OUTPUT = 64 * 1024
    MAX_DISCOVERY_ITEMS = 512
    MAX_FILE_BYTES = 64 * 1024
    DOCKER_DISCOVERY_FORMAT = "{{.Names}}"
    DOCKER_DISCOVERY = ("docker", "ps", "--all", "--no-trunc", "--format", DOCKER_DISCOVERY_FORMAT)
    DOCKER_VOLUME_DISCOVERY_FORMAT = "{{.Name}}"
    DOCKER_VOLUME_DISCOVERY = ("docker", "volume", "ls", "--format", DOCKER_VOLUME_DISCOVERY_FORMAT)
    SYSTEMD_DISCOVERY = (
        "systemctl", "list-unit-files", "--type=service", "--type=socket", "--type=timer",
        "--no-legend", "--no-pager",
    )
    MANAGED_UNIT_PREFIXES = ("agenttrail-", "frank-", "hermes-", "hindsight-", "blockwise-")
    _NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
    _UNIT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}\.(?:service|socket|timer)\Z")

    def __init__(self, *, runner=None, opener=None, timeout=10.0):
        self.runner = runner or self._run
        self.opener = opener or urllib.request.urlopen
        self.timeout = timeout
        self.deadline: float | None = None
        # Discovery only widens this set with names returned by the fixed
        # Docker/systemd listing commands.  Callers cannot supply arbitrary
        # names to the command runner.
        self._observed_containers = set(self.CONTAINERS)
        self._observed_units = set(self.UNITS)

    def _run(self, argv):
        # Never let a hostile or unexpectedly verbose host command allocate
        # unbounded stdout/stderr in this root-owned process.
        with tempfile.TemporaryFile(mode="w+b") as output:
            timeout = self.timeout
            if self.deadline is not None:
                timeout = min(timeout, max(0.001, self.deadline - time.monotonic()))
            result = subprocess.run(argv, check=False, stdout=output,
                                    stderr=subprocess.DEVNULL, timeout=timeout)
            output.seek(0)
            result.stdout = output.read(self.MAX_COMMAND_OUTPUT + 1).decode(
                "utf-8", errors="replace"
            )
            return result

    def _file(self, relative):
        path = self.ROOT / relative
        try:
            resolved = path.resolve(strict=True)
            if self.ROOT.resolve() not in resolved.parents or path.is_symlink() or not resolved.is_file():
                raise OSError("not a regular in-root file")
            with open(resolved, "rb") as handle:
                data = handle.read(self.MAX_FILE_BYTES + 1)
            if len(data) > self.MAX_FILE_BYTES:
                return {"status": "inaccessible", "reason": "fixed file exceeds bound"}
            return {"status": "ready", "sha256": hashlib.sha256(data).hexdigest(),
                    "bytes": len(data)}
        except (OSError, ValueError):
            return {"status": "inaccessible", "reason": "fixed file unavailable"}

    def _absolute_file(self, path):
        try:
            resolved = path.resolve(strict=True)
            if path.is_symlink() or not resolved.is_file():
                raise OSError("not a regular file")
            with open(resolved, "rb") as handle:
                data = handle.read(self.MAX_FILE_BYTES + 1)
            if len(data) > self.MAX_FILE_BYTES:
                return {"status": "inaccessible", "reason": "fixed file exceeds bound"}
            return {"status": "ready", "value": data.decode(errors="replace").strip(), "sha256": hashlib.sha256(data).hexdigest()}
        except (OSError, ValueError, UnicodeError):
            return {"status": "inaccessible", "reason": "fixed file unavailable"}

    def _remaining_timeout(self) -> float:
        """Return a bounded timeout that cannot outlive this collection."""
        if self.deadline is None:
            return max(0.001, self.timeout)
        return max(0.001, min(self.timeout, self.deadline - time.monotonic()))

    @staticmethod
    def _project_git_marker_status(project: Path) -> str:
        """Inspect only marker metadata; never read ``.git/HEAD``.

        A project entry and its ``.git`` directory must be ordinary in-root
        objects before the marker is described.  The marker contents are not
        evidence needed by the collector (the exact commit comes from the
        allowlisted ``git rev-parse`` command), so avoiding the read also
        prevents an escaping ``.git/HEAD`` symlink from becoming an input.
        """
        try:
            git_dir = project / ".git"
            marker = git_dir / "HEAD"
            if (git_dir.is_symlink() or not git_dir.is_dir()
                    or marker.is_symlink() or not marker.is_file()):
                return "inaccessible"
            return "metadata_only"
        except (OSError, ValueError):
            return "inaccessible"

    # Named-volume identities are sufficient to derive managed store edges.
    # Bind sources, labels and environment are deliberately never requested.
    DOCKER_FORMAT = "{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Image}}|{{.Config.Image}}|{{range .Mounts}}{{if eq .Type \"volume\"}}{{.Name}},{{end}}{{end}}"
    SYSTEMD_PROPERTY = "--property=LoadState,ActiveState,SubState,UnitFileState,FragmentPath"

    def _command(self, argv):
        a = tuple(argv)
        if self.deadline is not None and time.monotonic() >= self.deadline:
            return {"status": "unavailable", "reason": "collector deadline exceeded"}
        docker_ok = (
            len(a) == 5
            and a[:4] == ("docker", "inspect", "--format", self.DOCKER_FORMAT)
            and a[4] in self._observed_containers
        )
        docker_discovery_ok = a == self.DOCKER_DISCOVERY
        volume_discovery_ok = a == self.DOCKER_VOLUME_DISCOVERY
        systemd_ok = (
            len(a) == 5
            and a[:4] == ("systemctl", "show", "--no-pager", self.SYSTEMD_PROPERTY)
            and a[4] in self._observed_units
        )
        systemd_discovery_ok = a == self.SYSTEMD_DISCOVERY
        pipeline_ok = a == ("docker", "exec", "frank-window", "python", "-m", "graph.control_pipeline")
        git_ok = a == ("git", "-C", str(self.ROOT), "rev-parse", "--verify", "HEAD")
        git_blob_ok = (
            len(a) == 6 and a[:4] == ("git", "-C", str(self.ROOT), "show")
            and re.fullmatch(r"[0-9a-f]{40}", a[4])
            and a[5] in {
                "governance/control-plane/catalog.yaml",
                "governance/control-plane/schema/catalog.schema.json",
            }
        )
        allowed = (docker_ok or docker_discovery_ok or volume_discovery_ok or systemd_ok
                   or systemd_discovery_ok or git_ok or git_blob_ok or pipeline_ok)
        if not allowed:
            return {"status": "unavailable", "reason": "command not allowlisted"}
        try:
            result = self.runner(list(argv))
            if getattr(result, "returncode", 1) != 0:
                return {"status": "unavailable", "returncode": getattr(result, "returncode", None)}
            raw_output = getattr(result, "stdout", "") or ""
            if len(raw_output.encode("utf-8", errors="replace")) > self.MAX_COMMAND_OUTPUT:
                return {"status": "unavailable", "reason": "command output exceeds bound"}
            output = raw_output.strip()
            if docker_ok:
                lines = output.splitlines()
                if len(lines) != 1:
                    return {"status": "unavailable", "reason": "invalid Docker evidence shape"}
                parts = lines[0].split("|")
                if len(parts) != 6 or parts[0].lstrip("/") != a[4]:
                    return {"status": "unavailable", "reason": "Docker identity mismatch"}
                mount_names = [name for name in parts[5].split(",") if name]
                if any(not self._NAME.fullmatch(name) for name in mount_names):
                    return {"status": "unavailable", "reason": "invalid Docker volume identity"}
                parts[0] = a[4]
                output = "|".join(parts)
            if pipeline_ok and output:
                try:
                    pipeline_result = json.loads(output.splitlines()[-1])
                    if pipeline_result.get("status") not in {"success", "empty"}:
                        return {"status": "unavailable", "reason": "control pipeline failed"}
                except (ValueError, TypeError):
                    return {"status": "unavailable", "reason": "invalid control pipeline output"}
            return {"status": "ready", "output": output}
        except subprocess.TimeoutExpired:
            return {"status": "unavailable", "reason": "timeout"}
        except OSError:
            return {"status": "unavailable", "reason": "fixed command unavailable"}

    def _discover_names(self, command, *, unit=False):
        result = self._command(command)
        if result.get("status") != "ready":
            return result, set()
        names = set()
        lines = result.get("output", "").splitlines()
        if len(lines) > self.MAX_DISCOVERY_ITEMS:
            return {"status": "unavailable", "reason": "discovery item bound exceeded"}, set()
        for line in lines:
            name = line.split(None, 1)[0].strip() if unit else line.strip()
            pattern = self._UNIT if unit else self._NAME
            if not name or len(name) > 128 or not pattern.fullmatch(name):
                return {"status": "unavailable", "reason": "invalid discovery identity"}, set()
            if unit and not name.startswith(self.MANAGED_UNIT_PREFIXES):
                continue
            names.add(name)
        return result, names

    def _docker(self, name):
        return self._command(("docker", "inspect", "--format", self.DOCKER_FORMAT, name))

    def _project_revision(self, project: Path) -> dict[str, Any]:
        """Resolve a project's exact commit; never trust symbolic HEAD text."""
        projects_root = Path("/projects")
        if (projects_root.is_symlink() or project.parent != projects_root
                or project.is_symlink() or not self._NAME.fullmatch(project.name)):
            return {"status": "unavailable", "reason": "invalid project root"}
        # A project may be a normal directory while its .git metadata escapes
        # the checkout (or is a .git file/worktree indirection).  Refuse the
        # command before invoking git in either case.  The nonexistent path is
        # retained for the small injected unit test that exercises exact-SHA
        # parsing; real discovered entries always exist.
        git_dir = project / ".git"
        if git_dir.exists() or git_dir.is_symlink():
            if (git_dir.is_symlink() or not git_dir.is_dir()
                    or self._project_git_marker_status(project) != "metadata_only"):
                return {"status": "unavailable", "reason": "unsafe git metadata"}
        argv = ("git", "-C", str(project), "rev-parse", "--verify", "HEAD")
        try:
            result = self.runner(list(argv))
            if getattr(result, "returncode", 1) != 0:
                return {"status": "unavailable", "reason": "project revision unavailable"}
            raw = getattr(result, "stdout", "") or ""
            if len(raw.encode("utf-8", errors="replace")) > self.MAX_COMMAND_OUTPUT:
                return {"status": "unavailable", "reason": "project revision exceeds bound"}
            value = raw.strip()
            if not re.fullmatch(r"[0-9a-f]{40}", value):
                return {"status": "unparseable", "reason": "project revision is not an exact commit"}
            payload = (value + "\n").encode("ascii")
            return {"status": "ready", "value": value, "sha256": hashlib.sha256(payload).hexdigest()}
        except (OSError, subprocess.TimeoutExpired):
            return {"status": "unavailable", "reason": "project revision unavailable"}

    def collect(self, *, include_inventory: bool = False):
        checkout = self._command(("git", "-C", str(self.ROOT), "rev-parse", "--verify", "HEAD"))
        checkout_sha = checkout.get("output", "").strip() if checkout.get("status") == "ready" else ""
        if not re.fullmatch(r"[0-9a-f]{40}", checkout_sha):
            checkout = {"status": "unavailable", "reason": "invalid checkout SHA"}
        approved = self._absolute_file(self.APPROVED_SHA)
        if approved.get("status") == "ready" and not re.fullmatch(r"[0-9a-f]{40}", approved.get("value", "")):
            approved = {"status": "unavailable", "reason": "invalid approved SHA"}
        if checkout.get("status") == "ready" and approved.get("status") == "ready" and checkout_sha != approved.get("value"):
            approved["status"] = "revision_mismatch"
        container_discovery, discovered_containers = self._discover_names(self.DOCKER_DISCOVERY)
        self._observed_containers.update(discovered_containers)
        containers = {name: self._docker(name) for name in sorted(self._observed_containers)}
        volume_discovery, discovered_volumes = self._discover_names(self.DOCKER_VOLUME_DISCOVERY)
        volumes = {
            name: {"status": "ready", "name": name}
            for name in sorted(discovered_volumes)
        }
        unit_discovery, discovered_units = self._discover_names(self.SYSTEMD_DISCOVERY, unit=True)
        self._observed_units.update(discovered_units)
        project_checkouts = {}
        project_discovery = {"status": "ready", "items_seen": 0}
        projects_root = Path("/projects")
        try:
            # Do not materialize an unbounded host directory.  Keep only the
            # bounded prefix plus one overflow marker; ordering is restored
            # for the retained subset to make receipts deterministic enough
            # for normal hosts without paying an unbounded memory cost.
            entries = []
            overflow = False
            for entry in projects_root.iterdir():
                if len(entries) < self.MAX_DISCOVERY_ITEMS:
                    entries.append(entry)
                else:
                    overflow = True
                    break
            entries.sort(key=lambda item: item.name)
            if overflow:
                project_discovery = {
                    "status": "truncated",
                    "reason": "project discovery item bound exceeded",
                    "items_seen": self.MAX_DISCOVERY_ITEMS,
                }
            for entry in entries:
                if entry.is_symlink() or not entry.is_dir() or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", entry.name):
                    continue
                revision_fact = self._project_revision(entry)
                project_checkouts[entry.name] = {
                    "status": "ready" if revision_fact.get("status") == "ready" else "metadata_only",
                    "name": entry.name,
                    "git_head": {k: revision_fact[k] for k in ("status", "value", "sha256") if k in revision_fact},
                    "git_head_marker": {
                        "status": self._project_git_marker_status(entry),
                    },
                }
        except OSError:
            project_checkouts = {"status": "unavailable", "reason": "projects root inaccessible"}
            project_discovery = {"status": "unavailable", "reason": "projects root inaccessible"}
        if project_discovery.get("status") == "ready":
            project_discovery["items_seen"] = len(project_checkouts)
        facts = {"identity": {"root": str(self.ROOT), "host": self._file(".git/HEAD"),
                               "project_checkouts": project_checkouts,
                               "project_discovery": project_discovery},
                 "revision": {"checkout": checkout, "approved": approved, "files": {name: self._file(name) for name in self.FILES}},
                 "compose": {"containers": containers, "volumes": volumes,
                             "container_discovery": container_discovery,
                             "volume_discovery": volume_discovery},
                 "systemd": {unit: self._command(("systemctl", "show", "--no-pager", self.SYSTEMD_PROPERTY, unit))
                             for unit in sorted(self._observed_units)},
                 "caddy": {"config": self._file("apps/window/Caddyfile")},
                 "monitoring": {"status": "unavailable", "reason": "no direct monitoring provider configured"},
                 "deployment": {"approved_sha": approved, "checkout_sha": checkout, "build_context": self._file("governance/control-plane/build-context.yaml"), "container_revisions": containers},
                 "capabilities": {name: self._file(name) for name in ("apps/window/requirements.txt", "apps/window/package.json")},
                 "health": {}}
        facts["systemd"]["unit_discovery"] = unit_discovery
        for endpoint in self.HEALTH:
            if self.deadline is not None and time.monotonic() >= self.deadline:
                facts["health"][endpoint] = {
                    "status": "unavailable",
                    "reason": "collector deadline exceeded",
                }
                continue
            try:
                with self.opener(endpoint, timeout=self._remaining_timeout()) as response:
                    facts["health"][endpoint] = {"status": "ready", "http_status": response.status}
            except Exception as exc:  # fixed probes are evidence, not fatal dependencies
                facts["health"][endpoint] = {"status": "unavailable", "reason": type(exc).__name__}
        if include_inventory:
            try:
                window_root = Path(__file__).resolve().parents[1]
                if str(window_root) not in sys.path:
                    sys.path.insert(0, str(window_root))
                from graph.control_inventory import inventory, matrix_from_declarations

                declarations = self.ROOT / "governance" / "control-plane" / "source-adapters.yaml"
                matrix = matrix_from_declarations(declarations, self.ROOT)
                current_revision = checkout_sha if checkout.get("status") == "ready" else None
                overrides = {
                    adapter.adapter_id: current_revision
                    for adapter in matrix.adapters
                    if current_revision
                    and adapter.canonical_root == "/projects/frank"
                    and adapter.adapter_id not in {
                        "frank-agenttrail", "frank-archify-cli", "frank-archify-skill",
                    }
                }
                facts["capabilities"]["inventory"] = inventory(
                    matrix,
                    source_revisions=overrides,
                )
            except Exception as exc:
                facts["capabilities"]["inventory"] = {
                    "status": "unavailable",
                    "reason": type(exc).__name__,
                }
        return facts


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def redact(value: Any, *, _key: str = "") -> Any:
    """Return a deep redaction without mutating the source fixture."""
    if SECRET_KEYS.search(_key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {str(k): redact(v, _key=str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, _key=_key) for v in value]
    # Instruction bodies can contain credentials and are not evidence needed
    # by the inventory; retain only a bounded marker.
    if _key and BODY_KEYS.search(_key) and isinstance(value, str):
        return "[REDACTED_INSTRUCTION_BODY]"
    return value


def _find_unavailable(value: Any, path: str = "") -> list[dict[str, Any]]:
    found = []
    if isinstance(value, Mapping):
        if value.get("status") in (
            "unavailable", "inaccessible", "revision_mismatch", "timeout", "error", "stale", "truncated",
        ):
            found.append({"source": path, "status": value["status"], "reason": value.get("reason")})
        for key, child in value.items():
            found.extend(_find_unavailable(child, f"{path}.{key}" if path else str(key)))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(_find_unavailable(child, f"{path}[{index}]"))
    return found


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except PermissionError:
        # Windows does not expose directory handles with fsync semantics;
        # Linux production hosts take the durable-directory path above.
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _validate_directory_ancestors(path: Path) -> Path:
    """Reject symlinked/non-directory ancestors without following them."""
    absolute = Path(os.path.abspath(os.fspath(path)))
    current = absolute
    while True:
        try:
            info = os.lstat(os.fspath(current))
        except FileNotFoundError:
            parent = current.parent
            if parent == current:
                break
            current = parent
            continue
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("reconciliation path contains a symlink")
        if not stat.S_ISDIR(info.st_mode):
            raise ValueError("reconciliation path ancestor is not a directory")
        parent = current.parent
        if parent == current:
            break
        current = parent
    return absolute


def _prepare_reconciliation_root(data_root: Path) -> tuple[Path, Path]:
    """Create the collector root only after validating every existing hop."""
    data = _validate_directory_ancestors(data_root)
    data.mkdir(parents=True, exist_ok=True)
    data = _validate_directory_ancestors(data)
    reconciliations = _validate_directory_ancestors(data / "reconciliations")
    reconciliations.mkdir(parents=True, exist_ok=True)
    reconciliations = _validate_directory_ancestors(reconciliations)
    return data, reconciliations


def atomic_json(path: Path, value: Any) -> str:
    parent = _validate_directory_ancestors(path.parent)
    parent.mkdir(parents=True, exist_ok=True)
    _validate_directory_ancestors(parent)
    if path.is_symlink():
        raise ValueError("JSON target is a symlink")
    try:
        os.chmod(path.parent, 0o750)
    except OSError:
        pass
    payload = canonical(value) + b"\n"
    if len(payload) > MAX_ARTIFACT_BYTES:
        raise ValueError("JSON artifact exceeds fixed bound")
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if tmp.is_symlink():
        raise ValueError("JSON temporary target is a symlink")
    with open(tmp, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.chmod(tmp, 0o640)
    except OSError:
        pass
    os.replace(tmp, path)
    _fsync_dir(path.parent)
    return hashlib.sha256(payload).hexdigest()


def immutable_json(path: Path, value: Any) -> str:
    """Create an immutable JSON artifact, accepting an identical prior write."""
    payload = canonical(value) + b"\n"
    if len(payload) > MAX_ARTIFACT_BYTES:
        raise ValueError("immutable artifact exceeds fixed bound")
    digest = hashlib.sha256(payload).hexdigest()
    if path.exists():
        if path.is_symlink() or not path.is_file() or hashlib.sha256(_bounded_payload(path)).hexdigest() != digest:
            raise ValueError("immutable artifact collision")
        return digest
    return atomic_json(path, value)


def _failure_run(
    root: Path,
    scope: str,
    status: str,
    *,
    observed_at: float,
    details: Mapping[str, Any],
) -> dict[str, Any]:
    """Persist a terminal non-success outcome without advancing success pointers."""
    timestamp = datetime.fromtimestamp(observed_at, timezone.utc)
    seed = {"scope": scope, "status": status, "observed_at": observed_at, **dict(details)}
    time_key = timestamp.strftime("%Y%m%dt%H%M%S%z").lower().replace("+", "p")
    run_id = f"{scope}-{status.replace('_', '-')}-{time_key}-{fingerprint(seed)[:12]}"
    receipt = _receipt_envelope(scope, run_id, timestamp.isoformat(), "fail")
    receipt.update({
        "schema": VERSION,
        "run_id": run_id,
        "scope": scope,
        "mode": scope,
        "trigger_reason": None,
        "status": status,
        "observed_at": timestamp.isoformat(),
        **dict(details),
    })
    _validate_receipt_schema(receipt)
    run_dir = root / run_id
    if run_dir.is_symlink():
        raise ValueError("immutable failure run is a symlink")
    if run_dir.exists():
        prior = run_dir / "receipt.json"
        try:
            prior_value = _bounded_json(prior, root)
        except (OSError, ValueError, json.JSONDecodeError):
            prior_value = None
        if prior_value == receipt:
            return receipt
        raise ValueError("immutable failure run collision")
    staging = Path(tempfile.mkdtemp(prefix=f".{run_id}.", dir=root))
    try:
        os.chmod(staging, 0o750)
        immutable_json(staging / "declared.json", {"schema": VERSION, "scope": scope})
        immutable_json(staging / "observed.json", {"schema": VERSION, "scope": scope})
        immutable_json(
            staging / "findings.json",
            {"schema": VERSION, "scope": scope, "findings": [{"status": status, **dict(details)}]},
        )
        immutable_json(staging / "receipt.json", receipt)
        os.replace(staging, run_dir)
        _fsync_dir(root)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return receipt


def _safe_read(path: Path, root: Path) -> Any:
    resolved = path.resolve(strict=True)
    root = root.resolve()
    if root != resolved and root not in resolved.parents:
        raise ValueError("input path escapes fixed root")
    if not resolved.is_file() or path.is_symlink():
        raise ValueError("input must be a regular non-symlink file")
    with open(resolved, "rb") as handle:
        payload = handle.read(MAX_INPUT_BYTES + 1)
    if len(payload) > MAX_INPUT_BYTES:
        raise ValueError("input file exceeds fixed bound")
    return json.loads(payload)


RUN_ID = re.compile(r"(?:fast|full)-[a-z0-9][a-z0-9-]{2,127}\Z")
HEX_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _regular_path(path: Path, root: Path, *, directory: bool = False) -> Path | None:
    """Resolve one immutable path without following a symlink at any hop."""
    try:
        if path.is_symlink():
            return None
        resolved = path.resolve(strict=True)
        root_resolved = root.resolve(strict=True)
        if resolved == root_resolved or root_resolved not in resolved.parents:
            return None
        if directory and not resolved.is_dir():
            return None
        if not directory and not resolved.is_file():
            return None
        # Receipt/artifact paths must be direct children of their run dir;
        # this also rejects symlinked intermediate run directories.
        if any(part.is_symlink() for part in path.parents if part != root):
            return None
        return resolved
    except (OSError, RuntimeError, ValueError):
        return None


def _bounded_json(path: Path, root: Path, *, directory: bool = False) -> Any:
    resolved = _regular_path(path, root, directory=directory)
    if resolved is None:
        raise ValueError("immutable path is not a regular in-root path")
    payload = _bounded_payload(resolved)
    return json.loads(payload)


def _bounded_payload(path: Path) -> bytes:
    with open(path, "rb") as handle:
        payload = handle.read(MAX_ARTIFACT_BYTES + 1)
    if len(payload) > MAX_ARTIFACT_BYTES:
        raise ValueError("immutable artifact exceeds fixed bound")
    return payload


def _receipt_schema() -> Mapping[str, Any] | None:
    """Load the checked-in receipt schema used by this image and tests."""
    if Draft202012Validator is None:
        return None
    configured = os.environ.get("FRANK_REPOSITORY_ROOT")
    repository = Path(configured) if configured else Path(__file__).resolve().parents[3]
    try:
        value = json.loads((repository / RECEIPT_SCHEMA_RELATIVE).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, Mapping) else None


def _validate_receipt_schema(receipt: Mapping[str, Any]) -> None:
    schema = _receipt_schema()
    if schema is None:
        raise ValueError("receipt schema unavailable")
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(receipt),
        key=lambda item: tuple(str(part) for part in item.path),
    )
    if errors:
        raise ValueError("receipt schema validation failed")


def _revision_sets(facts: Mapping[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """Extract non-secret revision labels, keeping the envelope non-empty."""
    revision = facts.get("revision")
    revision = revision if isinstance(revision, Mapping) else {}

    def exact(value: Any) -> str | None:
        if isinstance(value, Mapping) and value.get("status") == "ready":
            value = value.get("output", value.get("value"))
        if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", value):
            return value
        return None

    source = None
    for key in ("checkout", "sha", "commit", "source"):
        value = exact(revision.get(key))
        if value:
            source = value
            break
    deployed = exact(revision.get("approved"))
    # The schema deliberately requires an explicit value even when the host
    # did not expose a revision; "unknown" is typed uncertainty, not a claim.
    return ({"project:frank": source or "unknown"}, {"project:frank": deployed or source or "unknown"})


def _receipt_envelope(scope: str, run_id: str, captured_at: str, outcome: str,
                     facts: Mapping[str, Any] | None = None) -> dict[str, Any]:
    captured = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    fresh_until = None
    if outcome == "pass":
        fresh_until = (captured.timestamp() + FRESHNESS_SECONDS[scope])
        fresh_until = datetime.fromtimestamp(fresh_until, timezone.utc).isoformat().replace("+00:00", "Z")
    source, deployed = _revision_sets(facts or {})
    return {
        "id": f"receipt:reconciliation/{run_id}",
        "receipt_id": f"receipt:reconciliation/{run_id}",
        "kind": "reconciliation",
        "subject_ids": ["service:frank-window"] if scope == "fast" else ["vps:dedicated"],
        "producer": "frank-control-reconcile",
        "source_revision_set": source,
        "deployed_revision_set": deployed,
        "captured_at": captured_at,
        "fresh_until": fresh_until,
        "outcome": outcome,
        "evidence_uris": [f"reconciliation://{run_id}"],
        "redaction": "secret_filtered",
    }


def _validated_lock_owner(value: Any, scope: str) -> dict[str, Any] | None:
    """Return only the small, typed owner envelope accepted in a receipt."""
    if not isinstance(value, Mapping) or value.get("scope") != scope:
        return None
    owner = value.get("owner")
    run_id = value.get("run_id")
    started_at = value.get("started_at")
    expires_at = value.get("expires_at")
    if (not isinstance(owner, str) or not re.fullmatch(r"pid:[0-9]{1,10}", owner)
            or not isinstance(run_id, str) or not re.fullmatch(r"pending-[0-9]{1,10}", run_id)
            or not isinstance(started_at, (int, float)) or isinstance(started_at, bool)
            or not isinstance(expires_at, (int, float)) or isinstance(expires_at, bool)
            or not math.isfinite(float(started_at)) or not math.isfinite(float(expires_at))):
        return None
    return {
        "scope": scope,
        "owner": owner,
        "run_id": run_id,
        "started_at": float(started_at),
        "expires_at": float(expires_at),
    }


class Collector:
    """Collector with dependency injection reserved for deterministic tests."""

    def __init__(self, data_root: Path | str, *, sources: Mapping[str, Any] | None = None,
                 input_root: Path | str | None = None, timeout_seconds: float | None = None,
                 clock=None):
        self.data_root = Path(data_root)
        self.input_root = Path(input_root) if input_root else None
        self.sources = copy.deepcopy(dict(sources)) if sources is not None else None
        self.host_source = HostFactSource()
        self.timeout_seconds = timeout_seconds
        self.clock = clock or time.time

    def _inputs(self, scope: str) -> dict[str, Any]:
        if self.sources is not None:
            unknown = set(self.sources) - ALLOWED_SOURCES
            if unknown:
                raise ValueError(f"unexpected source(s): {sorted(unknown)}")
            return copy.deepcopy(self.sources)
        if self.input_root is None:
            return self.host_source.collect(include_inventory=scope == "full")
        output = {}
        for source in sorted(ALLOWED_SOURCES):
            path = self.input_root / f"{source}.json"
            if path.exists():
                output[source] = _safe_read(path, self.input_root)
        return output

    def _declared_catalog(self, scope: str, approved_sha: str | None = None) -> Mapping[str, Any] | None:
        """Load and validate catalog.yaml from the approved Git blob only."""
        if scope != "full" or self.sources is not None or yaml is None:
            return None
        if not isinstance(approved_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", approved_sha):
            return None
        catalog_command = (
            "git", "-C", str(self.host_source.ROOT), "show", approved_sha,
            "governance/control-plane/catalog.yaml",
        )
        try:
            catalog_result = self.host_source._command(catalog_command)
            if catalog_result.get("status") != "ready":
                return None
            payload = catalog_result.get("output", "").encode("utf-8")
            if len(payload) > self.host_source.MAX_FILE_BYTES:
                return None
            value = yaml.load(payload.decode("utf-8"), Loader=_UniqueKeyLoader)
            if not isinstance(value, Mapping) or Draft202012Validator is None:
                return None
            schema_result = self.host_source._command((
                "git", "-C", str(self.host_source.ROOT), "show", approved_sha,
                "governance/control-plane/schema/catalog.schema.json",
            ))
            if schema_result.get("status") != "ready":
                return None
            schema_payload = schema_result.get("output", "").encode("utf-8")
            if len(schema_payload) > self.host_source.MAX_FILE_BYTES:
                return None
            schema = json.loads(schema_payload)
            errors = sorted(Draft202012Validator(schema).iter_errors(value),
                            key=lambda item: tuple(str(part) for part in item.path))
            if errors:
                return None
            return redact(value)
        except Exception:
            # Catalog loading is evidence, not a reason to expose parser paths
            # or exception details in a receipt.
            return None

    def run(self, mode: str, *, trigger_reason: str | None = None) -> dict[str, Any]:
        if mode not in MODES:
            raise ValueError("mode must be fast, full, or post_deploy")
        if mode == "post_deploy":
            fast = self.run("fast", trigger_reason="post_deploy")
            full = self.run("full", trigger_reason="post_deploy")
            ok = fast.get("status") in ("success", "already_running") and full.get("status") in ("success", "already_running")
            return {"schema": VERSION, "mode": mode, "trigger_reason": "post_deploy",
                    "status": "success" if ok else "error", "fast": fast, "full": full}
        scope = "fast" if mode in ("fast", "post_deploy") else "full"
        timeout_seconds = (
            MODE_TIMEOUT_SECONDS[scope]
            if self.timeout_seconds is None else self.timeout_seconds
        )
        root_data, root = _prepare_reconciliation_root(self.data_root)
        try:
            os.chmod(root_data, 0o750)
            os.chmod(root, 0o750)
        except OSError:
            pass
        lock = root / f".{scope}.lock"
        lock_payload = {"scope": scope, "owner": f"pid:{os.getpid()}", "run_id": f"pending-{os.getpid()}", "started_at": self.clock(), "expires_at": self.clock() + timeout_seconds}
        fd: int | None = None
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o640)
            os.write(fd, canonical(lock_payload))
            os.fsync(fd)
        except FileExistsError:
            if lock.is_symlink():
                return _failure_run(
                    root, scope, "error", observed_at=self.clock(),
                    details={"error_type": "unsafe lock path"},
                )
            owner = None
            try:
                owner = _bounded_json(lock, root)
            except (OSError, ValueError, json.JSONDecodeError):
                pass
            owner_metadata = _validated_lock_owner(owner, scope)
            if owner_metadata and owner_metadata["expires_at"] <= self.clock():
                try:
                    lock.unlink()
                    _fsync_dir(root)
                    return self.run(mode, trigger_reason=trigger_reason)
                except FileNotFoundError:
                    return self.run(mode, trigger_reason=trigger_reason)
            return _failure_run(
                root,
                scope,
                "already_running",
                observed_at=self.clock(),
                details={"owner": owner_metadata},
            )
        except Exception:
            if fd is not None:
                os.close(fd)
                try:
                    lock.unlink()
                except FileNotFoundError:
                    pass
            raise
        staging: Path | None = None
        try:
            started = self.clock()
            deadline = time.monotonic() + max(0.0, timeout_seconds)
            self.host_source.deadline = deadline
            inputs = self._inputs(scope)
            if self.clock() - started > timeout_seconds or time.monotonic() > deadline:
                raise TimeoutError("collector timeout")
            clean = redact(inputs)
            if len(canonical(clean)) > MAX_FACTS_BYTES:
                raise ValueError("aggregate facts exceed fixed bound")
            approved_record = clean.get("revision", {}).get("approved", {}) \
                if isinstance(clean.get("revision"), Mapping) else {}
            approved_value = approved_record.get("value") \
                if isinstance(approved_record, Mapping) and approved_record.get("status") == "ready" else None
            production_full = (
                scope == "full" and self.sources is None and self.input_root is None
            )
            # Keep the host deadline active while the approved catalog and
            # schema blobs are loaded.  A normal host full collection cannot
            # be accepted without that immutable declaration.
            catalog = self._declared_catalog(scope, approved_value)
            if production_full and catalog is None:
                raise ValueError("approved catalog unavailable")
            if self.clock() - started > timeout_seconds or time.monotonic() > deadline:
                raise TimeoutError("collector timeout")
            source_fingerprints = {k: fingerprint(v) for k, v in sorted(clean.items())}
            overall = fingerprint({"version": VERSION, "scope": scope, "sources": source_fingerprints})
            dedup = root / "fingerprints" / f"{overall}.json"
            if dedup.is_symlink():
                raise ValueError("deduplication record is a symlink")
            if dedup.exists():
                try:
                    prior = _bounded_json(dedup, root)
                    run_id = prior.get("run_id") if isinstance(prior, Mapping) else None
                    prior_artifacts = prior.get("artifact_hashes") if isinstance(prior, Mapping) else None
                    if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
                        raise ValueError("invalid prior run ID")
                    if (not isinstance(prior_artifacts, Mapping)
                            or set(prior_artifacts) != {"declared.json", "observed.json", "findings.json"}):
                        raise ValueError("invalid prior artifact set")
                    if prior.get("scope") != scope or prior.get("status") != "success" \
                            or prior.get("input_fingerprint") != overall:
                        raise ValueError("prior receipt metadata mismatch")
                    prior_dir = _regular_path(root / run_id, root, directory=True)
                    if prior_dir is None or prior_dir.parent != root.resolve(strict=True):
                        raise ValueError("prior run escapes reconciliation root")
                    prior_path = _regular_path(prior_dir / "receipt.json", root)
                    if prior_path is None or prior_path.parent != prior_dir:
                        raise ValueError("invalid prior receipt path")
                    receipt = _bounded_json(prior_path, root)
                    if (not isinstance(receipt, Mapping) or receipt.get("run_id") != run_id
                            or receipt.get("scope") != scope or receipt.get("status") != "success"
                            or receipt.get("input_fingerprint") != overall):
                        raise ValueError("prior receipt metadata mismatch")
                    if not _receipt_is_fresh(receipt, now=self.clock()):
                        raise ValueError("prior receipt is stale")
                    receipt_artifacts = receipt.get("artifact_hashes")
                    if (not isinstance(receipt_artifacts, Mapping)
                            or set(receipt_artifacts) != set(prior_artifacts)):
                        raise ValueError("invalid receipt artifact set")
                    receipt_hash = prior.get("receipt_hash")
                    if not isinstance(receipt_hash, str) or not HEX_SHA256.fullmatch(receipt_hash):
                        raise ValueError("invalid prior receipt hash")
                    if hashlib.sha256(_bounded_payload(prior_path)).hexdigest() != receipt_hash:
                        raise ValueError("invalid prior receipt hash")
                    for name in sorted(prior_artifacts):
                        digest = prior_artifacts[name]
                        if not isinstance(digest, str) or not HEX_SHA256.fullmatch(digest):
                            raise ValueError("invalid prior artifact hash")
                        artifact = _regular_path(prior_dir / name, root)
                        if artifact is None or artifact.parent != prior_dir:
                            raise ValueError("invalid prior artifact path")
                        if hashlib.sha256(_bounded_payload(artifact)).hexdigest() != digest:
                            raise ValueError("invalid prior artifact")
                        if receipt_artifacts.get(name) != digest:
                            raise ValueError("receipt artifact hash mismatch")
                    atomic_json(root / f"latest-{scope}.json", {
                        "run_id": prior["run_id"],
                        "receipt": str(Path(prior["run_id"]) / "receipt.json"),
                        "receipt_hash": prior["receipt_hash"],
                        "input_fingerprint": overall,
                    })
                    return prior
                except (OSError, ValueError, KeyError, json.JSONDecodeError):
                    pass
            time_key = (
                datetime.fromtimestamp(self.clock(), timezone.utc)
                .strftime("%Y%m%dt%H%M%S%z")
                .lower()
                .replace("+", "p")
            )
            run_id = f"{scope}-{time_key}-{overall[:12]}"
            captured_at = datetime.fromtimestamp(self.clock(), timezone.utc).isoformat()
            record = _receipt_envelope(scope, run_id, captured_at, "pass", clean)
            record.update({
                "schema": VERSION,
                "run_id": run_id,
                "scope": scope,
                "mode": mode,
                "trigger_reason": trigger_reason,
                "status": "success",
                "input_fingerprint": overall,
                "source_fingerprints": source_fingerprints,
                "observed_at": captured_at,
                "facts": clean,
            })
            run_dir = root / run_id
            if run_dir.is_symlink():
                raise ValueError("immutable reconciliation run is a symlink")
            if run_dir.exists():
                raise ValueError("immutable reconciliation run already exists")
            staging = Path(tempfile.mkdtemp(prefix=f".{run_id}.", dir=root))
            os.chmod(staging, 0o750)
            declared = {"schema": VERSION, "scope": scope, "input_fingerprint": overall,
                        "source_fingerprints": source_fingerprints}
            if catalog is not None:
                declared["catalog"] = catalog
            observed = {"schema": VERSION, "scope": scope, "facts": clean}
            findings = {"schema": VERSION, "scope": scope, "findings": _find_unavailable(clean)}
            artifact_hashes = {}
            for name, payload in (
                ("declared.json", declared),
                ("observed.json", observed),
                ("findings.json", findings),
            ):
                artifact_hashes[name] = immutable_json(staging / name, payload)
            if any(hashlib.sha256(_bounded_payload(staging / name)).hexdigest() != digest
                   for name, digest in artifact_hashes.items()):
                raise ValueError("artifact validation failed")
            receipt_path = staging / "receipt.json"
            record["artifact_hashes"] = artifact_hashes
            _validate_receipt_schema(record)
            receipt_hash = immutable_json(receipt_path, record)
            validated = _bounded_json(receipt_path, staging)
            if fingerprint(validated) != fingerprint(record):
                raise ValueError("receipt validation failed")
            os.replace(staging, run_dir)
            _fsync_dir(root)
            record["receipt_hash"] = receipt_hash
            pointer = root / f"latest-{scope}.json"
            atomic_json(dedup, record)
            atomic_json(pointer, {
                "run_id": run_id,
                "receipt": str(Path(run_id) / "receipt.json"),
                "receipt_hash": receipt_hash,
                "input_fingerprint": overall,
            })
            return record
        except TimeoutError as exc:
            return _failure_run(
                root,
                scope,
                "timeout",
                observed_at=self.clock(),
                details={"error_type": type(exc).__name__},
            )
        except Exception as exc:
            return _failure_run(
                root,
                scope,
                "error",
                observed_at=self.clock(),
                details={"error_type": type(exc).__name__},
            )
        finally:
            self.host_source.deadline = None
            os.close(fd)
            if staging is not None and staging.exists():
                shutil.rmtree(staging)
            try:
                lock.unlink()
                _fsync_dir(root)
            except FileNotFoundError:
                pass


def collect(mode: str, data_root: Path | str, *, sources: Mapping[str, Any] | None = None,
            input_root: Path | str | None = None, timeout_seconds: float | None = None,
            trigger_reason: str | None = None) -> dict[str, Any]:
    """Small functional entry point for host wrappers and fixture tests."""
    return Collector(data_root, sources=sources, input_root=input_root,
                     timeout_seconds=timeout_seconds).run(mode,
                     trigger_reason=trigger_reason)


def read_latest(data_root: Path | str, scope: str) -> dict[str, Any]:
    """Read and verify a latest pointer and its immutable receipt."""
    if scope not in ("fast", "full"):
        raise ValueError("invalid scope")
    data = _validate_directory_ancestors(Path(data_root))
    root = _validate_directory_ancestors(data / "reconciliations")
    pointer = root / f"latest-{scope}.json"
    if pointer.is_symlink() or not pointer.is_file():
        raise ValueError("invalid latest pointer")
    meta = _bounded_json(pointer, root)
    run_id = meta.get("run_id") if isinstance(meta, Mapping) else None
    if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
        raise ValueError("invalid latest run ID")
    if meta.get("receipt") != str(Path(run_id) / "receipt.json"):
        raise ValueError("invalid latest receipt path")
    target = _regular_path(root / meta["receipt"], root)
    if target is None or target.name != "receipt.json" or target.parent.parent != root.resolve(strict=True):
        raise ValueError("receipt escapes reconciliation root")
    receipt_payload = _bounded_payload(target)
    if hashlib.sha256(receipt_payload).hexdigest() != meta.get("receipt_hash"):
        raise ValueError("receipt hash mismatch")
    receipt = json.loads(receipt_payload)
    if (receipt.get("run_id") != run_id or receipt.get("scope") != scope
            or receipt.get("status") != "success"):
        raise ValueError("receipt metadata mismatch")
    _validate_receipt_schema(receipt)
    if not _receipt_is_fresh(receipt):
        raise ValueError("receipt is stale")
    artifacts = receipt.get("artifact_hashes", {})
    if set(artifacts) != {"declared.json", "observed.json", "findings.json"}:
        raise ValueError("receipt artifact set mismatch")
    for name, digest in artifacts.items():
        artifact = target.parent / name
        if (_regular_path(artifact, root) is None
                or artifact.parent != target.parent
                or not isinstance(digest, str) or not HEX_SHA256.fullmatch(digest)
                or hashlib.sha256(_bounded_payload(artifact)).hexdigest() != digest):
            raise ValueError("artifact hash mismatch")
    return receipt


def _receipt_is_fresh(receipt: Mapping[str, Any], *, now: float | None = None) -> bool:
    """Return whether a successful receipt is within its declared window."""
    if receipt.get("outcome") != "pass" or receipt.get("status") != "success":
        return False
    fresh_until = receipt.get("fresh_until")
    captured_at = receipt.get("captured_at")
    if not isinstance(fresh_until, str) or not isinstance(captured_at, str):
        return False
    try:
        captured = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        expiry = datetime.fromisoformat(fresh_until.replace("Z", "+00:00"))
    except ValueError:
        return False
    if expiry <= captured:
        return False
    current = datetime.fromtimestamp(time.time() if now is None else now, timezone.utc)
    return current < expiry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=sorted(MODES))
    args = parser.parse_args(argv)
    # Production paths are fixed by the service unit; no path/command/network
    # options are accepted here.
    result = Collector(Path("/srv/frank/data/window/control-graph")).run(args.mode,
        trigger_reason="post_deploy" if args.mode == "post_deploy" else None)
    if result.get("status") in ("success", "already_running"):
        # The only host-to-container execution permitted by the control plane.
        pipeline = HostFactSource()._command(
            ("docker", "exec", "frank-window", "python", "-m", "graph.control_pipeline")
        )
        if pipeline.get("status") != "ready":
            result = {"status": "error", "collector": result, "pipeline": pipeline}
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("status") in ("success", "already_running") else 1


if __name__ == "__main__":
    raise SystemExit(main())
