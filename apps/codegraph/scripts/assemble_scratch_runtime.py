from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


ELF_MAGIC = b"\x7fELF"
SAFE_SONAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,255}$")
MAX_ELF_OBJECTS = 4096
MAX_ELF_RESOLUTIONS = 16_384
MAX_NEEDED_BY_DEPTH = 64
MAX_ELF_AUDIT_BYTES = 8 * 1024 * 1024
MAX_NEEDED_PER_ELF = 256
MAX_RUNPATHS_PER_ELF = 128
MAX_SCANELF_OUTPUT = 65_536
REMOVED_STDLIB_FILES = ("tarfile.py", "html/parser.py")
REMOVED_STDLIB_DIRECTORIES = ("tkinter", "idlelib", "turtledemo")
SYSTEM_ELF_ROOTS = (
    Path("/lib"),
    Path("/usr/lib"),
    Path("/usr/local/lib"),
    Path("/usr/local"),
)
MUSL_DEFAULT_ELF_DIRECTORIES = (
    Path("/lib"),
    Path("/usr/local/lib"),
    Path("/usr/lib"),
)


@dataclass(frozen=True)
class ElfMetadata:
    needed: tuple[str, ...]
    runpaths: tuple[str, ...]


@dataclass(frozen=True)
class ElfRunpathOwner:
    source: Path
    canonical_source: Path
    declared_runpaths: tuple[str, ...]
    expanded_runpaths: tuple[Path, ...]

    def audit_record(self) -> dict[str, object]:
        return {
            "source": str(self.source),
            "canonicalSource": str(self.canonical_source),
            "declaredRunpaths": list(self.declared_runpaths),
            "expandedRunpaths": [str(path) for path in self.expanded_runpaths],
        }


@dataclass(frozen=True)
class ElfSearchTier:
    tier: str
    owner: ElfRunpathOwner | None
    directories: tuple[Path, ...]

    def audit_record(self, order: int) -> dict[str, object]:
        return {
            "order": order,
            "tier": self.tier,
            "owner": None if self.owner is None else self.owner.audit_record(),
            "searchedDirectories": [str(path) for path in self.directories],
        }


@dataclass(frozen=True)
class ElfResolution:
    source: Path
    soname: str
    search_tiers: tuple[ElfSearchTier, ...]
    selected_tier_index: int
    directory: Path
    candidate: Path
    canonical_candidate: Path

    @property
    def tier(self) -> str:
        return self.search_tiers[self.selected_tier_index].tier

    @property
    def expanded_runpaths(self) -> tuple[Path, ...]:
        owner = self.search_tiers[0].owner
        return () if owner is None else owner.expanded_runpaths

    def audit_record(self) -> dict[str, object]:
        selected_tier = self.search_tiers[self.selected_tier_index]
        return {
            "source": str(self.source),
            "soname": self.soname,
            "searchTiers": [tier.audit_record(order) for order, tier in enumerate(self.search_tiers)],
            "selectionTier": selected_tier.tier,
            "selectionTierOrder": self.selected_tier_index,
            "selectionOwner": None if selected_tier.owner is None else selected_tier.owner.audit_record(),
            "selectedDirectory": str(self.directory),
            "selectedCandidate": str(self.candidate),
            "canonicalCandidate": str(self.canonical_candidate),
        }


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


def parse_scanelf_metadata(output: str, expected_source: Path) -> ElfMetadata:
    if len(output) > MAX_SCANELF_OUTPUT:
        fail("scanelf metadata output exceeds limit")
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if len(lines) != 1 or lines[0].count(";") != 2:
        fail(f"unexpected scanelf metadata output: {output!r}")
    needed_field, runpath_field, filename_field = lines[0].split(";", 2)

    def values(field: str, separator: str, label: str) -> tuple[str, ...]:
        normalized = field.strip()
        if normalized in {"", "-"}:
            return ()
        parsed = tuple(value.strip() for value in normalized.split(separator))
        if any(not value or value == "-" for value in parsed):
            fail(f"scanelf {label} field mixes an empty/none marker with values")
        return parsed

    needed = values(needed_field, ",", "DT_NEEDED")
    runpaths = values(runpath_field, ":", "RUNPATH")
    reported_source = Path(filename_field.strip())
    if not reported_source.is_absolute():
        fail(f"scanelf reported a non-absolute source filename: {filename_field!r}")
    if reported_source.resolve(strict=True) != expected_source.resolve(strict=True):
        fail(f"scanelf source filename does not match requested object: {reported_source}")
    if len(needed) > MAX_NEEDED_PER_ELF:
        fail("ELF object exceeds DT_NEEDED limit")
    if len(runpaths) > MAX_RUNPATHS_PER_ELF:
        fail("ELF object exceeds RUNPATH limit")
    if any(not SAFE_SONAME.fullmatch(value) for value in needed):
        fail(f"ELF object contains unsafe DT_NEEDED value: {needed}")
    return ElfMetadata(needed=needed, runpaths=runpaths)


def scanelf_metadata(source: Path, scanelf: str, allowed_roots: tuple[Path, ...]) -> ElfMetadata:
    validated_regular(source, allowed_roots)
    if not is_elf(source):
        fail(f"scanelf input is not an ELF object: {source}")
    result = subprocess.run(
        [scanelf, "-BF", "%n;%r;%F", str(source)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        fail(f"scanelf could not read ELF metadata for {source}: {result.stderr[:512]}")
    if result.stderr.strip():
        fail(f"scanelf emitted diagnostics for {source}: {result.stderr[:512]}")
    return parse_scanelf_metadata(result.stdout, source)


def contained_directory(path: Path, allowed_roots: tuple[Path, ...]) -> Path:
    canonical = path.resolve(strict=True)
    if not canonical.is_dir() or not any(canonical == root or canonical.is_relative_to(root) for root in allowed_roots):
        fail(f"ELF search directory escapes its allowlist: {path}")
    return canonical


def expand_runpaths(origin: Path, runpaths: tuple[str, ...], allowed_roots: tuple[Path, ...]) -> tuple[Path, ...]:
    expanded: list[Path] = []
    for raw in runpaths:
        value = raw.replace("${ORIGIN}", str(origin)).replace("$ORIGIN", str(origin))
        if "$" in value:
            fail(f"ELF RUNPATH contains an unsupported variable: {raw}")
        candidate = Path(value)
        if not candidate.is_absolute():
            fail(f"ELF RUNPATH must be absolute or anchored at $ORIGIN: {raw}")
        canonical = contained_directory(candidate, allowed_roots)
        if canonical not in expanded:
            expanded.append(canonical)
    return tuple(expanded)


def make_runpath_owner(
    source: Path,
    origin: Path,
    runpaths: tuple[str, ...],
    allowed_roots: tuple[Path, ...],
) -> ElfRunpathOwner:
    resolved_source, _metadata = validated_regular(source, allowed_roots)
    return ElfRunpathOwner(
        source=Path(os.path.abspath(source)),
        canonical_source=resolved_source,
        declared_runpaths=runpaths,
        expanded_runpaths=expand_runpaths(origin, runpaths, allowed_roots),
    )


def validate_needed_by_chain(current: ElfRunpathOwner, needed_by: tuple[ElfRunpathOwner, ...]) -> None:
    if len(needed_by) > MAX_NEEDED_BY_DEPTH:
        fail("ELF needed_by ancestry exceeds depth limit")
    canonical_sources = [current.canonical_source, *(owner.canonical_source for owner in needed_by)]
    if len(set(canonical_sources)) != len(canonical_sources):
        fail("ELF needed_by ancestry contains a cycle")


def ancestry_for_child(
    current: ElfRunpathOwner,
    needed_by: tuple[ElfRunpathOwner, ...],
    child_canonical_source: Path,
) -> tuple[ElfRunpathOwner, ...] | None:
    validate_needed_by_chain(current, needed_by)
    ancestry = (current, *needed_by)
    if child_canonical_source in {owner.canonical_source for owner in ancestry}:
        return None
    if len(ancestry) > MAX_NEEDED_BY_DEPTH:
        fail("ELF needed_by ancestry exceeds depth limit")
    return ancestry


def is_loader_root(source: Path, target_packages: Path) -> bool:
    """Treat importable extensions as roots, but load package vendor DSOs only through an edge."""
    lexical_source = Path(os.path.abspath(source))
    lexical_packages = Path(os.path.abspath(target_packages))
    if not lexical_source.is_relative_to(lexical_packages):
        return True
    relative = lexical_source.relative_to(lexical_packages)
    return not any(part.endswith(".libs") for part in relative.parts[:-1])


def resolve_needed_library(
    soname: str,
    *,
    source: Path,
    origin: Path,
    runpaths: tuple[str, ...],
    needed_by: tuple[ElfRunpathOwner, ...] = (),
    system_default_directories: tuple[Path, ...],
    allowed_roots: tuple[Path, ...],
) -> ElfResolution:
    if not SAFE_SONAME.fullmatch(soname):
        fail(f"unsafe DT_NEEDED value: {soname}")
    current = make_runpath_owner(source, origin, runpaths, allowed_roots)
    validate_needed_by_chain(current, needed_by)

    # Match musl's load_library order: the requesting object's RUNPATH/RPATH,
    # then each needed_by ancestor's path, then the ordered system defaults.
    # An exact SONAME lookup yields one lexical candidate per directory; later
    # directories must not make an earlier loader-selected candidate ambiguous.
    owner_tiers = (("current-runpath", current),) + tuple(
        ("needed-by-runpath", owner) for owner in needed_by
    )
    seen_directories: set[Path] = set()
    search_tiers: list[ElfSearchTier] = []
    for tier_name, owner in owner_tiers:
        searched_directories: list[Path] = []
        for directory in owner.expanded_runpaths:
            canonical_directory = contained_directory(directory, allowed_roots)
            if canonical_directory in seen_directories:
                continue
            seen_directories.add(canonical_directory)
            searched_directories.append(canonical_directory)
        search_tiers.append(ElfSearchTier(tier_name, owner, tuple(searched_directories)))

    default_directories: list[Path] = []
    for directory in system_default_directories:
        canonical_directory = contained_directory(directory, allowed_roots)
        if canonical_directory in seen_directories:
            continue
        seen_directories.add(canonical_directory)
        default_directories.append(canonical_directory)
    search_tiers.append(ElfSearchTier("system-default", None, tuple(default_directories)))

    for tier_index, tier in enumerate(search_tiers):
        for canonical_directory in tier.directories:
            candidate = canonical_directory / soname
            if not os.path.lexists(candidate):
                continue
            resolved, _metadata = validated_regular(candidate, allowed_roots)
            return ElfResolution(
                source=current.canonical_source,
                soname=soname,
                search_tiers=tuple(search_tiers),
                selected_tier_index=tier_index,
                directory=canonical_directory,
                candidate=candidate,
                canonical_candidate=resolved,
            )
    fail(f"missing ELF DT_NEEDED dependency {soname} for {current.canonical_source}")


def copy_elf_closure(root: Path, target_packages: Path) -> tuple[ElfResolution, ...]:
    scanelf_path = Path("/usr/bin/scanelf")
    scanelf_info = scanelf_path.lstat()
    if not stat.S_ISREG(scanelf_info.st_mode) or stat.S_ISLNK(scanelf_info.st_mode) or not os.access(scanelf_path, os.X_OK):
        fail("builder does not provide the pinned regular /usr/bin/scanelf")
    scanelf = str(scanelf_path)
    allowed_roots = tuple(path.resolve(strict=True) for path in SYSTEM_ELF_ROOTS) + (
        target_packages.resolve(strict=True),
    )
    system_default_directories = tuple(path.resolve(strict=True) for path in MUSL_DEFAULT_ELF_DIRECTORIES)

    queued: set[Path] = set()
    queue: deque[tuple[Path, tuple[ElfRunpathOwner, ...]]] = deque()
    resolutions: list[ElfResolution] = []
    for runtime_path in sorted(root.rglob("*"), key=str):
        if runtime_path.is_file() and is_elf(runtime_path):
            source = source_for(root, runtime_path)
            if not is_loader_root(source, target_packages):
                continue
            resolved, _metadata = validated_regular(source, allowed_roots)
            if resolved not in queued:
                queued.add(resolved)
                queue.append((source, ()))

    while queue:
        if len(queued) > MAX_ELF_OBJECTS:
            fail("ELF dependency closure exceeds object limit")
        source, needed_by = queue.popleft()
        resolved_source, _metadata = validated_regular(source, allowed_roots)
        metadata = scanelf_metadata(resolved_source, scanelf, allowed_roots)
        current_owner = make_runpath_owner(
            source,
            source.parent.resolve(strict=True),
            metadata.runpaths,
            allowed_roots,
        )
        validate_needed_by_chain(current_owner, needed_by)
        for soname in metadata.needed:
            resolution = resolve_needed_library(
                soname,
                source=source,
                origin=source.parent.resolve(strict=True),
                runpaths=metadata.runpaths,
                needed_by=needed_by,
                system_default_directories=system_default_directories,
                allowed_roots=allowed_roots,
            )
            resolutions.append(resolution)
            if len(resolutions) > MAX_ELF_RESOLUTIONS:
                fail("ELF dependency resolution audit exceeds limit")
            dependency = resolution.candidate
            copy_entry(root, dependency, allowed_roots)
            resolved_dependency, _dependency_metadata = validated_regular(dependency, allowed_roots)
            if not is_elf(resolved_dependency):
                fail(f"DT_NEEDED candidate is not an ELF object: {dependency}")
            child_ancestry = ancestry_for_child(current_owner, needed_by, resolved_dependency)
            if resolved_dependency not in queued:
                if child_ancestry is None:
                    fail("unvisited ELF dependency unexpectedly forms an ancestry cycle")
                queued.add(resolved_dependency)
                queue.append((dependency, child_ancestry))
    return tuple(resolutions)


def write_elf_resolution_audit(destination: Path, resolutions: tuple[ElfResolution, ...]) -> None:
    payload = {
        "schemaVersion": 1,
        "resolver": "scanelf-dynamic-loader-order",
        "systemDefaultDirectories": [str(path) for path in MUSL_DEFAULT_ELF_DIRECTORIES],
        "resolutions": [resolution.audit_record() for resolution in resolutions],
    }
    encoded = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if len(encoded) > MAX_ELF_AUDIT_BYTES:
        fail("ELF dependency resolution audit exceeds byte limit")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(encoded)
    destination.chmod(0o644)


def remove_if_present(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif path.exists() or path.is_symlink():
        path.unlink()


def stdlib_excluded(relative: Path) -> bool:
    parts = relative.parts
    return bool(
        parts
        and (
            parts[0] in {"site-packages", "ensurepip", *REMOVED_STDLIB_DIRECTORIES}
            or parts[0].startswith("config-")
            or relative.as_posix() in REMOVED_STDLIB_FILES
            or (relative.name.startswith("_tkinter") and relative.suffix == ".so")
            or "__pycache__" in parts
            or relative.suffix in {".pyc", ".pyo"}
        )
    )


def prune_removed_stdlib(runtime_stdlib: Path) -> None:
    for relative in REMOVED_STDLIB_FILES:
        remove_if_present(runtime_stdlib / relative)
    for name in REMOVED_STDLIB_DIRECTORIES:
        remove_if_present(runtime_stdlib / name)
    for extension in list(runtime_stdlib.rglob("_tkinter*.so")):
        remove_if_present(extension)


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

    def exclude_cache(relative: Path) -> bool:
        return "__pycache__" in relative.parts or relative.suffix in {".pyc", ".pyo"}

    copy_tree(root, Path("/usr/local/lib/python3.14"), excluded=stdlib_excluded)
    copy_tree(root, target_packages, excluded=exclude_cache)

    runtime_stdlib = root / "usr/local/lib/python3.14"
    remove_if_present(runtime_stdlib / "site-packages")
    remove_if_present(runtime_stdlib / "ensurepip")
    prune_removed_stdlib(runtime_stdlib)
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

    elf_resolutions = copy_elf_closure(root, target_packages)

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
    write_elf_resolution_audit(root / "app/sbom/elf-resolution.json", elf_resolutions)

    forbidden = [
        *(runtime_stdlib / relative for relative in REMOVED_STDLIB_FILES),
        *(runtime_stdlib / name for name in REMOVED_STDLIB_DIRECTORIES),
        runtime_stdlib / "ensurepip",
        root / "sbin/apk",
        root / "bin/sh",
        root / "usr/bin/pip",
        root / "usr/local/bin/pip",
    ]
    present = [str(path) for path in forbidden if path.exists() or path.is_symlink()]
    if present:
        fail(f"forbidden runtime paths remain: {present}")
    if any(runtime_stdlib.rglob("_tkinter*.so")):
        fail("forbidden _tkinter extension remains in scratch root")
    if any(root.rglob("__pycache__")) or any(root.rglob("*.py[co]")):
        fail("bytecode or cache files remain in scratch root")
    audit_runtime_root(root)


if __name__ == "__main__":
    main()
