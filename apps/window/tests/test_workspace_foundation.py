"""Tests for the workspace foundation module (contract §4/§5)."""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workspace_foundation import (
    ExecutionLease,
    LeaseUnavailable,
    WorkspaceRegistry,
    legacy_memory_scope,
    mint_workspace_id,
)


class RegistryTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        os.unlink(self.path)
        self.reg = WorkspaceRegistry(self.path)

    def test_migration_preserves_memory_scope_and_is_idempotent(self):
        rec = self.reg.migrate_project(
            "blockwise", "blockwise",
            host_path="/projects/blockwise-product-release-21a192cd2420",
            container_path="/vps/projects/blockwise",
            hermes_path="/vps/projects/blockwise",
        )
        self.assertEqual(rec["memory_scope"], "steven-blockwise")
        first_ws = rec["workspace_id"]
        again = self.reg.migrate_project(
            "blockwise", "blockwise",
            host_path="/projects/blockwise-product-release-21a192cd2420",
            container_path="/vps/projects/blockwise",
            hermes_path="/vps/projects/blockwise",
        )
        self.assertEqual(again["workspace_id"], first_ws)
        self.assertEqual(again["memory_scope"], "steven-blockwise")
        self.assertFalse(again["created"])

    def test_host_container_name_divergence_is_data(self):
        self.reg.migrate_project(
            "blockwise", "blockwise",
            host_path="/projects/blockwise-product-release-21a192cd2420",
            container_path="/vps/projects/blockwise",
            hermes_path="/vps/projects/blockwise",
        )
        ws = self.reg.workspace_id_for("blockwise")
        res = self.reg.resolve_private(ws)
        self.assertEqual(res["paths"]["host"], "/projects/blockwise-product-release-21a192cd2420")
        self.assertEqual(res["paths"]["container"], "/vps/projects/blockwise")

    def test_unassigned_scope_rule(self):
        self.assertEqual(legacy_memory_scope(""), "steven-unassigned")
        self.assertEqual(legacy_memory_scope("unassigned"), "steven-unassigned")

    def test_browser_projection_is_opaque(self):
        self.reg.migrate_project(
            "frank", "frank",
            host_path="/projects/frank", container_path="/vps/projects/frank",
            hermes_path="/vps/projects/frank", native_board_slug="board-xyz",
        )
        proj = self.reg.browser_projection("frank")
        blob = json.dumps(proj)
        self.assertNotIn("/projects/frank", blob)
        self.assertNotIn("steven-frank", blob)
        self.assertNotIn("board-xyz", blob)
        self.assertIn("workspace_id", blob)
        self.assertIn("board_binding_id", blob)

    def test_board_slug_private_and_settable(self):
        self.reg.migrate_project(
            "frank", "frank", host_path="/projects/frank",
            container_path="/vps/projects/frank", hermes_path="/vps/projects/frank",
        )
        ws = self.reg.workspace_id_for("frank")
        self.assertIsNone(self.reg.resolve_private(ws)["native_board_slug"])
        self.reg.set_native_board_slug("frank", "native-slug-1")
        self.assertEqual(self.reg.resolve_private(ws)["native_board_slug"], "native-slug-1")


class LeaseTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        self.lease = ExecutionLease(self.path, verifier=lambda pid: False)

    def test_exclusive_acquire_and_refuse(self):
        a = self.lease.acquire("ws1", "hub", os.getpid())
        self.assertTrue(a["granted"])
        b = self.lease.acquire("ws1", "codex", os.getpid())
        self.assertFalse(b["granted"])
        self.assertEqual(b["reason"], "held")

    def test_release_then_reacquire(self):
        self.lease.acquire("ws1", "hub", os.getpid())
        self.assertTrue(self.lease.release("ws1", "hub"))
        self.assertTrue(self.lease.acquire("ws1", "codex", os.getpid())["granted"])

    def test_fail_closed_when_store_unavailable(self):
        self.lease._path = Path("/proc/nonexistent/lease.json")
        with self.assertRaises(LeaseUnavailable):
            self.lease.acquire("ws1", "hub", os.getpid())

    def test_stale_reclaim_requires_verifier(self):
        self.lease = ExecutionLease(self.path, verifier=lambda pid: True)
        self.lease.acquire("ws1", "ghost", 999999, ttl_seconds=1)
        time.sleep(1.1)
        # Verifier says alive: not reclaimed even past TTL.
        self.assertFalse(self.lease.acquire("ws1", "hub", os.getpid())["granted"])
        # Verifier says dead: reclaimed after TTL.
        self.lease = ExecutionLease(self.path, verifier=lambda pid: False)
        self.assertTrue(self.lease.acquire("ws1", "hub", os.getpid())["granted"])

    def test_heartbeat_extends_ttl(self):
        self.lease = ExecutionLease(self.path, verifier=lambda pid: True)
        self.lease.acquire("ws1", "hub", os.getpid(), ttl_seconds=1)
        self.assertTrue(self.lease.heartbeat("ws1", "hub", ttl_seconds=300))
        self.assertIsNotNone(self.lease.holder("ws1"))

    def test_wrong_owner_cannot_heartbeat_or_release(self):
        self.lease.acquire("ws1", "hub", os.getpid())
        self.assertFalse(self.lease.heartbeat("ws1", "codex"))
        self.assertFalse(self.lease.release("ws1", "codex"))

    def test_generation_increments_on_reclaim(self):
        self.lease.acquire("ws1", "a", os.getpid(), ttl_seconds=1)
        time.sleep(1.1)
        rec = self.lease.acquire("ws1", "b", os.getpid())
        self.assertTrue(rec["granted"])
        self.assertEqual(rec["generation"], 2)


if __name__ == "__main__":
    unittest.main()
