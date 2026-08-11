from __future__ import annotations

import ast
import importlib.util
import json
import os
import sys
from importlib.metadata import version
from pathlib import Path


MAX_STATIC_FILES = 10_000
MAX_STATIC_BYTES = 32 * 1024 * 1024
TK_MODULES = {"tkinter", "_tkinter"}


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
    assert sys.version_info[:3] == (3, 14, 6)
    assert version("graphifyy") == "0.9.39"
    assert importlib.util.find_spec("tarfile") is None
    assert importlib.util.find_spec("html.parser") is None
    assert importlib.util.find_spec("_tkinter") is None
    assert importlib.util.find_spec("tkinter") is None

    graphify_spec = importlib.util.find_spec("graphify")
    assert graphify_spec is not None and graphify_spec.origin is not None
    assert_no_tk_imports((Path("/app/frank_codegraph"), Path(graphify_spec.origin).parent))

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
