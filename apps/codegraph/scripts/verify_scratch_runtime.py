from __future__ import annotations

import importlib.util
import json
import sys
from importlib.metadata import version
from pathlib import Path


def main() -> None:
    assert sys.version_info[:3] == (3, 14, 6)
    assert version("graphifyy") == "0.9.39"
    assert importlib.util.find_spec("tarfile") is None
    assert importlib.util.find_spec("html.parser") is None

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
