"""Cross-platform Graphify runner that never writes to the indexed project."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess


VERSION = "0.9.45"
MANDATORY_IGNORE_PATTERNS = (".env", "*.db", "*.sqlite*", "node_modules/")
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_PROJECT_BYTES = 512 * 1024 * 1024
MAX_PROJECT_FILES = 100_000
GRAPHIFY_TIMEOUT_SECONDS = 300
MAX_GRAPHIFY_OUTPUT_BYTES = 1 * 1024 * 1024


def _regular_directory(path: Path, label: str, *, must_exist: bool) -> Path:
    if path.is_symlink():
        raise ValueError(f"{label} cannot be a symlink")
    if must_exist and not path.exists():
        raise ValueError(f"{label} does not exist")
    if path.exists() and not path.is_dir():
        raise ValueError(f"{label} must be a directory")
    return path.resolve()


def _has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            return True
    return False


def _ignore_lines(ignore_file: Path) -> list[str]:
    lines = []
    for line in ignore_file.read_text(encoding="utf-8").splitlines():
        value = line.split("#", 1)[0].strip()
        if value:
            lines.append(value)
    return lines


def _pattern_is_covered(pattern: str, lines: list[str]) -> bool:
    normalized = pattern.rstrip("/")
    for line in lines:
        candidate = line.rstrip("/")
        if candidate == pattern or candidate == normalized:
            return True
        if pattern == ".env" and candidate in {".env", ".env*", "**/.env"}:
            return True
        if pattern == "*.db" and candidate in {".db", "*.db", "**/*.db", "*.db*"}:
            return True
        if pattern == "*.sqlite*" and candidate in {
            ".sqlite",
            "*.sqlite",
            "*.sqlite*",
            "**/*.sqlite*",
        }:
            return True
        if pattern == "node_modules/" and candidate in {"node_modules", "node_modules/**", "**/node_modules"}:
            return True
    return False


def validate_inputs(project: Path, output: Path) -> tuple[Path, Path]:
    if project.is_symlink():
        raise ValueError("project cannot be a symlink")
    project = _regular_directory(project, "project", must_exist=True)
    output_abs = output.absolute()
    if output_abs == project or project in output_abs.parents:
        raise ValueError("output must be a dedicated directory outside project")
    if _has_symlink_component(output_abs):
        raise ValueError("output path cannot contain symlinks")
    if output.exists() and output.is_symlink():
        raise ValueError("output cannot be a symlink")
    if output.exists() and not output.is_dir():
        raise ValueError("output must be a directory")

    ignore = project / ".graphifyignore"
    if ignore.is_symlink() or not ignore.is_file():
        raise ValueError("reviewed .graphifyignore is required")
    lines = _ignore_lines(ignore)
    missing = [pattern for pattern in MANDATORY_IGNORE_PATTERNS if not _pattern_is_covered(pattern, lines)]
    output_name = output.name
    covered_output = any(line.rstrip("/") == output_name for line in lines)
    if not output_name or output_name.startswith(".") or not covered_output:
        missing.append(output_name or "dedicated output")
    if missing:
        raise ValueError(".graphifyignore lacks mandatory reviewed patterns")
    return project, output_abs


def _snapshot_project(project: Path) -> dict[str, tuple[int, str]]:
    snapshot: dict[str, tuple[int, str]] = {}
    total = 0
    for path in project.rglob("*"):
        if path.is_symlink():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if not path.is_file():
            continue
        total += stat.st_size
        if stat.st_size > MAX_FILE_BYTES or total > MAX_PROJECT_BYTES or len(snapshot) >= MAX_PROJECT_FILES:
            raise ValueError("project exceeds Graphify read limits")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        snapshot[path.relative_to(project).as_posix()] = (stat.st_size, digest.hexdigest())
    return snapshot


def run_graphify(project: Path, output: Path) -> int:
    project, output = validate_inputs(project, output)
    before = _snapshot_project(project)
    output.mkdir(parents=True, exist_ok=True)
    executable = shutil.which("uvx") or shutil.which("uvx.exe")
    if executable is None:
        raise RuntimeError("uvx is required to run the pinned Graphify package")
    command = [
        executable,
        "--from",
        f"graphifyy=={VERSION}",
        "graphify",
        str(project),
        "--out",
        str(output),
    ]
    try:
        result = subprocess.run(
            command,
            check=False,
            timeout=GRAPHIFY_TIMEOUT_SECONDS,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Graphify timed out") from exc
    if len(result.stdout or b"") + len(result.stderr or b"") > MAX_GRAPHIFY_OUTPUT_BYTES:
        raise RuntimeError("Graphify output exceeded the configured cap")
    after = _snapshot_project(project)
    if before != after:
        raise RuntimeError("Graphify modified the project; output was not accepted")
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        return run_graphify(args.project, args.output)
    except (OSError, RuntimeError, ValueError) as exc:
        parser.error(str(exc))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
