"""Workspace resolver tests: migration, privacy, and fail-closed paths."""
import json
import os
import tempfile
import unittest
from pathlib import Path

from infra.workspace.resolver import (
    PathRejected,
    ResolverError,
    WorkspaceRegistry,
    WorkspaceUnknown,
)
from infra.workspace.schemas import WORKSPACE_RESOLVER_SCHEMA


def _uuid_seq(prefix="ws-"):
    counter = {"n": 0}

    def factory():
        counter["n"] += 1
        return f"{prefix}{counter['n']:04d}"

    return factory


class ResolverMigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.registry_path = Path(self.temp.name) / "workspaces.json"

    def tearDown(self):
        self.temp.cleanup()

    def _candidate(self, **overrides):
        entry = {
            "project_id": "blockwise",
            "slug": "blockwise",
            "host_path": "/projects/blockwise-product-release-21a192cd2420",
            "hermes_path": "/projects/blockwise",
            "container_path": "/vps/projects/blockwise",
            "legacy_memory_scope": "steven-blockwise",
            "root_kind": "live-reference",
        }
        entry.update(overrides)
        return entry

    def test_migration_mints_opaque_ids_and_preserves_memory_scope(self):
        registry = WorkspaceRegistry(self.registry_path, uuid_factory=_uuid_seq())
        result = registry.migrate_registry([self._candidate()])
        self.assertEqual(result, {"migrated": 2, "quarantined": 0})  # blockwise + unassigned
        record = registry.get("ws-0001")
        self.assertIsNotNone(record)
        self.assertEqual(record.memory_scope, "steven-blockwise")
        self.assertEqual(record.board_slug_private, None)
        self.assertNotEqual(record.board_binding_id, "")
        # Unassigned workspace gets the exact fallback scope and staging root kind.
        unassigned = next(r for r in registry.all_records() if r.slug == "unassigned")
        self.assertEqual(unassigned.memory_scope, "steven-unassigned")
        self.assertEqual(unassigned.root_kind, "upload-staging")

    def test_quarantines_relative_and_noncanonical_roots(self):
        registry = WorkspaceRegistry(self.registry_path, uuid_factory=_uuid_seq())
        result = registry.migrate_registry(
            [
                self._candidate(slug="business-os", host_path="business-os"),
                self._candidate(slug="stale", host_path="/srv/projects/stale"),
                self._candidate(slug="ok"),
            ]
        )
        self.assertEqual(result["quarantined"], 2)
        quarantined = [r for r in registry.all_records() if r.status == "quarantined"]
        self.assertEqual(len(quarantined), 2)
        self.assertTrue(all(r.quarantine_reason for r in quarantined))
        with self.assertRaises(WorkspaceUnknown):
            registry.get_active(quarantined[0].workspace_id)

    def test_duplicate_slug_preserves_existing_mapping(self):
        registry = WorkspaceRegistry(self.registry_path, uuid_factory=_uuid_seq())
        registry.migrate_registry([self._candidate()])
        result = registry.migrate_registry([self._candidate()])
        self.assertEqual(result["quarantined"], 1)
        record = next(r for r in registry.all_records() if r.slug == "blockwise" and r.status == "active")
        self.assertEqual(record.workspace_id, "ws-0001")

    def test_missing_memory_scope_is_quarantined(self):
        registry = WorkspaceRegistry(self.registry_path, uuid_factory=_uuid_seq())
        result = registry.migrate_registry([self._candidate(legacy_memory_scope="")])
        self.assertEqual(result["quarantined"], 1)

    def test_new_project_registration_creates_immutable_scope(self):
        registry = WorkspaceRegistry(self.registry_path, uuid_factory=_uuid_seq())
        registry.migrate_registry([self._candidate()])
        registry.migrate_registry(
            [self._candidate(project_id="disposable", slug="disposable", host_path="/projects/disposable",
                             legacy_memory_scope="steven-disposable")]
        )
        record = next(r for r in registry.all_records() if r.slug == "disposable")
        self.assertEqual(record.memory_scope, "steven-disposable")
        again = registry.migrate_registry(
            [self._candidate(project_id="disposable", slug="disposable", host_path="/projects/disposable",
                             legacy_memory_scope="steven-disposable")]
        )
        self.assertEqual(again["quarantined"], 1)  # duplicate; scope never re-derived

    def test_corrupt_registry_fails_closed(self):
        self.registry_path.write_text("{not json", encoding="utf-8")
        registry = WorkspaceRegistry(self.registry_path)
        with self.assertRaises(ResolverError):
            registry.all_records()


class ResolverPathTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "root"
        (self.root / "docs").mkdir(parents=True)
        (self.root / "docs" / "readme.md").write_text("hello", encoding="utf-8")
        self.registry_path = Path(self.temp.name) / "workspaces.json"
        self.registry = WorkspaceRegistry(
            self.registry_path,
            uuid_factory=_uuid_seq("r-"),
            canonical_prefixes=(str(self.root.parent) + "/",),
        )
        self.registry.migrate_registry(
            [{
                "project_id": "p", "slug": "p", "host_path": str(self.root),
                "hermes_path": "/projects/p", "container_path": "/vps/projects/p",
                "legacy_memory_scope": "steven-p",
            }]
        )
        self.workspace_id = next(
            r.workspace_id for r in self.registry.all_records() if r.slug == "p"
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_resolve_returns_display_and_private_path(self):
        resolved = self.registry.resolve_rel(self.workspace_id, "docs/readme.md")
        self.assertEqual(resolved.display_path, "docs/readme.md")
        self.assertTrue(resolved.private_path.startswith(str(self.root)))
        self.assertEqual(resolved.workspace_id, self.workspace_id)

    def test_rejects_absolute_traversal_and_hidden(self):
        for bad in ["/etc/passwd", "../escape", "docs/../../x", "./x", ".hidden/file",
                    "docs//x", "docs/", "a/b/c/../../../../../etc", "docs/./x"]:
            with self.assertRaises(PathRejected, msg=bad):
                self.registry.resolve_rel(self.workspace_id, bad)

    def test_rejects_nul_control_and_windows_devices(self):
        for bad in ["a\x00b", "a\nb", "CON", "docs/NUL.txt", "com1/other", "x. ", "dot."]:
            with self.assertRaises(PathRejected, msg=repr(bad)):
                self.registry.resolve_rel(self.workspace_id, bad)

    def test_rejects_non_nfc_unicode(self):
        decomposed = "cafe\u0301"
        with self.assertRaises(PathRejected):
            self.registry.resolve_rel(self.workspace_id, f"docs/{decomposed}.md")

    def test_symlink_components_are_rejected(self):
        os.symlink(self.root / "docs", self.root / "link")
        with self.assertRaises(PathRejected):
            self.registry.resolve_rel(self.workspace_id, "link/readme.md")
        os.symlink("/etc/passwd", self.root / "docs" / "evil.md")
        with self.assertRaises(PathRejected):
            self.registry.resolve_rel(self.workspace_id, "docs/evil.md")

    def test_special_files_are_rejected_from_stat(self):
        os.mkfifo(self.root / "pipe")
        with self.assertRaises(PathRejected):
            self.registry.safe_stat(self.root, "pipe")

    def test_safe_read_file_reads_regular_files_only(self):
        content = self.registry.safe_read_file(self.root, "docs/readme.md")
        self.assertEqual(content, b"hello")
        with self.assertRaises(PathRejected):
            self.registry.safe_read_file(self.root, "docs/missing.md")
        os.symlink("/etc/hostname", self.root / "docs" / "link.md")
        with self.assertRaises(PathRejected):
            self.registry.safe_read_file(self.root, "docs/link.md")

    def test_safe_read_file_enforces_limit(self):
        big = self.root / "docs" / "big.bin"
        big.write_bytes(b"x" * 64)
        with self.assertRaises(PathRejected):
            self.registry.safe_read_file(self.root, "docs/big.bin", max_bytes=32)

    def test_browser_public_shape_carries_no_private_mapping(self):
        public = self.registry.public_list()
        for item in public:
            data = item.to_dict()
            self.assertEqual(set(data), {"workspace_id", "project_id", "root_kind", "status"})
            for value in data.values():
                self.assertNotIn("/projects/", str(value))
                self.assertNotIn("steven-", str(value))

    def test_registry_round_trip_keeps_schema(self):
        raw = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(raw["schema"], WORKSPACE_RESOLVER_SCHEMA)
        self.assertEqual(raw["version"], 1)


if __name__ == "__main__":
    unittest.main()
