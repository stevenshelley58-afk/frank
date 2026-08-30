"""Scheduled entry point for preview-scoped control-map generation."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Mapping, Sequence


class BoundedRunner:
    """Run only the pinned local command without a shell or unbounded output."""

    def run(self, argv: Sequence[str], *, timeout: float, max_output_bytes: int = 1_000_000, shell: bool = False) -> Mapping[str, Any]:
        if shell:
            raise RuntimeError("map commands must not use a shell")
        process = subprocess.Popen(tuple(argv), stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False)
        captured: dict[str, bytearray] = {"stdout": bytearray(), "stderr": bytearray()}
        overflow = threading.Event()

        def drain(name: str, stream: Any) -> None:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    return
                previous = len(captured[name])
                if previous < max_output_bytes:
                    captured[name].extend(chunk[: max_output_bytes - len(captured[name])])
                if previous + len(chunk) > max_output_bytes:
                    overflow.set()

        threads = [threading.Thread(target=drain, args=(name, getattr(process, name)), daemon=True) for name in ("stdout", "stderr")]
        for thread in threads:
            thread.start()
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                if overflow.is_set() or time.monotonic() >= deadline:
                    raise subprocess.TimeoutExpired(argv, timeout)
                time.sleep(0.01)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            for thread in threads:
                thread.join(timeout=1)
            return {"returncode": 124 if not overflow.is_set() else 125}
        for thread in threads:
            thread.join(timeout=1)
        return {
            "returncode": process.returncode,
            "stdout": bytes(captured["stdout"]).decode("utf-8", "replace"),
            "stderr": bytes(captured["stderr"]).decode("utf-8", "replace"),
        }


def _regular_json(path: Path) -> Mapping[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("graph snapshot is not a regular file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, Mapping):
        raise RuntimeError("graph snapshot must be an object")
    return value


def _resolve_graph(path: Path) -> Mapping[str, Any]:
    """Resolve a current pointer through the canonical hash-verifying store."""
    pointer = _regular_json(path)
    if path.name != "current.json" or not isinstance(pointer.get("path"), str):
        return pointer
    if path.parent.name != "graph":
        raise RuntimeError("graph current pointer is outside the canonical store layout")
    from graph.control_plane import ControlContractError
    from graph.control_store import ControlGraphStore
    try:
        snapshot = ControlGraphStore(path.parent.parent).read_snapshot()
    except (OSError, ValueError, ControlContractError) as error:
        raise RuntimeError("graph current pointer failed hash verification") from error
    graph = snapshot.get("graph")
    if not isinstance(graph, Mapping):
        raise RuntimeError("graph current snapshot is malformed")
    return graph


def main(argv: Sequence[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[3]
    window_root = root / "apps" / "window"
    if str(window_root) not in sys.path:
        sys.path.insert(0, str(window_root))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, default=Path("/srv/frank/data/window/control-graph/graph/current.json"))
    parser.add_argument("--preview-root", type=Path, default=Path("/srv/frank/data/window/maps"))
    parser.add_argument("--run-key", default=None)
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args(argv)
    try:
        from graph.map_artifacts import MapArtifactStore  # type: ignore
        from graph.archify_adapter import ArchifyAdapter  # type: ignore
        from graph.map_pipeline import generate_maps

        graph = _resolve_graph(args.graph)
        graph_revision = graph.get("graph_revision", graph.get("revision", "unknown"))
        run_key = args.run_key or f"run:graph-{str(graph_revision).replace(':', '-')}-{int(time.time())}"
        adapter = ArchifyAdapter()
        store = MapArtifactStore(args.preview_root)
        result = generate_maps(
            graph,
            run_key=run_key,
            build_context_path=root / "governance" / "control-plane" / "build-context.yaml",
            repo_root=root,
            preview_root=args.preview_root,
            adapter=adapter,
            artifact_store=store,
            runner=BoundedRunner(),
            timeout_seconds=args.timeout,
        )
    except Exception as error:  # noqa: BLE001 - CLI emits one typed-safe failure
        result = {"status": "failed", "reason": str(error)[:240], "preview_published": False}
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result.get("status") in ("passed", "skipped") else 1


if __name__ == "__main__":
    raise SystemExit(main())
