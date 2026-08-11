from __future__ import annotations

import ast
import importlib
import importlib.util
import json
import os
import sys
from importlib.metadata import version
from pathlib import Path


MAX_STATIC_FILES = 10_000
MAX_STATIC_BYTES = 32 * 1024 * 1024
TK_MODULES = {"tkinter", "_tkinter"}
TRUSTED_PYTHONPATH = "/app:/opt/frank-codegraph/site-packages"
TRUSTED_IMPORT_ROOTS = (Path("/app"), Path("/opt/frank-codegraph/site-packages"))


def assert_trusted_pythonpath(
    *,
    path_entries: tuple[str, ...] | None = None,
    safe_path: bool | None = None,
    no_user_site: bool | None = None,
    cwd: Path | None = None,
    trusted_roots: tuple[Path, ...] | None = None,
    repositories_root: Path = Path("/repositories"),
) -> None:
    if os.environ.get("PYTHONPATH") != TRUSTED_PYTHONPATH:
        raise RuntimeError("scratch runtime PYTHONPATH does not match the fixed trusted path")
    if os.environ.get("PYTHONSAFEPATH") != "1" or not (
        bool(sys.flags.safe_path) if safe_path is None else safe_path
    ):
        raise RuntimeError("scratch runtime safe-path mode is not active")
    if os.environ.get("PYTHONNOUSERSITE") != "1" or not (
        bool(sys.flags.no_user_site) if no_user_site is None else no_user_site
    ):
        raise RuntimeError("scratch runtime user-site loading is not disabled")
    active_entries = tuple(sys.path if path_entries is None else path_entries)
    if any(not entry for entry in active_entries):
        raise RuntimeError("scratch runtime contains an empty sys.path entry")
    if any(not Path(entry).is_absolute() for entry in active_entries):
        raise RuntimeError("scratch runtime contains a relative sys.path entry")
    canonical_entries = tuple(Path(entry).resolve(strict=False) for entry in active_entries)
    positions: list[int] = []
    active_trusted_roots = TRUSTED_IMPORT_ROOTS if trusted_roots is None else trusted_roots
    for root in active_trusted_roots:
        canonical_root = root.resolve(strict=True)
        try:
            positions.append(canonical_entries.index(canonical_root))
        except ValueError as error:
            raise RuntimeError(f"trusted import root is absent from sys.path: {root}") from error
        if canonical_entries.count(canonical_root) != 1:
            raise RuntimeError(f"trusted import root is duplicated in sys.path: {root}")
    if positions != sorted(positions) or len(set(positions)) != len(positions):
        raise RuntimeError("trusted import roots are not present in fixed order")
    active_cwd = (Path.cwd() if cwd is None else cwd).resolve(strict=True)
    canonical_trusted_roots = tuple(root.resolve(strict=True) for root in active_trusted_roots)
    if active_cwd not in canonical_trusted_roots and active_cwd in canonical_entries:
        raise RuntimeError("scratch runtime working directory leaked into sys.path")
    repositories = repositories_root.resolve(strict=False)
    if any(entry == repositories or entry.is_relative_to(repositories) for entry in canonical_entries):
        raise RuntimeError("scratch runtime repository path leaked into sys.path")


def import_module_from_root(module_name: str, trusted_root: Path) -> object:
    root = trusted_root.resolve(strict=True)
    spec = importlib.util.find_spec(module_name)
    if spec is None or spec.origin is None:
        raise RuntimeError(f"trusted module is not importable: {module_name}")
    origin = Path(spec.origin).resolve(strict=True)
    if origin != root and not origin.is_relative_to(root):
        raise RuntimeError(f"module resolves outside trusted root: {module_name} -> {origin}")
    module = importlib.import_module(module_name)
    module_file = getattr(module, "__file__", None)
    if not isinstance(module_file, str) or not module_file:
        raise RuntimeError(f"trusted module has no regular import origin: {module_name}")
    imported_path = Path(module_file).resolve(strict=True)
    if imported_path != origin:
        raise RuntimeError(f"imported module origin changed during import: {module_name}")
    return module


def assert_no_tk_imports(roots: tuple[Path, ...]) -> None:
    files_seen = 0
    bytes_seen = 0
    violations: list[str] = []
    for root in roots:
        if not root.is_dir() or root.is_symlink():
            raise RuntimeError(f"static import root is not a real directory: {root}")
        for directory, directories, files in os.walk(root, followlinks=False):
            directory_path = Path(directory)
            if any((directory_path / name).is_symlink() for name in (*directories, *files)):
                raise RuntimeError(f"static import tree contains a symlink: {directory_path}")
            directories[:] = sorted(directories)
            for name in sorted(files):
                if not name.endswith(".py"):
                    continue
                path = directory_path / name
                size = path.stat().st_size
                files_seen += 1
                bytes_seen += size
                if files_seen > MAX_STATIC_FILES or bytes_seen > MAX_STATIC_BYTES:
                    raise RuntimeError("static import scan exceeds file or byte limit")
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
                for node in ast.walk(tree):
                    imported: list[str] = []
                    if isinstance(node, ast.Import):
                        imported = [alias.name for alias in node.names]
                    elif isinstance(node, ast.ImportFrom) and node.module:
                        imported = [node.module]
                    elif (
                        isinstance(node, ast.Call)
                        and node.args
                        and isinstance(node.args[0], ast.Constant)
                        and isinstance(node.args[0].value, str)
                    ):
                        function = node.func
                        if isinstance(function, ast.Name) and function.id == "__import__":
                            imported = [node.args[0].value]
                        elif isinstance(function, ast.Attribute) and function.attr == "import_module":
                            imported = [node.args[0].value]
                    for module in imported:
                        if module.split(".", 1)[0] in TK_MODULES:
                            violations.append(f"{path}:{getattr(node, 'lineno', 0)}:{module}")
    if violations:
        raise RuntimeError(f"Tk import is forbidden in codegraph/Graphify call paths: {violations[:20]}")


def main() -> None:
    assert Path.cwd() == Path("/tmp")
    assert_trusted_pythonpath()
    assert sys.version_info[:3] == (3, 14, 6)
    assert version("graphifyy") == "0.9.39"
    assert importlib.util.find_spec("tarfile") is None
    assert importlib.util.find_spec("html.parser") is None
    assert importlib.util.find_spec("_tkinter") is None
    assert importlib.util.find_spec("tkinter") is None

    graphify_spec = importlib.util.find_spec("graphify")
    assert graphify_spec is not None and graphify_spec.origin is not None
    graphify_origin = Path(graphify_spec.origin).resolve(strict=True)
    graphify_root = TRUSTED_IMPORT_ROOTS[1].resolve(strict=True)
    assert graphify_origin.is_relative_to(graphify_root)
    assert_no_tk_imports((Path("/app/frank_codegraph"), Path(graphify_spec.origin).parent))

    import_module_from_root("frank_codegraph", Path("/app"))
    import graphify  # noqa: F401
    from frank_codegraph.service import Project, Supervisor

    work = Path("/tmp/frank-codegraph-acceptance")
    project = work / "project"
    output = work / "output"
    project.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    (project / "sample.py").write_text(
        "def answer() -> int:\n    return 42\n",
        encoding="utf-8",
    )
    configured = Project("acceptance", "Acceptance", project, ())
    supervisor = Supervisor(output, [configured])
    supervisor._build_and_publish(configured)
    graph_path = output / "acceptance" / "current" / "graphify-out" / "graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    assert isinstance(graph.get("nodes"), list) and graph["nodes"]
    relationships = graph.get("links", graph.get("edges"))
    assert isinstance(relationships, list)


if __name__ == "__main__":
    main()
