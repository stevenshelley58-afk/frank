from __future__ import annotations

import os
import stat
import tempfile
import unittest
from pathlib import Path

from frank_codegraph.volume_init import DIRECTORY_MODE, FILE_MODE, initialize_volume


@unittest.skipUnless(hasattr(os, "fchown"), "volume ownership requires POSIX")
class VolumeInitializerTests(unittest.TestCase):
    RELEASE = "20260811T120000Z-012345abcdef"

    def migrate(self, root: Path, **limits: int) -> None:
        root.chmod(0o700)
        initialize_volume(
            root,
            expected_root=root,
            uid=os.getuid(),
            gid=os.getgid(),
            **limits,
        )

    def test_migrates_nested_legacy_tree_for_service_user(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            nested = root / "project" / "releases" / "old"
            nested.mkdir(parents=True, mode=0o700)
            status = nested / "status.json"
            status.write_text("{}", encoding="utf-8")
            status.chmod(0o600)

            self.migrate(root)

            for path in (root, root / "project", root / "project/releases", nested):
                self.assertEqual((path.stat().st_uid, path.stat().st_gid), (os.getuid(), os.getgid()))
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), DIRECTORY_MODE)
            self.assertEqual((status.stat().st_uid, status.stat().st_gid), (os.getuid(), os.getgid()))
            self.assertEqual(stat.S_IMODE(status.stat().st_mode), FILE_MODE)
            status.write_text('{"ready":true}', encoding="utf-8")

    def test_rejects_symlink_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            real = base / "real"
            real.mkdir()
            link = base / "codegraph"
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "real directory"):
                initialize_volume(link, expected_root=link, uid=os.getuid(), gid=os.getgid())

    def test_rejects_symlink_descendant_before_changing_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            root.mkdir(mode=0o700)
            (root / "escape").symlink_to(Path(directory), target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "symlink outside"):
                self.migrate(root)
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)

    def test_migrates_populated_volume_with_valid_current_release_link(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            release = root / "frank" / "releases" / self.RELEASE
            release.mkdir(parents=True, mode=0o700)
            (release / "status.json").write_text("{}", encoding="utf-8")
            current = root / "frank" / "current"
            current.symlink_to(Path("releases") / self.RELEASE, target_is_directory=True)

            self.migrate(root)

            self.assertTrue(current.is_symlink())
            self.assertEqual(os.readlink(current), f"releases/{self.RELEASE}")
            self.assertEqual((current.lstat().st_uid, current.lstat().st_gid), (os.getuid(), os.getgid()))
            self.assertEqual(stat.S_IMODE(release.stat().st_mode), DIRECTORY_MODE)

    def test_rejects_escaping_current_link(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            project = root / "frank"
            project.mkdir(parents=True, mode=0o700)
            (project / "current").symlink_to(Path("..") / ".." / "outside", target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "unsafe release shape"):
                self.migrate(root)

    def test_rejects_broken_current_link(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            project = root / "frank"
            (project / "releases").mkdir(parents=True, mode=0o700)
            (project / "current").symlink_to(Path("releases") / self.RELEASE, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "not inventoried"):
                self.migrate(root)

    def test_rejects_current_link_in_wrong_position(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            release = root / "frank" / "nested" / "releases" / self.RELEASE
            release.mkdir(parents=True, mode=0o700)
            (root / "frank" / "nested" / "current").symlink_to(
                Path("releases") / self.RELEASE,
                target_is_directory=True,
            )
            with self.assertRaisesRegex(RuntimeError, "symlink outside"):
                self.migrate(root)

    def test_rejects_hard_link_anomaly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            root.mkdir(mode=0o700)
            first = root / "first.json"
            first.write_text("{}", encoding="utf-8")
            os.link(first, root / "second.json")
            with self.assertRaisesRegex(RuntimeError, "hard-linked"):
                self.migrate(root)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "special entry test requires mkfifo")
    def test_rejects_special_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            root.mkdir(mode=0o700)
            os.mkfifo(root / "pipe")
            with self.assertRaisesRegex(RuntimeError, "special entry"):
                self.migrate(root)

    def test_enforces_entry_and_depth_caps(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            (root / "one" / "two").mkdir(parents=True, mode=0o700)
            with self.assertRaisesRegex(RuntimeError, "entry limit"):
                self.migrate(root, max_entries=1)
            with self.assertRaisesRegex(RuntimeError, "depth limit"):
                self.migrate(root, max_depth=1)

    def test_rejects_any_target_other_than_expected_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "codegraph"
            root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "intended root"):
                initialize_volume(
                    root,
                    expected_root=Path(directory) / "different",
                    uid=os.getuid(),
                    gid=os.getgid(),
                )
