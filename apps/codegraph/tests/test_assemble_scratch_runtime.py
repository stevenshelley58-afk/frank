from __future__ import annotations

import importlib.util
import stat
import sys
import tempfile
import unittest
from pathlib import Path


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
