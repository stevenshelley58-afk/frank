"""Truthful-map receipt tests: provenance, approved roots, deletion."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from graph.projection_receipts import (
    ReceiptError,
    filter_approved_roots,
    projection_envelope,
    verify_deletion,
)


def _graph(**overrides):
    entry = {
        "schema": "schema://frank.graph/v1",
        "graph_id": "blockwise",
        "graph_revision": "rev-41",
        "generated_at": "2026-09-03T12:00:00Z",
        "sources": [
            {"path": "docs/PROJECT.md", "revision": "abc123"},
            {"path": "AGENTS.md", "revision": "def456"},
        ],
        "validation": {"status": "ok"},
    }
    entry.update(overrides)
    return entry


class EnvelopeTest(unittest.TestCase):
    def test_ready_envelope_carries_revisions_and_validation(self):
        now = datetime(2026, 9, 3, 13, 0, tzinfo=timezone.utc)
        envelope = projection_envelope(_graph(), now=now)
        self.assertEqual(envelope["state"], "ready")
        self.assertEqual(envelope["graph_revision"], "rev-41")
        self.assertEqual(envelope["source_revisions"]["docs/PROJECT.md"], "abc123")
        self.assertEqual(envelope["validation"]["status"], "ok")

    def test_old_projection_is_stale_not_faked(self):
        now = datetime(2026, 9, 20, tzinfo=timezone.utc)
        self.assertEqual(projection_envelope(_graph(), now=now)["state"], "stale")

    def test_failed_validation_is_error_state(self):
        now = datetime(2026, 9, 3, 13, 0, tzinfo=timezone.utc)
        graph = _graph(validation={"status": "failed", "detail": "quality check"})
        self.assertEqual(projection_envelope(graph, now=now)["state"], "error")

    def test_wrong_schema_and_missing_timestamps_rejected(self):
        with self.assertRaises(ReceiptError):
            projection_envelope(_graph(schema="schema://other/v9"))
        with self.assertRaises(ReceiptError):
            projection_envelope(_graph(generated_at=""))
        with self.assertRaises(ReceiptError):
            projection_envelope(_graph(generated_at="not-a-date"))


class ApprovedRootsTest(unittest.TestCase):
    def test_only_approved_roots_are_discoverable(self):
        candidates = [
            {"path": "/projects/blockwise/docs/PROJECT.md", "title": "Project"},
            {"path": "/projects/merrypaws/README.md", "title": "Paws"},
            {"path": "/etc/passwd", "title": "Escape"},
            {"path": "/home/hermes/.hermes/MEMORY.md", "title": "Private"},
            {"path": "", "title": "Empty"},
        ]
        accepted = filter_approved_roots(candidates, ["/projects/blockwise"])
        self.assertEqual([item["path"] for item in accepted], ["/projects/blockwise/docs/PROJECT.md"])

    def test_frank_attachments_mountpoint_is_excluded_from_scans(self):
        candidates = [
            {"path": "/projects/blockwise/.frank-attachments/sess-1/batch-1/a.png"},
            {"path": "/srv/frank/data/window/uploads/projects/blockwise/sess-1/batch-1/a.png"},
            {"path": "/projects/blockwise/AGENTS.md"},
        ]
        accepted = filter_approved_roots(candidates, ["/projects/blockwise", "/srv/frank/data/window/uploads"])
        self.assertEqual(
            [Path(item["path"]).name for item in accepted],
            ["AGENTS.md"],
        )


class DeletionTest(unittest.TestCase):
    def test_deleted_source_disappears_without_ghosts(self):
        before = _graph(
            nodes=[{"id": "n1", "label": "docs/PROJECT.md"}, {"id": "n2", "label": "AGENTS.md"}],
            edges=[{"id": "e1", "source": "n1", "target": "n2"}],
        )
        after = _graph(
            nodes=[{"id": "n2", "label": "AGENTS.md"}],
            edges=[],
        )
        result = verify_deletion(before, after, entity_key="docs/PROJECT.md")
        self.assertEqual(result["removed"], ["e1", "n1"])
        self.assertEqual(result["ghosts"], [])

    def test_ghosts_fail_loudly(self):
        before = _graph(nodes=[{"id": "n1", "label": "old-source"}], edges=[])
        after = _graph(nodes=[{"id": "n1", "label": "old-source", "ghost": True}], edges=[])
        with self.assertRaises(ReceiptError):
            verify_deletion(before, after, entity_key="old-source")

    def test_unrelated_nodes_survive_deletion_check(self):
        before = _graph(nodes=[{"id": "n1", "label": "docs/PROJECT.md"}, {"id": "keep", "label": "other"}], edges=[])
        after = _graph(nodes=[{"id": "keep", "label": "other"}], edges=[])
        result = verify_deletion(before, after, entity_key="docs/PROJECT.md")
        self.assertNotIn("keep", result["removed"])


if __name__ == "__main__":
    unittest.main()
