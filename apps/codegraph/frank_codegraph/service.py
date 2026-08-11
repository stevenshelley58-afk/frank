"""Internal Graphify lifecycle service.

This module deliberately does not parse source files or resolve code edges.
Those responsibilities belong exclusively to Graphify. Frank only owns the
operator registry, lifecycle control, atomic publication, and explicit
project/module/skill/tool metadata overlay.
"""

from __future__ import annotations

import json
import hmac
import fnmatch
import itertools
import logging
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer


LOG = logging.getLogger("frank-codegraph")
TRUSTED_PYTHONPATH = "/app:/opt/frank-codegraph/site-packages"
PROJECT_ID = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
MAX_CONTROL_BODY = 16 * 1024
MAX_REGISTRY_BYTES = 1024 * 1024
MAX_PROJECTS = 100
MAX_IGNORE_PATTERNS = 256
DEFAULT_IGNORE = (".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage", "__pycache__")
RELEASE_NAME = re.compile(r"^\d{8}T\d{6}Z-[a-f0-9]{12}$")
PRIOR_RELEASES_TO_KEEP = 3
COMMAND_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
MAX_METADATA_FILES = 50_000
MAX_WALK_DIRECTORIES = 100_000
MAX_SOURCE_FILES = 1_000_000
MAX_METADATA_FILE_BYTES = 2 * 1024 * 1024
MAX_METADATA_TOTAL_BYTES = 64 * 1024 * 1024
MAX_FRONTMATTER_BYTES = 64 * 1024
MAX_METADATA_STRING_CHARS = 4096
MAX_OVERLAY_NODES = 50_000
MAX_OVERLAY_EDGES = 200_000
MAX_GRAPH_FILE_BYTES = 32 * 1024 * 1024
MAX_GRAPH_NODES = 50_000
MAX_GRAPH_EDGES = 200_000
MAX_GRAPH_STRING_CHARS = 32_768
MAX_GRAPH_VALUES_INSPECTED = 5_000_000
MAX_RELEASE_BYTES = 2 * 1024 * 1024 * 1024
MAX_RELEASE_FILES = 500_000
MIN_FREE_BYTES = 512 * 1024 * 1024
MAX_CONTROL_CONNECTIONS = 16
CONTROL_SOCKET_TIMEOUT_SECONDS = 5.0
GRAPHIFY_TIMEOUT_SECONDS = 1800
MAX_PROCESS_LOG_TAIL = 8192
MAX_JOB_HISTORY = 512
MAX_COMMAND_HISTORY = 4096
MAX_COMMAND_IDS_PER_JOB = 256
JOB_HISTORY_TTL = timedelta(hours=24)
MAX_CONTROL_STATE_BYTES = 2 * 1024 * 1024


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def json_write_atomic(path: Path, data: Any) -> None:
    """Publish a small runtime manifest without following an existing link."""
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    payload = (json.dumps(data, sort_keys=True, indent=2) + "\n").encode("utf-8")
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        os.close(descriptor)
        temporary.unlink(missing_ok=True)


def parse_utc(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def checked_directory(path: Path, *, parent: Path | None = None, create: bool = False) -> Path:
    """Return a real, non-linked directory constrained to its validated parent."""
    if create:
        try:
            path.mkdir(mode=0o750)
        except FileExistsError:
            pass
    try:
        info = os.lstat(path)
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError(f"required output directory is unavailable: {path}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise RuntimeError(f"output directory must be a real directory: {path}")
    if parent is not None:
        parent_resolved = checked_directory(parent)
        if resolved.parent != parent_resolved:
            raise RuntimeError(f"output directory escapes its parent: {path}")
    return resolved


def ensure_project_layout(output_root: Path, project_id: str) -> tuple[Path, Path, Path]:
    output = checked_directory(output_root)
    project = checked_directory(output / project_id, parent=output, create=True)
    releases = checked_directory(project / "releases", parent=project, create=True)
    staging = checked_directory(project / ".staging", parent=project, create=True)
    return project, releases, staging


def safe_name(value: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", value.lower()).strip("-") or "unnamed"


def validate_ignore(value: str, project_id: str) -> str:
    """Validate registry-owned Graphify exclude patterns before CLI use."""
    if not value or len(value) > 240 or value.startswith("-"):
        raise ValueError(f"project {project_id}: invalid ignore entry")
    if "\\" in value or any(ord(character) < 32 for character in value):
        raise ValueError(f"project {project_id}: invalid ignore entry")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or value in {".", "/"}:
        raise ValueError(f"project {project_id}: ignore entries must be safe relative patterns")
    return value


def load_control_token(path: Path) -> str:
    content = read_bounded_bytes(path, 4097)
    if content is None:
        raise RuntimeError(f"codegraph control token file is unavailable: {path}")
    try:
        token = content.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise RuntimeError("codegraph control token must be UTF-8") from exc
    if len(token) < 32 or len(token) > 4096 or any(character.isspace() for character in token):
        raise RuntimeError("codegraph control token must be a 32-4096 character whitespace-free secret")
    return token


def authorized(control_token: str, authorization: str | None) -> bool:
    supplied = authorization or ""
    expected = f"Bearer {control_token}"
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    mount: Path
    ignore: tuple[str, ...] = DEFAULT_IGNORE
    source: str = "manual"

    @classmethod
    def from_json(cls, item: Any) -> "Project":
        if not isinstance(item, dict):
            raise ValueError("project registrations must be objects")
        project_id = item.get("id")
        name = item.get("name")
        mount = item.get("mount")
        if not isinstance(project_id, str) or not PROJECT_ID.fullmatch(project_id):
            raise ValueError("project id must be a lowercase opaque identifier")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"project {project_id}: name is required")
        if not isinstance(mount, str):
            raise ValueError(f"project {project_id}: mount is required")
        mount_path = Path(mount).resolve()
        allowed = Path("/repositories")
        try:
            mount_path.relative_to(allowed)
        except ValueError as exc:
            raise ValueError(f"project {project_id}: mount must be below /repositories") from exc
        if mount_path != allowed / project_id:
            raise ValueError(f"project {project_id}: mount must be /repositories/{project_id}")
        ignores = item.get("ignore", list(DEFAULT_IGNORE))
        if not isinstance(ignores, list) or not all(isinstance(value, str) for value in ignores):
            raise ValueError(f"project {project_id}: ignore must be a string list")
        if len(ignores) > MAX_IGNORE_PATTERNS:
            raise ValueError(f"project {project_id}: too many ignore entries")
        source = item.get("source", "manual")
        if source != "manual":
            raise ValueError(f"project {project_id}: source must be manual")
        validated = tuple(sorted({validate_ignore(value, project_id) for value in ignores}))
        return cls(project_id, name.strip(), mount_path, validated, source)


def load_registry(path: Path) -> list[Project]:
    try:
        content = read_bounded_bytes(path, MAX_REGISTRY_BYTES)
        if content is None:
            raise RuntimeError(f"operator registry is missing, linked, or oversized: {path}")
        raw = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise RuntimeError(f"operator registry is invalid JSON: {path}") from exc
    items = raw.get("projects") if isinstance(raw, dict) else None
    if not isinstance(items, list) or not items:
        raise RuntimeError("operator registry must contain at least one project")
    if len(items) > MAX_PROJECTS:
        raise RuntimeError("operator registry exceeds project limit")
    projects = [Project.from_json(item) for item in items]
    ids = [project.id for project in projects]
    if len(ids) != len(set(ids)):
        raise RuntimeError("operator registry contains duplicate project ids")
    for project in projects:
        if not project.mount.is_dir():
            raise RuntimeError(f"project {project.id}: mounted repository is unavailable")
    return projects


def is_ignored(path: Path, root: Path, ignored: set[str]) -> bool:
    try:
        relative = path.relative_to(root).as_posix()
    except ValueError:
        return True
    return any(
        fnmatch.fnmatchcase(relative, pattern)
        or any(fnmatch.fnmatchcase(part, pattern) for part in Path(relative).parts)
        for pattern in ignored
    )


def read_bounded_bytes(path: Path, max_bytes: int, prefix_bytes: int | None = None) -> bytes | None:
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        return None
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            return None
        read_limit = prefix_bytes if prefix_bytes is not None else max_bytes
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            content = handle.read(read_limit + 1)
        if prefix_bytes is not None:
            return content[:prefix_bytes]
        return content if len(content) <= max_bytes else None
    finally:
        os.close(descriptor)


def read_json_object(path: Path, max_bytes: int = MAX_METADATA_FILE_BYTES) -> dict[str, Any] | None:
    try:
        content = read_bounded_bytes(path, max_bytes)
        if content is None:
            return None
        value = json.loads(content)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def raise_walk_error(error: OSError) -> None:
    raise RuntimeError(f"bounded filesystem scan failed: {error.filename or 'unknown path'}") from error


def frontmatter(path: Path) -> dict[str, Any]:
    """Read only explicit YAML-lite frontmatter; never infer from prose."""
    prefix = read_bounded_bytes(path, MAX_METADATA_FILE_BYTES, MAX_FRONTMATTER_BYTES)
    if prefix is None:
        return {}
    lines = prefix.decode("utf-8", errors="replace").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    result: dict[str, Any] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line or line.startswith((" ", "\t", "#")):
            continue
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if not key:
            continue
        if value.startswith("[") and value.endswith("]"):
            result[key] = [part.strip().strip("'\"") for part in value[1:-1].split(",") if part.strip()]
        else:
            result[key] = value.strip("'\"")
    return result


def iter_metadata_files(project: Project):
    """Yield bounded, in-repository manifest files without following links."""
    root = project.mount
    ignored = set(project.ignore)
    file_count = 0
    directory_count = 0
    total_bytes = 0
    wanted = {"package.json", "SKILL.md", "tool.json", "tool.manifest.json", "mcp.json"}
    for directory, directories, files in os.walk(root, topdown=True, onerror=raise_walk_error, followlinks=False):
        directory_path = Path(directory)
        directory_count += 1
        if directory_count > MAX_WALK_DIRECTORIES:
            raise RuntimeError("metadata directory scan limit exceeded")
        directories[:] = [
            name for name in sorted(directories)
            if not (directory_path / name).is_symlink()
            and not is_ignored(directory_path / name, root, ignored)
        ]
        for name in sorted(files):
            if name not in wanted:
                continue
            path = directory_path / name
            if path.is_symlink() or is_ignored(path, root, ignored):
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            file_count += 1
            total_bytes += size
            if file_count > MAX_METADATA_FILES:
                raise RuntimeError("metadata manifest count limit exceeded")
            if size > MAX_METADATA_FILE_BYTES:
                raise RuntimeError(f"metadata manifest exceeds byte limit: {path.relative_to(root)}")
            if total_bytes > MAX_METADATA_TOTAL_BYTES:
                raise RuntimeError("metadata manifest aggregate byte limit exceeded")
            yield path


def validate_repository_tree(project: Project) -> None:
    """Bound the source walk and reject links before Graphify sees the tree."""
    ignored = set(project.ignore)
    directories_seen = 0
    files_seen = 0
    for directory, directories, files in os.walk(project.mount, topdown=True, onerror=raise_walk_error, followlinks=False):
        directory_path = Path(directory)
        directories_seen += 1
        if directories_seen > MAX_WALK_DIRECTORIES:
            raise RuntimeError("repository directory scan limit exceeded")
        retained: list[str] = []
        for name in sorted(directories):
            path = directory_path / name
            if path.is_symlink():
                raise RuntimeError(f"repository directory symlink is not allowed: {path.relative_to(project.mount)}")
            if not is_ignored(path, project.mount, ignored):
                retained.append(name)
        directories[:] = retained
        for name in files:
            path = directory_path / name
            if path.is_symlink():
                raise RuntimeError(f"repository file symlink is not allowed: {path.relative_to(project.mount)}")
            if is_ignored(path, project.mount, ignored):
                continue
            files_seen += 1
            if files_seen > MAX_SOURCE_FILES:
                raise RuntimeError("repository file scan limit exceeded")


def _package_tool_declarations(package: dict[str, Any]) -> list[dict[str, Any]]:
    frank = package.get("frank")
    declared = frank.get("tools") if isinstance(frank, dict) else None
    if not isinstance(declared, list):
        return []
    tools: list[dict[str, Any]] = []
    for item in declared:
        if isinstance(item, str) and item.strip():
            tools.append({"name": item.strip()})
        elif isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip():
            tools.append(item)
    return tools


def _manifest_tool_declaration(manifest: dict[str, Any]) -> dict[str, Any] | None:
    frank = manifest.get("frank")
    kind = manifest.get("kind") or (frank.get("kind") if isinstance(frank, dict) else None)
    name = manifest.get("name") or (frank.get("name") if isinstance(frank, dict) else None)
    if kind == "tool" and isinstance(name, str) and name.strip():
        return {"name": name.strip(), "description": manifest.get("description")}
    return None


def build_overlay(project: Project, generated_at: str) -> dict[str, Any]:
    """Build domain metadata solely from explicit manifests and frontmatter."""
    root = project.mount
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    project_node = f"project:{project.id}"
    nodes.append({"id": project_node, "type": "Project", "name": project.name, "source": project.source})
    packages: list[tuple[Path, dict[str, Any], str]] = []
    skill_specs: list[tuple[Path, dict[str, Any], str]] = []
    explicit_tools: list[tuple[Path, dict[str, Any], str | None]] = []
    for path in iter_metadata_files(project):
        rel = path.relative_to(root).as_posix()
        if path.name == "package.json":
            package = read_json_object(path)
            if package and isinstance(package.get("name"), str) and package["name"].strip():
                packages.append((path, package, rel))
        elif path.name == "SKILL.md":
            skill_specs.append((path, frontmatter(path), rel))
        elif path.name in {"tool.json", "tool.manifest.json", "mcp.json"}:
            manifest = read_json_object(path)
            declaration = _manifest_tool_declaration(manifest) if manifest else None
            if declaration:
                explicit_tools.append((path, declaration, None))
    module_by_package: dict[str, str] = {}
    module_by_directory: dict[Path, str] = {}
    for path, package, rel in packages:
        package_name = package["name"].strip()
        module_id = f"module:{project.id}:{safe_name(package_name)}"
        module_by_package[package_name] = module_id
        module_by_directory[path.parent] = module_id
        nodes.append({"id": module_id, "type": "Module", "name": package_name, "source_file": rel})
        edges.append({"type": "contains", "source": project_node, "target": module_id})
    for _, package, _ in packages:
        source = module_by_package.get(package["name"].strip())
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            values = package.get(section)
            if not isinstance(values, dict):
                continue
            for dependency in sorted(values):
                target = module_by_package.get(dependency)
                if source and target and source != target:
                    edges.append({"type": "depends_on", "source": source, "target": target})
    tool_nodes: dict[str, str] = {}
    def add_tool(declaration: dict[str, Any], path: Path, owner: str | None) -> None:
        name = declaration["name"].strip()
        tool_id = f"tool:{project.id}:{safe_name(name)}"
        if tool_id not in tool_nodes:
            node: dict[str, Any] = {"id": tool_id, "type": "Tool", "name": name, "source_file": path.relative_to(root).as_posix()}
            if isinstance(declaration.get("description"), str):
                node["description"] = declaration["description"]
            nodes.append(node)
            tool_nodes[tool_id] = tool_id
        edges.append({"type": "declares", "source": owner or project_node, "target": tool_id})
    for path, package, _ in packages:
        owner = module_by_directory.get(path.parent)
        for declaration in _package_tool_declarations(package):
            add_tool(declaration, path, owner)
    for path, declaration, owner in explicit_tools:
        add_tool(declaration, path, owner)
    for path, metadata, rel in skill_specs:
        name = metadata.get("name") if isinstance(metadata.get("name"), str) else path.parent.name
        skill_id = f"skill:{project.id}:{safe_name(name)}"
        nodes.append({"id": skill_id, "type": "Skill", "name": name, "source_file": rel})
        edges.append({"type": "contains", "source": project_node, "target": skill_id})
        tools = metadata.get("tools")
        if isinstance(tools, str):
            tools = [tools]
        if isinstance(tools, list):
            for tool_name in sorted(value for value in tools if isinstance(value, str)):
                tool_id = f"tool:{project.id}:{safe_name(tool_name)}"
                if tool_id in tool_nodes:
                    edges.append({"type": "skill_uses_tool", "source": skill_id, "target": tool_id})
    unique_edges = {(edge["type"], edge["source"], edge["target"]): edge for edge in edges}
    if len(nodes) > MAX_OVERLAY_NODES or len(unique_edges) > MAX_OVERLAY_EDGES:
        raise RuntimeError("Frank overlay exceeds node or edge safety limits")
    for record in itertools.chain(nodes, unique_edges.values()):
        for value in record.values():
            if isinstance(value, str) and len(value) > MAX_METADATA_STRING_CHARS:
                raise RuntimeError("Frank overlay contains an oversized metadata string")
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "project": {"id": project.id, "name": project.name, "mount": str(project.mount), "source": project.source},
        "nodes": sorted(nodes, key=lambda node: node["id"]),
        "edges": [unique_edges[key] for key in sorted(unique_edges)],
        "provenance": "explicit manifests and SKILL.md frontmatter only; code relationships are Graphify-owned",
    }


def graph_summary(path: Path) -> dict[str, int]:
    graph = read_json_object(path, MAX_GRAPH_FILE_BYTES)
    if graph is None:
        raise RuntimeError("Graphify did not produce a valid graph.json")
    nodes = graph.get("nodes")
    # Graphify's NetworkX node-link form uses `links`; raw/no-cluster output
    # may use `edges`. Accept both without rewriting the upstream artifact.
    edges = graph.get("links") if isinstance(graph.get("links"), list) else graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise RuntimeError("Graphify graph.json is missing nodes or edges")
    if len(nodes) > MAX_GRAPH_NODES or len(edges) > MAX_GRAPH_EDGES:
        raise RuntimeError("Graphify graph exceeds node or edge safety limits")
    inspected = 0
    for record in itertools.chain(nodes, edges):
        stack = [record]
        while stack:
            value = stack.pop()
            inspected += 1
            if inspected > MAX_GRAPH_VALUES_INSPECTED:
                raise RuntimeError("Graphify graph exceeds structural inspection limit")
            if isinstance(value, str) and len(value) > MAX_GRAPH_STRING_CHARS:
                raise RuntimeError("Graphify graph contains an oversized string")
            if isinstance(value, dict):
                stack.extend(value.keys())
                stack.extend(value.values())
            elif isinstance(value, (list, tuple)):
                stack.extend(value)
    return {"nodes": len(nodes), "edges": len(edges)}


def graphify_command(project: Project, stage: Path) -> list[str]:
    command = [
        sys.executable, "-P", "-m", "graphify", "extract", str(project.mount), "--code-only", "--no-cluster",
        "--out", str(stage),
    ]
    for pattern in project.ignore:
        command.extend(("--exclude", pattern))
    return command


def run_graphify(command: list[str], cwd: Path, environment: dict[str, str]) -> tuple[int, str]:
    """Run Graphify with bounded output capture and process-group timeout."""
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    tails = {"stdout": bytearray(), "stderr": bytearray()}

    def drain(name: str, stream) -> None:
        while chunk := stream.read(64 * 1024):
            tail = tails[name]
            tail.extend(chunk)
            if len(tail) > MAX_PROCESS_LOG_TAIL:
                del tail[:-MAX_PROCESS_LOG_TAIL]

    threads = [
        threading.Thread(target=drain, args=("stdout", process.stdout), daemon=True),
        threading.Thread(target=drain, args=("stderr", process.stderr), daemon=True),
    ]
    for thread in threads:
        thread.start()
    try:
        return_code = process.wait(timeout=GRAPHIFY_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
        return_code = 124
    finally:
        for thread in threads:
            thread.join(timeout=5)
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()
    selected = tails["stderr"] or tails["stdout"]
    detail = bytes(selected).decode("utf-8", errors="replace").strip().replace("\n", " ")[:2000]
    return return_code, detail


def bounded_tree_size(root: Path) -> tuple[int, int]:
    total = 0
    files_seen = 0
    for directory, directories, files in os.walk(root, topdown=True, onerror=raise_walk_error, followlinks=False):
        directory_path = Path(directory)
        symlinked_directories = [name for name in directories if (directory_path / name).is_symlink()]
        if symlinked_directories:
            raise RuntimeError("graph release contains a directory symlink")
        directories[:] = sorted(directories)
        for name in files:
            path = directory_path / name
            if path.is_symlink():
                raise RuntimeError("graph release contains a file symlink")
            try:
                size = path.stat().st_size
            except OSError as exc:
                raise RuntimeError(f"could not stat release artifact: {path}") from exc
            files_seen += 1
            total += size
            if files_seen > MAX_RELEASE_FILES or total > MAX_RELEASE_BYTES:
                raise RuntimeError("graph release exceeds file-count or byte safety limit")
    return files_seen, total


def resolve_current_release(project_root: Path) -> Path | None:
    """Resolve only the canonical relative `releases/<release>` link shape."""
    try:
        project = checked_directory(project_root)
        releases_root = checked_directory(project / "releases", parent=project)
    except RuntimeError:
        return None
    current = project / "current"
    try:
        current_info = os.lstat(current)
    except OSError:
        return None
    if not stat.S_ISLNK(current_info.st_mode):
        return None
    try:
        raw_target = Path(os.readlink(current))
    except OSError:
        return None
    if raw_target.is_absolute() or len(raw_target.parts) != 2 or raw_target.parts[0] != "releases":
        return None
    if not RELEASE_NAME.fullmatch(raw_target.parts[1]):
        return None
    try:
        resolved = current.resolve(strict=True)
        resolved.relative_to(releases_root)
    except (OSError, ValueError):
        return None
    try:
        info = os.lstat(resolved)
    except OSError:
        return None
    return resolved if resolved.parent == releases_root and stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) else None


def cleanup_abandoned_staging(project_root: Path) -> list[str]:
    try:
        project = checked_directory(project_root)
        checked_directory(project / "releases", parent=project)
        staging = checked_directory(project / ".staging", parent=project)
    except RuntimeError:
        return []
    removed: list[str] = []
    for candidate in staging.iterdir():
        try:
            info = os.lstat(candidate)
        except OSError:
            continue
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or not RELEASE_NAME.fullmatch(candidate.name):
            continue
        try:
            if candidate.resolve(strict=True).parent != staging.resolve(strict=True):
                continue
        except OSError:
            continue
        shutil.rmtree(candidate)
        removed.append(candidate.name)
    return sorted(removed)


def prune_releases(project_root: Path, keep_prior: int = PRIOR_RELEASES_TO_KEEP) -> list[str]:
    """Remove only validated non-current releases below one project's root."""
    if keep_prior < 0:
        raise ValueError("release retention cannot be negative")
    try:
        project = checked_directory(project_root)
        releases_root = checked_directory(project / "releases", parent=project)
        checked_directory(project / ".staging", parent=project)
        current_target = resolve_current_release(project)
    except RuntimeError:
        LOG.error("release retention refused unsafe current link project_root=%s", project_root)
        return []
    if current_target is None or current_target.parent != releases_root:
        LOG.error("release retention refused non-canonical current target project_root=%s", project_root)
        return []
    candidates: list[Path] = []
    for candidate in releases_root.iterdir():
        try:
            info = os.lstat(candidate)
        except OSError:
            continue
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or not RELEASE_NAME.fullmatch(candidate.name):
            continue
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if resolved.parent == releases_root:
            candidates.append(resolved)
    keep = {current_target}
    prior_candidates = [
        candidate
        for candidate in sorted(candidates, key=lambda path: path.name, reverse=True)
        if candidate != current_target
    ]
    keep.update(prior_candidates[:keep_prior])
    removed: list[str] = []
    for candidate in candidates:
        if candidate in keep:
            continue
        # candidate was resolved and parent-checked above. No glob, environment
        # expansion, or repository-controlled path reaches this deletion.
        shutil.rmtree(candidate)
        removed.append(candidate.name)
    return sorted(removed)


@dataclass
class ProjectState:
    project: Project
    lock: threading.Lock = field(default_factory=threading.Lock)
    building: bool = False
    pending: bool = False
    initial_complete: bool = False
    last_success_at: str | None = None
    last_error: str | None = None
    current_release: str | None = None
    jobs: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Insertion order is the replay LRU. Values include an independently
    # expiring last-seen timestamp so capacity can never become permanent.
    command_jobs: dict[str, dict[str, str]] = field(default_factory=dict)


class Supervisor:
    def __init__(self, output_root: Path, projects: list[Project]) -> None:
        self.output_root = output_root
        self.states = {project.id: ProjectState(project) for project in projects}
        self._stopped = threading.Event()
        self._observers: list[Observer] = []

    def start(self) -> None:
        self.output_root.mkdir(parents=True, exist_ok=True)
        checked_directory(self.output_root)
        for state in self.states.values():
            project_root, _, _ = ensure_project_layout(self.output_root, state.project.id)
            self._load_runtime_state(state, project_root)
            removed = cleanup_abandoned_staging(project_root)
            if removed:
                LOG.info("removed abandoned staging project=%s count=%s", state.project.id, len(removed))
            self.request_rebuild(state.project.id, "initial")
            observer = Observer()
            observer.schedule(DebouncedProjectEvents(self, state.project), str(state.project.mount), recursive=True)
            observer.start()
            self._observers.append(observer)

    def stop(self) -> None:
        self._stopped.set()
        for observer in self._observers:
            observer.stop()
        for observer in self._observers:
            observer.join(timeout=10)

    def request_rebuild(self, project_id: str, reason: str, command_id: str | None = None) -> dict[str, Any] | None:
        state = self.states.get(project_id)
        if state is None:
            return None
        if command_id is not None and not COMMAND_ID.fullmatch(command_id):
            raise ValueError("command_id must be 8-128 safe identifier characters")
        with state.lock:
            self._prune_history_locked(state)
            if command_id is not None:
                mapping = state.command_jobs.pop(command_id, None)
                prior = state.jobs.get(mapping.get("jobId", "")) if mapping is not None else None
                if prior is not None:
                    state.command_jobs[command_id] = {"jobId": prior["jobId"], "lastSeenAt": utc_now()}
                    self._sync_job_command_ids_locked(state)
                    self._save_runtime_state_locked(state)
                    return self._job_response(prior, command_id)
            queued = next((job for job in state.jobs.values() if job["state"] == "queued"), None)
            if queued is None:
                job_id = uuid.uuid4().hex
                queued = {
                    "jobId": job_id,
                    "state": "queued",
                    "reason": reason,
                    "requestedAt": utc_now(),
                }
                state.jobs[job_id] = queued
            if command_id is not None:
                mapped_to_job = [
                    existing for existing, mapping in state.command_jobs.items()
                    if mapping.get("jobId") == queued["jobId"]
                ]
                if len(mapped_to_job) >= MAX_COMMAND_IDS_PER_JOB:
                    state.command_jobs.pop(mapped_to_job[0], None)
                while len(state.command_jobs) >= MAX_COMMAND_HISTORY:
                    state.command_jobs.pop(next(iter(state.command_jobs)))
                state.command_jobs[command_id] = {"jobId": queued["jobId"], "lastSeenAt": utc_now()}
            self._prune_history_locked(state)
            self._sync_job_command_ids_locked(state)
            state.pending = True
            self._save_runtime_state_locked(state)
            if not state.building:
                state.building = True
                threading.Thread(target=self._run_project, args=(state,), name=f"graphify-{project_id}", daemon=True).start()
            return self._job_response(queued, command_id)

    @staticmethod
    def _prune_history_locked(state: ProjectState) -> None:
        cutoff = datetime.now(UTC) - JOB_HISTORY_TTL
        expired_jobs = {
            job_id for job_id, job in state.jobs.items()
            if job.get("state") in {"succeeded", "failed"}
            and (parse_utc(job.get("completedAt")) is None or parse_utc(job.get("completedAt")) < cutoff)
        }
        for job_id in expired_jobs:
            state.jobs.pop(job_id, None)
        for command_id, mapping in list(state.command_jobs.items()):
            seen_at = parse_utc(mapping.get("lastSeenAt"))
            job = state.jobs.get(mapping.get("jobId", ""))
            if job is None or seen_at is None or seen_at < cutoff:
                state.command_jobs.pop(command_id, None)
        while len(state.command_jobs) > MAX_COMMAND_HISTORY:
            state.command_jobs.pop(next(iter(state.command_jobs)))
        terminal_ids = [job_id for job_id, job in state.jobs.items() if job.get("state") in {"succeeded", "failed"}]
        while len(state.jobs) > MAX_JOB_HISTORY and terminal_ids:
            removed_id = terminal_ids.pop(0)
            state.jobs.pop(removed_id, None)
            for command_id, mapping in list(state.command_jobs.items()):
                if mapping.get("jobId") == removed_id:
                    state.command_jobs.pop(command_id, None)

    @staticmethod
    def _sync_job_command_ids_locked(state: ProjectState) -> None:
        by_job: dict[str, list[str]] = {}
        for command_id, mapping in state.command_jobs.items():
            by_job.setdefault(mapping.get("jobId", ""), []).append(command_id)
        for job_id, job in state.jobs.items():
            command_ids = by_job.get(job_id, [])[-MAX_COMMAND_IDS_PER_JOB:]
            if command_ids:
                job["commandIds"] = command_ids
            else:
                job.pop("commandIds", None)
            job.pop("commandId", None)

    def _save_runtime_state_locked(self, state: ProjectState) -> None:
        try:
            project_root, _, _ = ensure_project_layout(self.output_root, state.project.id)
            payload = {
                "schema_version": 1,
                "saved_at": utc_now(),
                "jobs": list(state.jobs.values()),
                "commands": [
                    {"commandId": command_id, **mapping}
                    for command_id, mapping in state.command_jobs.items()
                ],
            }
            if len(json.dumps(payload, separators=(",", ":")).encode("utf-8")) > MAX_CONTROL_STATE_BYTES:
                raise RuntimeError("bounded control state exceeds persistence limit")
            json_write_atomic(project_root / "control-state.json", payload)
        except (OSError, RuntimeError, TypeError, ValueError):
            LOG.exception("could not persist bounded control state project=%s", state.project.id)

    def _load_runtime_state(self, state: ProjectState, project_root: Path) -> None:
        current = resolve_current_release(project_root)
        if current is not None:
            try:
                summary = graph_summary(current / "graphify-out" / "graph.json")
                overlay = read_json_object(current / "frank-overlay.json", MAX_GRAPH_FILE_BYTES)
                status = read_json_object(current / "status.json", MAX_CONTROL_STATE_BYTES)
                overlay_nodes = overlay.get("nodes") if overlay else None
                overlay_edges = overlay.get("edges") if overlay else None
                if (
                    not isinstance(overlay_nodes, list) or not isinstance(overlay_edges, list)
                    or summary["nodes"] + len(overlay_nodes) > MAX_GRAPH_NODES
                    or summary["edges"] + len(overlay_edges) > MAX_GRAPH_EDGES
                    or not status or status.get("state") != "ready"
                    or status.get("project") != state.project.id or status.get("release") != current.name
                ):
                    raise RuntimeError("published release contract is invalid")
                bounded_tree_size(current)
                state.current_release = current.name
                state.initial_complete = True
                generated_at = status.get("generated_at")
                state.last_success_at = generated_at if isinstance(generated_at, str) else None
            except RuntimeError:
                LOG.exception("existing current release failed validation project=%s", state.project.id)
        saved = read_json_object(project_root / "control-state.json", MAX_CONTROL_STATE_BYTES)
        if not saved or saved.get("schema_version") != 1:
            return
        jobs = saved.get("jobs")
        commands = saved.get("commands")
        if not isinstance(jobs, list) or not isinstance(commands, list):
            return
        restarted_at = utc_now()
        for job in jobs[-MAX_JOB_HISTORY:]:
            if not isinstance(job, dict) or not re.fullmatch(r"[a-f0-9]{32}", str(job.get("jobId", ""))):
                continue
            if job.get("state") not in {"queued", "running", "succeeded", "failed"} or parse_utc(job.get("requestedAt")) is None:
                continue
            restored = dict(job)
            if restored["state"] in {"queued", "running"}:
                restored.update({"state": "failed", "completedAt": restarted_at, "error": "supervisor restarted before completion"})
            state.jobs[restored["jobId"]] = restored
        for mapping in commands[-MAX_COMMAND_HISTORY:]:
            if not isinstance(mapping, dict):
                continue
            command_id = mapping.get("commandId")
            job_id = mapping.get("jobId")
            if (
                isinstance(command_id, str) and COMMAND_ID.fullmatch(command_id)
                and isinstance(job_id, str) and job_id in state.jobs
                and parse_utc(mapping.get("lastSeenAt")) is not None
            ):
                state.command_jobs[command_id] = {"jobId": job_id, "lastSeenAt": mapping["lastSeenAt"]}
        self._prune_history_locked(state)
        self._sync_job_command_ids_locked(state)
        self._save_runtime_state_locked(state)

    @staticmethod
    def _job_response(
        job: dict[str, Any], command_id: str | None = None, *, include_command_ids: bool = True,
    ) -> dict[str, Any]:
        response = {
            "jobId": job["jobId"],
            "state": job["state"],
            "requestedAt": job["requestedAt"],
        }
        if command_id is not None:
            response["commandId"] = command_id
        if include_command_ids and isinstance(job.get("commandIds"), list):
            response["commandIds"] = list(job["commandIds"][-MAX_COMMAND_IDS_PER_JOB:])
        for field_name in ("startedAt", "completedAt", "release", "graph", "error"):
            if field_name in job:
                response[field_name] = job[field_name]
        return response

    def get_job(self, project_id: str, job_id: str) -> dict[str, Any] | None:
        state = self.states.get(project_id)
        if state is None:
            return None
        with state.lock:
            self._prune_history_locked(state)
            self._sync_job_command_ids_locked(state)
            job = state.jobs.get(job_id)
            return self._job_response(job) if job is not None else None

    def _run_project(self, state: ProjectState) -> None:
        while not self._stopped.is_set():
            with state.lock:
                if not state.pending:
                    state.building = False
                    return
                state.pending = False
                active_jobs = [job for job in state.jobs.values() if job["state"] == "queued"]
                for job in active_jobs:
                    job["state"] = "running"
                    job["startedAt"] = utc_now()
                self._save_runtime_state_locked(state)
            try:
                release, summary = self._build_and_publish(state.project)
                with state.lock:
                    state.initial_complete = True
                    state.last_success_at = utc_now()
                    state.last_error = None
                    state.current_release = release
                    for job in active_jobs:
                        job.update({"state": "succeeded", "completedAt": state.last_success_at, "release": release, "graph": summary})
                    self._prune_history_locked(state)
                    self._save_runtime_state_locked(state)
                LOG.info("published project=%s release=%s nodes=%s edges=%s", state.project.id, release, summary["nodes"], summary["edges"])
            except Exception as exc:  # Keep the previously published release intact.
                with state.lock:
                    error = str(exc)[:256]
                    state.last_error = error
                    for job in active_jobs:
                        job.update({"state": "failed", "completedAt": utc_now(), "error": error})
                    self._prune_history_locked(state)
                    self._save_runtime_state_locked(state)
                LOG.exception("Graphify rebuild failed for project=%s", state.project.id)

    def _build_and_publish(self, project: Project) -> tuple[str, dict[str, int]]:
        self.output_root.mkdir(parents=True, exist_ok=True)
        checked_directory(self.output_root)
        project_root, releases, staging = ensure_project_layout(self.output_root, project.id)
        current_link = project_root / "current"
        current_release = resolve_current_release(project_root)
        if os.path.lexists(current_link):
            current_info = os.lstat(current_link)
            if not stat.S_ISLNK(current_info.st_mode) or current_release is None:
                raise RuntimeError("current release path must be a safe relative symlink")
        if current_release is not None:
            bounded_tree_size(current_release)
        free_bytes = shutil.disk_usage(project_root).free
        if free_bytes < MIN_FREE_BYTES + MAX_RELEASE_BYTES:
            raise RuntimeError("insufficient free space for an atomic graph release")
        release = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:12]}"
        stage = staging / release
        try:
            stage.mkdir(mode=0o750)
            stage = checked_directory(stage, parent=staging)
            validate_repository_tree(project)
            # Retain Graphify's manifest/cache between immutable releases. It is
            # copied, never mutated in place, so readers continue to see a complete
            # old graph until the replacement release is atomically selected.
            if current_release is not None:
                current_graphify = current_release / "graphify-out"
                if current_graphify.is_dir() and not current_graphify.is_symlink():
                    shutil.copytree(current_graphify, stage / "graphify-out", dirs_exist_ok=True)
            command = graphify_command(project, stage)
            # The control token and all other service/container environment are
            # intentionally absent from the untrusted repository extraction child.
            environment = {
                "PATH": "/usr/local/bin",
                "PYTHONPATH": TRUSTED_PYTHONPATH,
                "PYTHONNOUSERSITE": "1",
                "PYTHONSAFEPATH": "1",
                "HOME": "/tmp",
                "PYTHONUNBUFFERED": "1",
                "PYTHONDONTWRITEBYTECODE": "1",
            }
            return_code, detail = run_graphify(command, project.mount, environment)
            if return_code != 0:
                raise RuntimeError(f"Graphify extract exited {return_code}: {detail}")
            graph_path = stage / "graphify-out" / "graph.json"
            summary = graph_summary(graph_path)
            generated_at = utc_now()
            overlay = build_overlay(project, generated_at)
            if summary["nodes"] + len(overlay["nodes"]) > MAX_GRAPH_NODES:
                raise RuntimeError("combined Graphify and Frank overlay node limit exceeded")
            if summary["edges"] + len(overlay["edges"]) > MAX_GRAPH_EDGES:
                raise RuntimeError("combined Graphify and Frank overlay edge limit exceeded")
            json_write_atomic(stage / "frank-overlay.json", overlay)
            status = {
                "schema_version": 1,
                "state": "ready",
                "project": project.id,
                "generated_at": generated_at,
                "release": release,
                "graphify": {"package": "graphifyy", "version": "0.9.39", "commit": "50556baaea803e191947fdfcc2e0c22e2d4eb74d", **summary},
                "overlay": {"nodes": len(overlay["nodes"]), "edges": len(overlay["edges"])},
                "mode": "code-only-no-cluster",
            }
            json_write_atomic(stage / "status.json", status)
            bounded_tree_size(stage)
            final = releases / release
            os.replace(stage, final)
            checked_directory(final, parent=releases)
            link_tmp = project_root / ".current-next"
            if os.path.lexists(link_tmp):
                link_info = os.lstat(link_tmp)
                if not stat.S_ISLNK(link_info.st_mode):
                    raise RuntimeError("temporary current link path is unsafe")
                link_tmp.unlink()
            os.symlink(Path("releases") / release, link_tmp, target_is_directory=True)
            os.replace(link_tmp, current_link)
            try:
                removed = prune_releases(project_root)
                if removed:
                    LOG.info("pruned project=%s releases=%s", project.id, ",".join(removed))
            except OSError:
                # Publication has already succeeded. Retention is best-effort and a
                # cleanup failure must not misreport a good graph as failed.
                LOG.exception("release retention failed for project=%s", project.id)
            return release, summary
        finally:
            try:
                stage_info = os.lstat(stage)
                stage_resolved = stage.resolve(strict=True)
                staging_resolved = checked_directory(staging, parent=project_root)
                if stat.S_ISDIR(stage_info.st_mode) and not stat.S_ISLNK(stage_info.st_mode) and stage_resolved.parent == staging_resolved:
                    shutil.rmtree(stage_resolved, ignore_errors=True)
            except OSError:
                pass

    def health(self) -> tuple[bool, dict[str, Any]]:
        snapshots = self.status()["projects"]
        ready = bool(snapshots) and all(item["initial_complete"] and item["release"] for item in snapshots)
        degraded = ready and any(item["last_error"] for item in snapshots)
        status = "degraded" if degraded else ("ok" if ready else "starting")
        return ready, {"status": status, "ready": ready, "refresh_degraded": degraded, "projects": len(snapshots)}

    def status(self) -> dict[str, Any]:
        projects: list[dict[str, Any]] = []
        for project_id in sorted(self.states):
            state = self.states[project_id]
            with state.lock:
                before = (len(state.jobs), len(state.command_jobs))
                self._prune_history_locked(state)
                self._sync_job_command_ids_locked(state)
                if before != (len(state.jobs), len(state.command_jobs)):
                    self._save_runtime_state_locked(state)
                projects.append({
                    "id": project_id,
                    "name": state.project.name,
                    "building": state.building,
                    "queued": state.pending,
                    "initial_complete": state.initial_complete,
                    "last_success_at": state.last_success_at,
                    "last_error": state.last_error,
                    "refresh_degraded": state.initial_complete and state.last_error is not None,
                    "release": state.current_release,
                    # Full coalesced membership is available from the per-job
                    # poll route. Omitting it here keeps 100-project live status
                    # comfortably below the API's 1 MiB supervisor response cap.
                    "jobs": [
                        self._job_response(job, include_command_ids=False)
                        for job in list(state.jobs.values())[-10:]
                    ],
                })
        return {"schema_version": 1, "generated_at": utc_now(), "projects": projects}


class DebouncedProjectEvents(FileSystemEventHandler):
    def __init__(self, supervisor: Supervisor, project: Project) -> None:
        self.supervisor = supervisor
        self.project = project
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    def on_any_event(self, event: FileSystemEvent) -> None:
        path = Path(event.src_path)
        if is_ignored(path, self.project.mount, set(self.project.ignore)):
            return
        with self._lock:
            if self._timer:
                self._timer.cancel()
            seconds = float(os.environ.get("CODEGRAPH_DEBOUNCE_SECONDS", "2"))
            self._timer = threading.Timer(seconds, self._queue)
            self._timer.daemon = True
            self._timer.start()

    def _queue(self) -> None:
        self.supervisor.request_rebuild(self.project.id, "filesystem-change")


class ControlHandler(BaseHTTPRequestHandler):
    supervisor: Supervisor
    control_token: str

    # Deliberately suppresses request/query logging; operational events are logged
    # by the service with project IDs only.
    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if authorized(self.control_token, self.headers.get("Authorization")):
            return True
        self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
        return False

    def _read_command_id(self) -> str | None:
        if self.headers.get("Transfer-Encoding") is not None:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "transfer_encoding_not_supported"})
            return None
        lengths = self.headers.get_all("Content-Length", failobj=[])
        if len(lengths) != 1:
            self._json(HTTPStatus.LENGTH_REQUIRED if not lengths else HTTPStatus.BAD_REQUEST, {"error": "content_length_required"})
            return None
        if not isinstance(lengths[0], str) or not re.fullmatch(r"[0-9]+", lengths[0]):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            return None
        try:
            length = int(lengths[0], 10)
        except (TypeError, ValueError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            return None
        if length < 0:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            return None
        if length > MAX_CONTROL_BODY:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body_too_large"})
            return None
        if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
            self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "json_required"})
            return None
        try:
            raw = self.rfile.read(length)
        except (TimeoutError, OSError):
            self._json(HTTPStatus.REQUEST_TIMEOUT, {"error": "request_timeout"})
            return None
        if len(raw) != length:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "incomplete_body"})
            return None
        try:
            body = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
            return None
        if not isinstance(body, dict) or set(body) != {"command_id"}:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "command_id_required"})
            return None
        command_id = body.get("command_id")
        if not isinstance(command_id, str) or not COMMAND_ID.fullmatch(command_id):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_command_id"})
            return None
        return command_id

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            ready, payload = self.supervisor.health()
            self._json(HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE, payload)
        elif self.path == "/status":
            if self._authorized():
                self._json(HTTPStatus.OK, self.supervisor.status())
        elif match := re.fullmatch(r"/projects/([a-z][a-z0-9-]{0,62})/jobs/([a-f0-9]{32})", self.path):
            if not self._authorized():
                return
            job = self.supervisor.get_job(match.group(1), match.group(2))
            if job is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "unknown_job"})
            else:
                self._json(HTTPStatus.OK, {"projectId": match.group(1), "job": job})
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            return
        match = re.fullmatch(r"/projects/([a-z][a-z0-9-]{0,62})/refresh", self.path)
        if not match:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        command_id = self._read_command_id()
        if command_id is None:
            return
        accepted = self.supervisor.request_rebuild(match.group(1), "operator-refresh", command_id)
        if accepted is None:
            self._json(HTTPStatus.NOT_FOUND, {"error": "unknown_project"})
            return
        self._json(HTTPStatus.ACCEPTED, accepted)


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, server_address: tuple[str, int], handler: type[BaseHTTPRequestHandler]) -> None:
        self._request_slots = threading.BoundedSemaphore(MAX_CONTROL_CONNECTIONS)
        super().__init__(server_address, handler)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(CONTROL_SOCKET_TIMEOUT_SECONDS)
        return request, address

    def process_request(self, request, client_address) -> None:
        if not self._request_slots.acquire(blocking=False):
            try:
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n"
                    b"Content-Length: 0\r\nCache-Control: no-store\r\n\r\n"
                )
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self, request, client_address) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()


def main() -> None:
    logging.basicConfig(level=os.environ.get("CODEGRAPH_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    registry = Path(os.environ.get("CODEGRAPH_REGISTRY", "/etc/frank-codegraph/projects.json"))
    output = Path(os.environ.get("CODEGRAPH_OUTPUT", "/data/codegraph"))
    control_token_file = Path(os.environ.get("CODEGRAPH_CONTROL_TOKEN_FILE", "/run/secrets/frank_codegraph_control_token"))
    projects = load_registry(registry)
    control_token = load_control_token(control_token_file)
    supervisor = Supervisor(output, projects)
    supervisor.start()
    ControlHandler.supervisor = supervisor
    ControlHandler.control_token = control_token
    host = os.environ.get("CODEGRAPH_HOST", "0.0.0.0")
    port = int(os.environ.get("CODEGRAPH_PORT", "3002"))
    server = BoundedThreadingHTTPServer((host, port), ControlHandler)
    def shutdown(_signum: int, _frame: Any) -> None:
        # shutdown() waits for serve_forever(), so it must not run directly
        # from the main-thread signal handler.
        threading.Thread(target=server.shutdown, name="codegraph-shutdown", daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    LOG.info("starting Graphify service projects=%s", ",".join(project.id for project in projects))
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        supervisor.stop()
        server.server_close()
