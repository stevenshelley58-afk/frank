from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Callable


ELF_MAGIC = b"\x7fELF"
ABSOLUTE_LIBRARY = re.compile(r"(?:=>\s+)?(/[^\s(]+)")
SYSTEM_ELF_ROOTS = (
    Path("/lib"),
    Path("/usr/lib"),
    Path("/usr/local/lib"),
    Path("/usr/local"),
)


def fail(message: str) -> None:
    raise RuntimeError(message)


def contained(path: Path, roots: tuple[Path, ...]) -> bool:
    canonical = path.resolve(strict=True)
    return any(canonical == root or canonical.is_relative_to(root) for root in roots)


def validated_regular(source: Path, allowed_roots: tuple[Path, ...]) -> tuple[Path, os.stat_result]:
    source = Path(os.path.abspath(source))
    if not any(source == root or source.is_relative_to(root) for root in allowed_roots):
        fail(f"runtime source is outside its lexical allowlist: {source}")
    metadata = source.lstat()
    resolved = source
    if stat.S_ISLNK(metadata.st_mode):
        link = os.readlink(source)
        if os.path.isabs(link):
            fail(f"absolute runtime symlink is forbidden: {source} -> {link}")
        resolved = source.resolve(strict=True)
        if not contained(resolved, allowed_roots):
            fail(f"runtime symlink escapes its allowlist: {source} -> {resolved}")
        metadata = resolved.stat()
    elif not contained(source, allowed_roots):
        fail(f"runtime source escapes its canonical allowlist: {source}")
    if not stat.S_ISREG(metadata.st_mode):
        fail(f"runtime entry is not a regular file: {source}")
    if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID):
        fail(f"setuid/setgid runtime file is forbidden: {source}")
    return resolved, metadata


def destination(root: Path, source: Path) -> Path:
    if not source.is_absolute():
        fail(f"runtime source is not absolute: {source}")
    target = root / source.relative_to("/")
    if not target.is_relative_to(root):
        fail(f"runtime destination escapes root: {target}")
    return target


def copy_entry(root: Path, source: Path, allowed_roots: tuple[Path, ...]) -> None:
    source = Path(os.path.abspath(source))
    resolved, metadata = validated_regular(source, allowed_roots)
    target = destination(root, source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(resolved, target, follow_symlinks=False)
    target.chmod(stat.S_IMODE(metadata.st_mode) & 0o777)


def copy_os_release(
    root: Path,
    *,
    canonical_source: Path = Path("/usr/lib/os-release"),
    fallback_source: Path = Path("/etc/os-release"),
) -> None:
    """Install os-release as bytes in a normalized regular file, never a link."""
    source = canonical_source
    allowed_root = canonical_source.parent.resolve(strict=True)
    if os.path.lexists(source):
        canonical_metadata = source.lstat()
        if not stat.S_ISREG(canonical_metadata.st_mode):
            fail(f"canonical os-release must be a real regular file: {source}")
    else:
        source = fallback_source
        allowed_root = fallback_source.parent.resolve(strict=True)
        fallback_metadata = source.lstat()
        if not stat.S_ISREG(fallback_metadata.st_mode):
            fail(f"fallback os-release must be a real regular file: {source}")
    resolved, _metadata = validated_regular(source, (allowed_root,))
    target = root / "etc/os-release"
    target.parent.mkdir(parents=True, exist_ok=True)
    if os.path.lexists(target):
        fail(f"assembled os-release destination already exists: {target}")
    shutil.copyfile(resolved, target, follow_symlinks=False)
    target.chmod(0o644)
    final = target.lstat()
    if not stat.S_ISREG(final.st_mode) or stat.S_ISLNK(final.st_mode) or stat.S_IMODE(final.st_mode) != 0o644:
        fail("assembled /etc/os-release is not a normalized regular file")


def copy_tree(
    root: Path,
    source: Path,
    *,
    excluded: Callable[[Path], bool] = lambda _relative: False,
) -> None:
    source = Path(os.path.abspath(source))
    anchor = source.resolve(strict=True)
    if not anchor.is_dir():
        fail(f"runtime tree is not a directory: {source}")
    target = destination(root, source)

    def visit(current: Path, output: Path, relative: Path, stack: frozenset[Path]) -> None:
        if excluded(relative):
            return
        lexical = current
        metadata = lexical.lstat()
        resolved = lexical
        if stat.S_ISLNK(metadata.st_mode):
            link = os.readlink(lexical)
            if os.path.isabs(link):
                fail(f"absolute runtime symlink is forbidden: {lexical} -> {link}")
            resolved = lexical.resolve(strict=True)
            if resolved != anchor and not resolved.is_relative_to(anchor):
                fail(f"runtime tree symlink escapes source: {lexical} -> {resolved}")
            metadata = resolved.stat()
        if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID):
            fail(f"setuid/setgid runtime entry is forbidden: {lexical}")
        if stat.S_ISREG(metadata.st_mode):
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(resolved, output, follow_symlinks=False)
            output.chmod(stat.S_IMODE(metadata.st_mode) & 0o777)
            return
        if not stat.S_ISDIR(metadata.st_mode):
            fail(f"special runtime entry is forbidden: {lexical}")
        canonical = resolved.resolve(strict=True)
        if canonical in stack:
            fail(f"runtime tree contains a symlink cycle: {lexical}")
        output.mkdir(parents=True, exist_ok=True)
        output.chmod(stat.S_IMODE(metadata.st_mode) & 0o777)
        next_stack = stack | {canonical}
        for child in sorted(resolved.iterdir(), key=lambda value: value.name):
            visit(child, output / child.name, relative / child.name, next_stack)

    visit(source, target, Path(), frozenset())


def is_elf(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(4) == ELF_MAGIC
    except OSError:
        return False


def source_for(root: Path, runtime_path: Path) -> Path:
    canonical_root = root.resolve(strict=True)
    canonical_runtime = runtime_path.resolve(strict=True)
    if canonical_runtime != canonical_root and not canonical_runtime.is_relative_to(canonical_root):
        fail(f"runtime ELF escapes assembled root: {runtime_path}")
    return Path("/") / runtime_path.relative_to(root)


def dynamic_dependencies(source: Path, ldd: str, allowed_roots: tuple[Path, ...]) -> set[Path]:
    validated_regular(source, allowed_roots)
    result = subprocess.run(
        [ldd, str(source)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    output = result.stdout
    if "not found" in output:
        fail(f"unresolved ELF dependency for {source}:\n{output}")
    if result.returncode != 0:
        lowered = output.lower()
        if "not a dynamic executable" in lowered or "statically linked" in lowered:
            return set()
        fail(f"ldd failed for {source}:\n{output}")
    dependencies = {Path(match) for match in ABSOLUTE_LIBRARY.findall(output)}
    for dependency in dependencies:
        validated_regular(dependency, allowed_roots)
    return dependencies


def copy_elf_closure(root: Path, target_packages: Path) -> None:
    ldd = shutil.which("ldd")
    if not ldd:
        fail("builder does not provide ldd")
    allowed_roots = tuple(path.resolve(strict=True) for path in SYSTEM_ELF_ROOTS) + (
        target_packages.resolve(strict=True),
    )

    queued: set[Path] = set()
    queue: deque[Path] = deque()
    for runtime_path in root.rglob("*"):
        if runtime_path.is_file() and is_elf(runtime_path):
            source = source_for(root, runtime_path)
            validated_regular(source, allowed_roots)
            queued.add(source)
            queue.append(source)

    while queue:
        source = queue.popleft()
        for dependency in dynamic_dependencies(source, ldd, allowed_roots):
            copy_entry(root, dependency, allowed_roots)
            if dependency not in queued and is_elf(dependency):
                queued.add(dependency)
                queue.append(dependency)


def remove_if_present(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif path.exists() or path.is_symlink():
        path.unlink()


def audit_runtime_root(root: Path) -> None:
    canonical_root = root.resolve(strict=True)
    for path in root.rglob("*"):
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            fail(f"scratch runtime contains a symlink: {path}")
        if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)):
            fail(f"scratch runtime contains a special file: {path}")
        if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID):
            fail(f"scratch runtime contains a setuid/setgid entry: {path}")
        canonical = path.resolve(strict=True)
        if canonical != canonical_root and not canonical.is_relative_to(canonical_root):
            fail(f"scratch runtime path escapes root: {path}")


def finalize_runtime_root(root: Path) -> None:
    root = root.resolve(strict=True)
    if root == Path("/") or not root.is_dir():
        fail(f"invalid scratch runtime root: {root}")
    audit_runtime_root(root)
    app = root / "app"
    for path in (app, *app.rglob("*")):
        os.chown(path, 10001, 10001, follow_symlinks=False)
    audit_runtime_root(root)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--finalize":
        finalize_runtime_root(Path(sys.argv[2]))
        return
    if len(sys.argv) != 3:
        fail("usage: assemble_scratch_runtime.py ROOT TARGET_SITE_PACKAGES | --finalize ROOT")
    root = Path(sys.argv[1]).resolve()
    target_packages = Path(sys.argv[2]).resolve()
    if root == Path("/") or root.exists():
        fail(f"runtime root must be a new non-root path: {root}")
    if not target_packages.is_dir():
        fail(f"target site-packages directory is missing: {target_packages}")

    root.mkdir(parents=True, mode=0o755)
    system_roots = tuple(path.resolve(strict=True) for path in SYSTEM_ELF_ROOTS)
    copy_entry(root, Path("/usr/local/bin/python3"), system_roots)
    for library in sorted(Path("/usr/local/lib").glob("libpython3.14.so*")):
        copy_entry(root, library, system_roots)
    def exclude_stdlib(relative: Path) -> bool:
        parts = relative.parts
        return bool(
            parts
            and (
                parts[0] in {"site-packages", "ensurepip"}
                or parts[0].startswith("config-")
                or relative.as_posix() in {"tarfile.py", "html/parser.py"}
                or "__pycache__" in parts
                or relative.suffix in {".pyc", ".pyo"}
            )
        )

    def exclude_cache(relative: Path) -> bool:
        return "__pycache__" in relative.parts or relative.suffix in {".pyc", ".pyo"}

    copy_tree(root, Path("/usr/local/lib/python3.14"), excluded=exclude_stdlib)
    copy_tree(root, target_packages, excluded=exclude_cache)

    runtime_stdlib = root / "usr/local/lib/python3.14"
    remove_if_present(runtime_stdlib / "site-packages")
    remove_if_present(runtime_stdlib / "ensurepip")
    remove_if_present(runtime_stdlib / "tarfile.py")
    remove_if_present(runtime_stdlib / "html/parser.py")
    for cache in list(root.rglob("__pycache__")):
        remove_if_present(cache)
    for bytecode in list(root.rglob("*.py[co]")):
        remove_if_present(bytecode)

    for loader in sorted(Path("/lib").glob("ld-musl-*.so.1")):
        copy_entry(root, loader, system_roots)
    copy_os_release(root)
    system_licenses = Path("/usr/share/licenses")
    if system_licenses.is_dir():
        copy_tree(root, system_licenses)
    certificate_bundle = Path("/etc/ssl/certs/ca-certificates.crt")
    if certificate_bundle.is_file():
        copy_entry(root, certificate_bundle, (Path("/etc/ssl").resolve(strict=True),))

    copy_elf_closure(root, target_packages)

    etc = root / "etc"
    etc.mkdir(parents=True, exist_ok=True)
    (etc / "passwd").write_text(
        "root:x:0:0:root:/nonexistent:/sbin/nologin\n"
        "frank:x:10001:10001:Frank codegraph:/tmp:/sbin/nologin\n",
        encoding="utf-8",
    )
    (etc / "group").write_text("root:x:0:\nfrank:x:10001:\n", encoding="utf-8")
    for path, mode in (
        (root / "tmp", 0o1777),
        (root / "app", 0o755),
        (root / "app/sbom", 0o755),
        (root / "data/codegraph", 0o750),
        (root / "etc/frank-codegraph", 0o750),
    ):
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(mode)
    for path in (root / "data/codegraph", root / "etc/frank-codegraph"):
        os.chown(path, 10001, 10001)

    forbidden = [
        runtime_stdlib / "tarfile.py",
        runtime_stdlib / "html/parser.py",
        runtime_stdlib / "ensurepip",
        root / "sbin/apk",
        root / "bin/sh",
        root / "usr/bin/pip",
        root / "usr/local/bin/pip",
    ]
    present = [str(path) for path in forbidden if path.exists() or path.is_symlink()]
    if present:
        fail(f"forbidden runtime paths remain: {present}")
    if any(root.rglob("__pycache__")) or any(root.rglob("*.py[co]")):
        fail("bytecode or cache files remain in scratch root")
    audit_runtime_root(root)


if __name__ == "__main__":
    main()
