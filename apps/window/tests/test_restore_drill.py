import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "run_restore_drill.py"


class RestoreDrillTests(unittest.TestCase):
    def _fixture(self, root: Path) -> tuple[Path, Path]:
        source = root / "graph"
        source.mkdir()
        (source / "current.json").write_text(
            '{"graph_hash":"g_' + "a" * 64 + '"}',
            encoding="utf-8",
        )
        nested = source / "graph" / ("g_" + "a" * 64)
        nested.mkdir(parents=True)
        (nested / "graph.json").write_text('{"nodes":[]}', encoding="utf-8")
        revision = root / "approved-sha"
        revision.write_text("b" * 40 + "\n", encoding="utf-8")
        return source, revision

    def _run(
        self,
        *,
        source: Path,
        revision: Path,
        backup: Path,
        run_key: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--source-root",
                str(source),
                "--backup-root",
                str(backup),
                "--revision-file",
                str(revision),
                "--run-key",
                run_key,
            ],
            capture_output=True,
            text=True,
        )

    def test_round_trip_emits_passing_hash_bound_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, revision = self._fixture(root)
            source_before = {
                path.relative_to(source): path.read_bytes()
                for path in source.rglob("*")
                if path.is_file()
            }
            backup = root / "backups"
            result = self._run(
                source=source,
                revision=revision,
                backup=backup,
                run_key="restore-drill-test",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(result.stdout)
            run_dir = backup / "restore-drill-test"
            self.assertEqual(receipt["schema"], "frank.restore-drill-evidence/v1")
            self.assertEqual(receipt["status"], "passed")
            self.assertEqual(receipt["outcome"], "pass")
            self.assertTrue(receipt["content_match"])
            self.assertEqual(receipt["file_count"], len(source_before))
            self.assertEqual(
                receipt["backup_sha256"],
                "sha256:" + hashlib.sha256((run_dir / "control-graph.tar.gz").read_bytes()).hexdigest(),
            )
            self.assertEqual(
                json.loads((run_dir / "source-manifest.json").read_text(encoding="utf-8")),
                json.loads((run_dir / "restored-manifest.json").read_text(encoding="utf-8")),
            )
            self.assertFalse((run_dir / "restored").exists())
            self.assertEqual(
                {path.relative_to(source): path.read_bytes() for path in source.rglob("*") if path.is_file()},
                source_before,
            )
            self.assertEqual(
                json.loads((backup / "latest-restore-drill.json").read_text(encoding="utf-8"))["receipt_id"],
                receipt["receipt_id"],
            )

    def test_archive_bytes_are_deterministic_for_the_same_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, revision = self._fixture(root)
            hashes = []
            for suffix in ("one", "two"):
                backup = root / ("backups-" + suffix)
                result = self._run(
                    source=source,
                    revision=revision,
                    backup=backup,
                    run_key="restore-drill-" + suffix,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                archive = backup / ("restore-drill-" + suffix) / "control-graph.tar.gz"
                hashes.append(hashlib.sha256(archive.read_bytes()).hexdigest())
            self.assertEqual(hashes[0], hashes[1])

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_symlinked_source_fails_without_a_pass_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, revision = self._fixture(root)
            outside = root / "outside"
            outside.write_text("x", encoding="utf-8")
            try:
                (source / "unsafe").symlink_to(outside)
            except OSError:
                self.skipTest("symlinks unavailable")
            result = self._run(
                source=source,
                revision=revision,
                backup=root / "backups",
                run_key="restore-drill-symlink",
            )
            self.assertEqual(result.returncode, 1)
            self.assertNotIn('"status": "passed"', result.stdout)

    def test_noncanonical_run_key_and_overlapping_backup_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, revision = self._fixture(root)
            cases = (
                ("../escape", root / "backups"),
                ("restore-drill-overlap", source / "backups"),
            )
            for run_key, backup in cases:
                with self.subTest(run_key=run_key):
                    result = self._run(
                        source=source,
                        revision=revision,
                        backup=backup,
                        run_key=run_key,
                    )
                    self.assertEqual(result.returncode, 1)

    def test_oversized_source_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, revision = self._fixture(root)
            (source / "huge.bin").write_bytes(b"x" * (8 * 1024 * 1024 + 1))
            backup = root / "backups"
            result = self._run(
                source=source,
                revision=revision,
                backup=backup,
                run_key="restore-drill-size-test",
            )
            self.assertEqual(result.returncode, 1)
            self.assertFalse((backup / "latest-restore-drill.json").exists())
            self.assertNotIn('"status": "passed"', result.stdout)

    @unittest.skipUnless(os.name != "nt", "POSIX mode semantics required")
    def test_backup_artifacts_are_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, revision = self._fixture(root)
            backup = root / "backups"
            result = self._run(
                source=source,
                revision=revision,
                backup=backup,
                run_key="restore-drill-mode-test",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(backup.stat().st_mode & 0o777, 0o750)
            run_dir = backup / "restore-drill-mode-test"
            for path in (
                run_dir / "control-graph.tar.gz",
                run_dir / "source-manifest.json",
                run_dir / "restored-manifest.json",
                run_dir / "receipt.json",
                backup / "latest-restore-drill.json",
            ):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
