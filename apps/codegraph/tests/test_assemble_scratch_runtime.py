from __future__ import annotations

import importlib.util
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


class ElfMetadataTests(unittest.TestCase):
    def test_parses_needed_and_origin_runpath_without_undefined_symbols(self) -> None:
        metadata = ASSEMBLER.parse_scanelf_metadata(
            "libpython3.14.so.1.0,libc.musl-x86_64.so.1;$ORIGIN/.libs:/usr/local/lib\n"
        )
        self.assertEqual(metadata.needed, ("libpython3.14.so.1.0", "libc.musl-x86_64.so.1"))
        self.assertEqual(metadata.runpaths, ("$ORIGIN/.libs", "/usr/local/lib"))

    def test_python_extension_scan_never_invokes_ldd(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "extension.so"
            source.write_bytes(b"\x7fELFsimulated")
            allowed = (Path(directory).resolve(),)
            completed = mock.Mock(
                returncode=0,
                stdout="libpython3.14.so.1.0;-\n",
                stderr="",
            )
            with mock.patch.object(ASSEMBLER.subprocess, "run", return_value=completed) as run:
                metadata = ASSEMBLER.scanelf_metadata(source, "/usr/bin/scanelf", allowed)
            self.assertEqual(metadata.needed, ("libpython3.14.so.1.0",))
            command = run.call_args.args[0]
            self.assertEqual(command[:3], ["/usr/bin/scanelf", "-BF", "%n;%r"])
            self.assertNotIn("ldd", command)

    def test_resolves_dependency_from_contained_origin_runpath(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "site-packages"
            origin = target / "extension"
            package_lib = origin / ".libs"
            package_lib.mkdir(parents=True)
            dependency = package_lib / "libexample.so.1"
            dependency.write_bytes(b"\x7fELFdependency")
            allowed = (target.resolve(),)

            resolved = ASSEMBLER.resolve_needed_library(
                "libexample.so.1",
                origin=origin,
                runpaths=("$ORIGIN/.libs",),
                search_directories=(),
                allowed_roots=allowed,
            )

            self.assertEqual(resolved, dependency.resolve())

    def test_rejects_ambiguous_dependency_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first"
            second = root / "second"
            first.mkdir()
            second.mkdir()
            (first / "libduplicate.so").write_bytes(b"first")
            (second / "libduplicate.so").write_bytes(b"second")
            with self.assertRaisesRegex(RuntimeError, "ambiguous"):
                ASSEMBLER.resolve_needed_library(
                    "libduplicate.so",
                    origin=first,
                    runpaths=(),
                    search_directories=(first, second),
                    allowed_roots=(root.resolve(),),
                )

    def test_rejects_escaping_runpath(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            allowed_root = root / "allowed"
            origin = allowed_root / "extension"
            origin.mkdir(parents=True)
            outside = root / "outside"
            outside.mkdir()
            with self.assertRaisesRegex(RuntimeError, "escapes"):
                ASSEMBLER.resolve_needed_library(
                    "libescape.so",
                    origin=origin,
                    runpaths=("$ORIGIN/../../outside",),
                    search_directories=(),
                    allowed_roots=(allowed_root.resolve(),),
                )

    def test_rejects_missing_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(RuntimeError, "missing"):
                ASSEMBLER.resolve_needed_library(
                    "libmissing.so",
                    origin=root,
                    runpaths=(),
                    search_directories=(root,),
                    allowed_roots=(root.resolve(),),
                )
