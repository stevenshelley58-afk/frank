"""Attachment service tests: roots, manifests, snapshots, boundaries."""
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from infra.workspace.attachments import (
    SnapshotError,
    UploadSnapshotService,
    require_same_origin,
)
from infra.workspace.manifest import build_manifest, validate_manifest_against_root
from infra.workspace.resolver import PathRejected, WorkspaceRegistry
from infra.workspace.roots import RootCatalog

import sys
sys.path.insert(0, Path(__file__).resolve().parent.parent)
from tests.test_workspace_resolver import _uuid_seq  # noqa: E402


class PartABase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.project_root = base / "canonical"
        (self.project_root / "assets").mkdir(parents=True)
        (self.project_root / "assets" / "logo.png").write_bytes(b"\x89PNG fake" * 4)
        (self.project_root / "assets" / "huge.bin").write_bytes(b"x" * 64)
        (self.project_root / "notes.md").write_text("hello", encoding="utf-8")
        os.symlink("/etc/hostname", self.project_root / "assets" / "escape.png")
        self.uploads = base / "uploads"
        self.uploads.mkdir()
        self.registry = WorkspaceRegistry(
            base / "workspaces.json",
            uuid_factory=_uuid_seq("w-"),
            canonical_prefixes=(str(base) + "/",),
        )
        self.registry.migrate_registry(
            [{
                "project_id": "blockwise", "slug": "blockwise",
                "host_path": str(self.project_root),
                "hermes_path": "/projects/blockwise", "container_path": "/vps/projects/blockwise",
                "legacy_memory_scope": "steven-blockwise",
            }]
        )
        self.workspace_id = next(
            r.workspace_id for r in self.registry.all_records() if r.slug == "blockwise"
        )
        self.catalog = RootCatalog(
            self.registry,
            uploads_container_root=str(self.uploads),
            uploads_host_root=str(self.uploads),
        )
        self.service = UploadSnapshotService(
            self.uploads, max_file_bytes=1_000, max_batch_bytes=4_000, max_batch_files=10,
            host_twin=str(self.uploads),
        )

    def tearDown(self):
        self.temp.cleanup()


class RootCatalogTest(PartABase):
    def test_typed_roots_are_typed_and_scoped(self):
        roots = self.catalog.roots_for(self.workspace_id)
        kinds = {root.kind for root in roots}
        self.assertEqual(kinds, {"live-reference", "upload-staging"})
        for root in roots:
            public = root.public()
            self.assertEqual(set(public), {"root_id", "workspace_id", "kind", "read_only"})
            self.assertTrue(root.root_id.startswith(self.workspace_id))
        staging = next(r for r in roots if r.kind == "upload-staging")
        self.assertTrue(staging.container_path.endswith("/projects/blockwise"))
        self.assertTrue(staging.read_only is False)
        live = next(r for r in roots if r.kind == "live-reference")
        self.assertEqual(live.host_path, str(self.project_root))
        self.assertTrue(live.read_only is True)

    def test_unassigned_workspace_gets_equivalent_staging_root_only(self):
        unassigned = next(r for r in self.registry.all_records() if r.slug == "unassigned")
        roots = self.catalog.roots_for(unassigned.workspace_id)
        self.assertEqual([r.kind for r in roots], ["upload-staging"])
        self.assertIn("/unassigned", roots[0].container_path)

    def test_unknown_root_or_workspace_fails_closed(self):
        with self.assertRaises(PathRejected):
            self.catalog.get(self.workspace_id, "other-root")
        with self.assertRaises(Exception):
            self.catalog.get("w-9999", f"w-9999-live")

    def test_staged_batch_never_mounts_into_live_root(self):
        staging = next(r for r in self.catalog.roots_for(self.workspace_id) if r.kind == "upload-staging")
        self.assertFalse(staging.host_path.startswith(str(self.project_root)))


class ManifestTest(PartABase):
    def test_folder_manifest_is_deterministic_and_truthful(self):
        first = build_manifest(
            self.project_root, "assets", max_files=100, max_total_bytes=1_000_000, max_file_bytes=1000,
        )
        second = build_manifest(
            self.project_root, "assets", max_files=100, max_total_bytes=1_000_000, max_file_bytes=1000,
        )
        self.assertEqual([e["path"] for e in first["entries"]], [e["path"] for e in second["entries"]])
        self.assertEqual(first["totals"], second["totals"])
        self.assertFalse(first["truncation"])
        paths = [e["path"] for e in first["entries"]]
        self.assertEqual(paths, ["assets/huge.bin", "assets/logo.png"])
        self.assertNotIn("assets/escape.png", paths)  # symlink never listed
        self.assertTrue(all("sha256" in e or e.get("hash_deferred") for e in first["entries"]))
        self.assertEqual(first["entries"][1]["media_type"], "image/png")

    def test_manifest_hash_deferral_is_explicit(self):
        manifest = build_manifest(
            self.project_root, "assets", max_files=100, max_total_bytes=1_000_000, max_file_bytes=1000,
            hash_budget_bytes=32,
        )
        huge = next(e for e in manifest["entries"] if e["path"].endswith("huge.bin"))
        self.assertTrue(huge.get("hash_deferred"))

    def test_limits_fail_closed_not_truncated(self):
        with self.assertRaises(PathRejected):
            build_manifest(
                self.project_root, "assets", max_files=1, max_total_bytes=1_000_000, max_file_bytes=1000,
            )
        with self.assertRaises(PathRejected):
            build_manifest(
                self.project_root, "assets/huge.bin", max_files=10, max_total_bytes=1_000_000, max_file_bytes=8,
            )

    def test_use_time_revalidation_detects_change_and_deletion(self):
        manifest = build_manifest(
            self.project_root, "notes.md", max_files=10, max_total_bytes=1_000_000, max_file_bytes=1000,
        )
        self.assertEqual(validate_manifest_against_root(self.project_root, manifest)["files"], 1)
        (self.project_root / "notes.md").write_text("changed!", encoding="utf-8")
        with self.assertRaises(PathRejected):
            validate_manifest_against_root(self.project_root, manifest)
        (self.project_root / "notes.md").unlink()
        with self.assertRaises(PathRejected):
            validate_manifest_against_root(self.project_root, manifest)

    def test_manifest_rejects_bad_paths(self):
        for bad in ["../escape", "/abs", "a\x00b"]:
            with self.assertRaises(PathRejected):
                build_manifest(
                    self.project_root, bad, max_files=10, max_total_bytes=1_000_000, max_file_bytes=1000,
                )


class UploadSnapshotTest(PartABase):
    def _batch_kwargs(self, batch_id="batch-1"):
        return dict(
            workspace_id=self.workspace_id, project_id="blockwise", slug="blockwise",
            session_id="sess-1", batch_id=batch_id,
        )

    def test_atomic_publish_and_manifest_truth(self):
        result = self.service.stage_batch(
            files=[
                {"path": "photos/a.png", "data": b"png-bytes"},
                {"path": "docs/readme.txt", "data": b"hello"},
            ],
            **self._batch_kwargs(),
        )
        self.assertTrue(result["ok"])
        manifest = result["manifest"]
        self.assertEqual(manifest["source"], "local-upload")
        self.assertTrue(manifest["captured_at"])
        self.assertFalse(manifest["truncation"])
        self.assertEqual(manifest["totals"], {"files": 2, "bytes": 14})
        self.assertEqual(
            [e["path"] for e in manifest["entries"]], ["docs/readme.txt", "photos/a.png"]
        )
        self.assertEqual(manifest["sendable"], True)
        self.assertNotIn("host_twin_private", manifest)

    def test_snapshot_immutable_after_original_change(self):
        result = self.service.stage_batch(
            files=[{"path": "a.txt", "data": b"v1"}], **self._batch_kwargs()
        )
        before = result["manifest"]["entries"][0]["sha256"]
        # Simulating the original local folder changing cannot alter the snapshot.
        self.assertEqual(self.service.batch_manifest(self.uploads / "projects/blockwise/sess-1/batch-1")["entries"][0]["sha256"], before)

    def test_duplicate_batch_refused_and_partial_never_published(self):
        self.service.stage_batch(files=[{"path": "a.txt", "data": b"v1"}], **self._batch_kwargs())
        with self.assertRaises(SnapshotError):
            self.service.stage_batch(files=[{"path": "a.txt", "data": b"v1"}], **self._batch_kwargs())
        # A failing batch leaves no finalized directory behind.
        with self.assertRaises(Exception):
            self.service.stage_batch(
                files=[
                    {"path": "ok.txt", "data": b"fine"},
                    {"path": "bad/../evil.txt", "data": b"x"},
                ],
                **self._batch_kwargs("batch-2"),
            )
        self.assertFalse((self.uploads / "projects/blockwise/sess-1/batch-2").exists())
        status = self.service.status(self.uploads / "projects/blockwise/sess-1/batch-2")
        self.assertEqual(status["state"], "absent")

    def test_limits_enforced(self):
        with self.assertRaises(SnapshotError):
            self.service.stage_batch(
                files=[{"path": "big.bin", "data": b"x" * 1001}], **self._batch_kwargs()
            )
        with self.assertRaises(SnapshotError):
            self.service.stage_batch(
                files=[{"path": f"f{i}.txt", "data": b"x"} for i in range(11)],
                **self._batch_kwargs(),
            )
        with self.assertRaises(SnapshotError):
            self.service.stage_batch(
                files=[{"path": "a.bin", "data": b"x" * 2000}, {"path": "b.bin", "data": b"x" * 2000}],
                **self._batch_kwargs(),
            )

    def test_untrusted_paths_and_names(self):
        for bad in ["../escape.txt", "/abs.txt", ".hidden.txt", "a\x00b.txt"]:
            with self.assertRaises(Exception):
                self.service.stage_batch(
                    files=[{"path": bad, "data": b"x"}], **self._batch_kwargs()
                )

    def test_unassigned_partition_is_explicit(self):
        unassigned = next(r for r in self.registry.all_records() if r.slug == "unassigned")
        result = self.service.stage_batch(
            files=[{"path": "a.txt", "data": b"x"}],
            workspace_id=unassigned.workspace_id, project_id="unassigned", slug="unassigned",
            session_id="sess-9", batch_id="batch-u",
        )
        self.assertTrue(result["ok"])
        self.assertTrue((self.uploads / "unassigned/sess-9/batch-u/manifest.json").is_file())

    def test_cancel_delete_and_retry(self):
        kwargs = self._batch_kwargs()
        self.service.stage_batch(files=[{"path": "a.txt", "data": b"x"}], **kwargs)
        batch_dir = self.uploads / "projects/blockwise/sess-1/batch-1"
        with self.assertRaises(SnapshotError):
            self.service.cancel(batch_dir)  # finalized → delete instead
        self.service.delete(batch_dir)
        self.assertEqual(self.service.status(batch_dir)["state"], "absent")
        self.service.retry(files=[{"path": "a.txt", "data": b"y"}], batch_dir=batch_dir, **kwargs)
        self.assertEqual(self.service.status(batch_dir)["state"], "finalized")

    def test_hermes_reference_shape_and_privacy(self):
        self.service.stage_batch(files=[{"path": "photos/a.png", "data": b"x"}], **self._batch_kwargs())
        reference = self.service.hermes_reference(
            self.uploads / "projects/blockwise/sess-1/batch-1", "photos"
        )
        self.assertEqual(reference, "@folder:.frank-attachments/projects/blockwise/sess-1/batch-1/photos")
        self.assertNotIn(str(self.uploads), reference)
        with self.assertRaises(SnapshotError):
            self.service.hermes_reference(
                self.uploads / "projects/blockwise/sess-1", "photos"
            )  # not finalized
        with self.assertRaises(PathRejected):
            self.service.hermes_reference(
                self.uploads / "projects/blockwise/sess-1/batch-1", "../escape"
            )

    def test_prune_removes_only_stale_temp_dirs_beneath_root(self):
        stale = self.uploads / "projects/blockwise/sess-1/.tmp-batch-x-123"
        stale.mkdir(parents=True)
        stale.touch()
        old = time.time() - 10_000
        os.utime(stale, (old, old))
        fresh = self.uploads / "projects/blockwise/sess-1/.tmp-batch-y-123"
        fresh.mkdir(parents=True)
        result = self.service.prune_unreferenced([], older_than_seconds=5_000)
        self.assertEqual(result["count"], 1)
        self.assertFalse(stale.exists())
        self.assertTrue(fresh.exists())

    def test_same_origin_guard(self):
        require_same_origin("https://frank.fail", "application/json", "application/json")
        with self.assertRaises(SnapshotError):
            require_same_origin(None, "application/json", "application/json")
        with self.assertRaises(SnapshotError):
            require_same_origin("http://evil.example", "application/json", "application/json")
        with self.assertRaises(SnapshotError):
            require_same_origin("https://frank.fail", "text/plain", "application/json")


if __name__ == "__main__":
    unittest.main()
