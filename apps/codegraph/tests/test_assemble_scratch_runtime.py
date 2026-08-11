from __future__ import annotations

import importlib.util
import json
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "assemble_scratch_runtime.py"
SPEC = importlib.util.spec_from_file_location("assemble_scratch_runtime", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load scratch runtime assembler")
ASSEMBLER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ASSEMBLER
SPEC.loader.exec_module(ASSEMBLER)


class OsReleaseAssemblyTests(unittest.TestCase):
    def test_copies_canonical_usr_lib_bytes_to_regular_etc_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "usr/lib/os-release"
            source.parent.mkdir(parents=True)
            source.write_text("ID=alpine\n", encoding="utf-8")
            source.chmod(0o755)
            fallback = base / "etc/os-release"
            fallback.parent.mkdir(parents=True)
            fallback.symlink_to(source)
            root = base / "runtime"
            root.mkdir()

            ASSEMBLER.copy_os_release(root, canonical_source=source, fallback_source=fallback)

            result = root / "etc/os-release"
            self.assertFalse(result.is_symlink())
            self.assertEqual(result.read_bytes(), b"ID=alpine\n")
            self.assertEqual(stat.S_IMODE(result.stat().st_mode), 0o644)

    def test_accepts_only_regular_canonical_contained_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            missing = base / "usr/lib/os-release"
            missing.parent.mkdir(parents=True)
            fallback = base / "etc/os-release"
            fallback.parent.mkdir(parents=True)
            fallback.write_text("ID=test\n", encoding="utf-8")
            root = base / "runtime"
            root.mkdir()

            ASSEMBLER.copy_os_release(root, canonical_source=missing, fallback_source=fallback)

            self.assertEqual((root / "etc/os-release").read_bytes(), b"ID=test\n")
            self.assertFalse((root / "etc/os-release").is_symlink())

    def test_rejects_symlink_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            missing = base / "usr/lib/os-release"
            missing.parent.mkdir(parents=True)
            real = base / "usr/lib/real-os-release"
            real.write_text("ID=test\n", encoding="utf-8")
            fallback = base / "etc/os-release"
            fallback.parent.mkdir(parents=True)
            fallback.symlink_to(real)
            root = base / "runtime"
            root.mkdir()

            with self.assertRaisesRegex(RuntimeError, "real regular file"):
                ASSEMBLER.copy_os_release(root, canonical_source=missing, fallback_source=fallback)


class RemovedStdlibTests(unittest.TestCase):
    def test_manifest_excludes_optional_tk_gui_surface(self) -> None:
        for relative in (
            Path("lib-dynload/_tkinter.cpython-314-x86_64-linux-musl.so"),
            Path("tkinter/__init__.py"),
            Path("idlelib/__main__.py"),
            Path("turtledemo/__main__.py"),
            Path("tkinter/__pycache__/__init__.cpython-314.pyc"),
        ):
            with self.subTest(relative=relative):
                self.assertTrue(ASSEMBLER.stdlib_excluded(relative))

    def test_prunes_tk_files_before_elf_dependency_closure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stdlib = Path(directory)
            for relative in (
                Path("lib-dynload/_tkinter.cpython-314-x86_64-linux-musl.so"),
                Path("tkinter/__init__.py"),
                Path("idlelib/__main__.py"),
                Path("turtledemo/__main__.py"),
            ):
                path = stdlib / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"removed")

            ASSEMBLER.prune_removed_stdlib(stdlib)

            self.assertFalse(any(stdlib.rglob("_tkinter*.so")))
            for name in ASSEMBLER.REMOVED_STDLIB_DIRECTORIES:
                self.assertFalse((stdlib / name).exists())


class ElfMetadataTests(unittest.TestCase):
    def test_parses_needed_and_origin_runpath_without_undefined_symbols(self) -> None:
        metadata = ASSEMBLER.parse_scanelf_metadata(
            f"libpython3.14.so.1.0,libc.musl-x86_64.so.1;$ORIGIN/.libs:/usr/local/lib;{SCRIPT.resolve()}\n",
            SCRIPT,
        )
        self.assertEqual(metadata.needed, ("libpython3.14.so.1.0", "libc.musl-x86_64.so.1"))
        self.assertEqual(metadata.runpaths, ("$ORIGIN/.libs", "/usr/local/lib"))

    def test_normalizes_padded_no_runpath_marker(self) -> None:
        metadata = ASSEMBLER.parse_scanelf_metadata(
            f"  libc.musl-x86_64.so.1 ;   -   ; {SCRIPT.resolve()} \n",
            SCRIPT,
        )
        self.assertEqual(metadata.needed, ("libc.musl-x86_64.so.1",))
        self.assertEqual(metadata.runpaths, ())

    def test_normalizes_padded_no_needed_marker_and_whitespace(self) -> None:
        metadata = ASSEMBLER.parse_scanelf_metadata(
            f" \t-\t ;  $ORIGIN/.libs : /usr/local/lib  ; {SCRIPT.resolve()} \n",
            SCRIPT,
        )
        self.assertEqual(metadata.needed, ())
        self.assertEqual(metadata.runpaths, ("$ORIGIN/.libs", "/usr/local/lib"))

    def test_normalizes_both_none_markers_but_rejects_multiple_lines(self) -> None:
        self.assertEqual(
            ASSEMBLER.parse_scanelf_metadata(f"  - ; - ; {SCRIPT.resolve()} \n", SCRIPT),
            ASSEMBLER.ElfMetadata((), ()),
        )
        with self.assertRaisesRegex(RuntimeError, "unexpected scanelf metadata"):
            ASSEMBLER.parse_scanelf_metadata(
                f"libc.so.1;-;{SCRIPT.resolve()}\nlibm.so.1;-;{SCRIPT.resolve()}\n",
                SCRIPT,
            )

    def test_rejects_reported_filename_mismatch_and_extra_field(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            ASSEMBLER.parse_scanelf_metadata(f"libc.so.1;-;{Path(__file__).resolve()}\n", SCRIPT)
        with self.assertRaisesRegex(RuntimeError, "unexpected scanelf metadata"):
            ASSEMBLER.parse_scanelf_metadata(f"libc.so.1;-;{SCRIPT.resolve()};extra\n", SCRIPT)

    def test_python_extension_scan_never_invokes_ldd(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "extension.so"
            source.write_bytes(b"\x7fELFsimulated")
            allowed = (Path(directory).resolve(),)
            completed = mock.Mock(
                returncode=0,
                stdout=f"libpython3.14.so.1.0;-;{source.resolve()}\n",
                stderr="",
            )
            with mock.patch.object(ASSEMBLER.subprocess, "run", return_value=completed) as run:
                metadata = ASSEMBLER.scanelf_metadata(source, "/usr/bin/scanelf", allowed)
            self.assertEqual(metadata.needed, ("libpython3.14.so.1.0",))
            command = run.call_args.args[0]
            self.assertEqual(command[:3], ["/usr/bin/scanelf", "-BF", "%n;%r;%F"])
            self.assertNotIn("ldd", command)

    def test_resolves_dependency_from_contained_origin_runpath(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "site-packages"
            origin = target / "extension"
            package_lib = origin / ".libs"
            package_lib.mkdir(parents=True)
            source = origin / "extension.so"
            source.write_bytes(b"\x7fELFextension")
            dependency = package_lib / "libexample.so.1"
            dependency.write_bytes(b"\x7fELFdependency")
            allowed = (target.resolve(),)

            resolved = ASSEMBLER.resolve_needed_library(
                "libexample.so.1",
                source=source,
                origin=origin,
                runpaths=("$ORIGIN/.libs",),
                system_default_directories=(),
                allowed_roots=allowed,
            )

            self.assertEqual(resolved.candidate, dependency.resolve())
            self.assertEqual(resolved.tier, "current-runpath")
            self.assertEqual(resolved.audit_record()["source"], str(source.resolve()))

    def test_origin_runpath_selects_matching_numpy_and_rapidfuzz_vendor_library(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "site-packages"
            numpy_origin = target / "numpy/core"
            rapidfuzz_origin = target / "rapidfuzz"
            numpy_libs = target / "numpy.libs"
            rapidfuzz_libs = target / "rapidfuzz.libs"
            for path in (numpy_origin, rapidfuzz_origin, numpy_libs, rapidfuzz_libs):
                path.mkdir(parents=True)
            numpy_source = numpy_origin / "_multiarray.so"
            rapidfuzz_source = rapidfuzz_origin / "fuzz.so"
            numpy_source.write_bytes(b"\x7fELFnumpy")
            rapidfuzz_source.write_bytes(b"\x7fELFrapidfuzz")
            numpy_dependency = numpy_libs / "libduplicate.so"
            rapidfuzz_dependency = rapidfuzz_libs / "libduplicate.so"
            numpy_dependency.write_bytes(b"numpy-vendor")
            rapidfuzz_dependency.write_bytes(b"rapidfuzz-vendor")
            allowed = (target.resolve(),)

            numpy_resolution = ASSEMBLER.resolve_needed_library(
                "libduplicate.so",
                source=numpy_source,
                origin=numpy_origin,
                runpaths=("$ORIGIN/../../numpy.libs",),
                system_default_directories=(),
                allowed_roots=allowed,
            )
            rapidfuzz_resolution = ASSEMBLER.resolve_needed_library(
                "libduplicate.so",
                source=rapidfuzz_source,
                origin=rapidfuzz_origin,
                runpaths=("$ORIGIN/../rapidfuzz.libs",),
                system_default_directories=(),
                allowed_roots=allowed,
            )

            self.assertEqual(numpy_resolution.candidate, numpy_dependency.resolve())
            self.assertEqual(rapidfuzz_resolution.candidate, rapidfuzz_dependency.resolve())

    def test_ordered_runpath_uses_first_directory_with_soname(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            origin = root / "extension"
            first = root / "first"
            second = root / "second"
            for path in (origin, first, second):
                path.mkdir()
            source = origin / "extension.so"
            source.write_bytes(b"\x7fELFextension")
            first_dependency = first / "libduplicate.so"
            first_dependency.write_bytes(b"first")
            (second / "libduplicate.so").write_bytes(b"second")

            resolution = ASSEMBLER.resolve_needed_library(
                "libduplicate.so",
                source=source,
                origin=origin,
                runpaths=("$ORIGIN/../first", "$ORIGIN/../second"),
                system_default_directories=(),
                allowed_roots=(root.resolve(),),
            )

            self.assertEqual(resolution.candidate, first_dependency.resolve())
            self.assertEqual(resolution.directory, first.resolve())

    def test_canonical_duplicate_runpath_directory_is_deduplicated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            origin = root / "extension"
            libs = origin / "libs"
            libs.mkdir(parents=True)
            source = origin / "extension.so"
            source.write_bytes(b"\x7fELFextension")
            dependency = libs / "libsame.so"
            dependency.write_bytes(b"same")

            resolution = ASSEMBLER.resolve_needed_library(
                "libsame.so",
                source=source,
                origin=origin,
                runpaths=("$ORIGIN/libs", "$ORIGIN/libs/../libs"),
                system_default_directories=(),
                allowed_roots=(root.resolve(),),
            )

            self.assertEqual(resolution.candidate, dependency.resolve())
            self.assertEqual(resolution.expanded_runpaths, (libs.resolve(),))

    def test_canonical_directory_is_deduplicated_across_owner_tiers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            origin = root / "extension"
            libs = origin / "libs"
            libs.mkdir(parents=True)
            source = origin / "extension.so"
            parent_source = root / "parent.so"
            source.write_bytes(b"\x7fELFextension")
            parent_source.write_bytes(b"\x7fELFparent")
            dependency = libs / "libsame.so"
            dependency.write_bytes(b"same")
            parent = ASSEMBLER.ElfRunpathOwner(
                parent_source.resolve(),
                parent_source.resolve(),
                ("/declared/by/parent",),
                (libs.resolve(),),
            )

            resolution = ASSEMBLER.resolve_needed_library(
                dependency.name,
                source=source,
                origin=origin,
                runpaths=("$ORIGIN/libs",),
                needed_by=(parent,),
                system_default_directories=(),
                allowed_roots=(root.resolve(),),
            )

            self.assertEqual(resolution.search_tiers[0].directories, (libs.resolve(),))
            self.assertEqual(resolution.search_tiers[1].directories, ())

    def test_package_vendor_dso_is_not_seeded_as_loader_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            packages = Path(directory) / "site-packages"
            extension = packages / "numpy/core/_multiarray.so"
            vendor = packages / "numpy.libs/libopenblas.so"
            extension.parent.mkdir(parents=True)
            vendor.parent.mkdir(parents=True)

            self.assertTrue(ASSEMBLER.is_loader_root(extension, packages))
            self.assertFalse(ASSEMBLER.is_loader_root(vendor, packages))

    def test_no_runpath_does_not_search_distinct_package_vendor_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "site-packages"
            target.mkdir()
            source = target / "extension.so"
            source.write_bytes(b"\x7fELFextension")
            for name in ("numpy.libs", "rapidfuzz.libs"):
                vendor = target / name
                vendor.mkdir()
                (vendor / "libduplicate.so").write_bytes(name.encode("ascii"))

            with self.assertRaisesRegex(RuntimeError, "missing"):
                ASSEMBLER.resolve_needed_library(
                    "libduplicate.so",
                    source=source,
                    origin=target,
                    runpaths=(),
                    system_default_directories=(),
                    allowed_roots=(target.resolve(),),
                )

    def test_transitive_dependency_uses_needed_by_ancestor_runpath(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent_dir = root / "parent"
            child_dir = root / "child"
            vendor_dir = parent_dir / ".libs"
            for path in (parent_dir, child_dir, vendor_dir):
                path.mkdir(parents=True, exist_ok=True)
            parent_source = parent_dir / "parent.so"
            child_source = child_dir / "child.so"
            dependency = vendor_dir / "libtransitive.so"
            parent_source.write_bytes(b"\x7fELFparent")
            child_source.write_bytes(b"\x7fELFchild")
            dependency.write_bytes(b"transitive")
            allowed = (root.resolve(),)
            parent_owner = ASSEMBLER.make_runpath_owner(
                parent_source,
                parent_dir,
                ("$ORIGIN/.libs",),
                allowed,
            )

            resolution = ASSEMBLER.resolve_needed_library(
                dependency.name,
                source=child_source,
                origin=child_dir,
                runpaths=(),
                needed_by=(parent_owner,),
                system_default_directories=(),
                allowed_roots=allowed,
            )
            record = resolution.audit_record()

            self.assertEqual(resolution.candidate, dependency.resolve())
            self.assertEqual(resolution.tier, "needed-by-runpath")
            self.assertEqual(record["selectionOwner"]["source"], str(parent_source.resolve()))
            self.assertEqual(record["selectionOwner"]["declaredRunpaths"], ["$ORIGIN/.libs"])
            self.assertEqual(record["selectionOwner"]["expandedRunpaths"], [str(vendor_dir.resolve())])

    def test_needed_by_cycle_is_terminated_by_canonical_visited_identity(self) -> None:
        root = Path("/synthetic")
        parent = ASSEMBLER.ElfRunpathOwner(root / "parent.so", root / "parent.so", (), ())
        current = ASSEMBLER.ElfRunpathOwner(root / "current.so", root / "current.so", (), ())

        ancestry = ASSEMBLER.ancestry_for_child(current, (parent,), parent.canonical_source)

        self.assertIsNone(ancestry)

    def test_needed_by_ancestry_depth_is_bounded(self) -> None:
        root = Path("/synthetic")
        current = ASSEMBLER.ElfRunpathOwner(root / "current.so", root / "current.so", (), ())
        needed_by = tuple(
            ASSEMBLER.ElfRunpathOwner(root / f"ancestor-{index}.so", root / f"ancestor-{index}.so", (), ())
            for index in range(ASSEMBLER.MAX_NEEDED_BY_DEPTH)
        )

        with self.assertRaisesRegex(RuntimeError, "depth"):
            ASSEMBLER.ancestry_for_child(current, needed_by, root / "new-child.so")

    def test_writes_bounded_loader_selection_audit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "extension.so"
            dependency = root / "libexample.so"
            source.write_bytes(b"\x7fELFextension")
            dependency.write_bytes(b"dependency")
            owner = ASSEMBLER.ElfRunpathOwner(source, source, ("$ORIGIN",), (root,))
            tier = ASSEMBLER.ElfSearchTier("current-runpath", owner, (root,))
            resolution = ASSEMBLER.ElfResolution(
                source=source,
                soname=dependency.name,
                search_tiers=(tier,),
                selected_tier_index=0,
                directory=root,
                candidate=dependency,
                canonical_candidate=dependency,
            )
            audit = root / "sbom/elf-resolution.json"

            ASSEMBLER.write_elf_resolution_audit(audit, (resolution,))
            payload = json.loads(audit.read_text(encoding="utf-8"))

            self.assertEqual(payload["resolver"], "scanelf-dynamic-loader-order")
            self.assertEqual(payload["resolutions"][0]["source"], str(source))
            self.assertEqual(payload["resolutions"][0]["selectedCandidate"], str(dependency))

    def test_rejects_escaping_runpath(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            allowed_root = root / "allowed"
            origin = allowed_root / "extension"
            origin.mkdir(parents=True)
            source = origin / "extension.so"
            source.write_bytes(b"\x7fELFextension")
            outside = root / "outside"
            outside.mkdir()
            with self.assertRaisesRegex(RuntimeError, "escapes"):
                ASSEMBLER.resolve_needed_library(
                    "libescape.so",
                    source=source,
                    origin=origin,
                    runpaths=("$ORIGIN/../../outside",),
                    system_default_directories=(),
                    allowed_roots=(allowed_root.resolve(),),
                )

    def test_rejects_missing_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "extension.so"
            source.write_bytes(b"\x7fELFextension")
            with self.assertRaisesRegex(RuntimeError, "missing"):
                ASSEMBLER.resolve_needed_library(
                    "libmissing.so",
                    source=source,
                    origin=root,
                    runpaths=(),
                    system_default_directories=(root,),
                    allowed_roots=(root.resolve(),),
                )
