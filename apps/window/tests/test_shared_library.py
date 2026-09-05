"""Deterministic proof for the central file-backed shared library."""
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared_library import (  # noqa: E402
    CentralLibrary,
    SharedLibraryError,
    validate_record,
)


def record(record_id="knowledge:frank/test", version=1, **overrides):
    value = {
        "schema": "schema://frank.shared-library-record/v1",
        "id": record_id,
        "version": version,
        "kind": "knowledge",
        "title": "Quote follow-up guidance",
        "summary": "Public guidance for following up quotes.",
        "tags": ["industry-knowledge", "quotes"],
        "industry": "services",
        "source": {"kind": "public_url", "reference": "https://example.com/guide", "revision": "2026-09-01", "sha256": "a" * 64},
        "status": "candidate",
        "sensitivity": "public",
        "verified_at": "",
        "expires_at": (date.today() + timedelta(days=30)).isoformat(),
        "reference": "",
        "license_spdx": "",
        "test_refs": [],
    }
    value.update(overrides)
    return value


class LibraryTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="shared-library-test-"))
        self.seed = self.tmp / "seed.json"
        self.seed.write_text(json.dumps({"schema": "schema://frank.shared-library-catalog/v1", "version": 1, "records": []}))
        self.root = self.tmp / "library"
        self.library = CentralLibrary(seed=self.seed, root=self.root, create=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def contribute(self, project="project-a", value=None):
        return self.library.contribute(project, value or record())


class IsolationTest(LibraryTestBase):
    def test_project_a_candidate_is_invisible_to_project_b(self):
        receipt = self.contribute()
        approved = self.library.search("project-b", "quote")
        self.assertEqual(approved, [])
        candidates = list((self.root / "candidates" / "project-b").glob("*.json")) if (self.root / "candidates" / "project-b").exists() else []
        self.assertEqual(candidates, [])
        origin = self.root / "candidates" / "project-a" / f"{receipt['candidate_id']}.json"
        self.assertTrue(origin.exists())

    def test_admission_makes_record_readable_by_both_projects(self):
        receipt = self.contribute()
        admitted = self.library.admit("project-a", receipt["candidate_id"], receipt["candidate_digest"], "agent:qa-validator")
        self.assertEqual(admitted["status"], "approved")
        for project in ("project-a", "project-b"):
            found = self.library.search(project, "quote")
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0]["id"], "knowledge:frank/test")

    def test_later_version_supersedes_earlier(self):
        first = self.contribute(value=record(version=1, summary="Original guidance."))
        self.library.admit("project-a", first["candidate_id"], first["candidate_digest"], "agent:qa-validator")
        second = self.contribute(value=record(version=2, summary="Improved guidance."))
        self.library.admit("project-a", second["candidate_id"], second["candidate_digest"], "agent:qa-validator")
        for project in ("project-a", "project-b"):
            found = self.library.search(project, "quote")
            self.assertEqual(len(found), 1)
            self.assertEqual(found[0]["version"], 2)
            self.assertEqual(found[0]["summary"], "Improved guidance.")


class FailureTest(LibraryTestBase):
    def test_tampered_digest_fails_admission(self):
        receipt = self.contribute()
        with self.assertRaises(SharedLibraryError):
            self.library.admit("project-a", receipt["candidate_id"], "sha256:" + "0" * 64, "agent:qa-validator")

    def test_expired_candidate_fails_admission_and_retrieval(self):
        receipt = self.contribute(value=record(expires_at=(date.today() - timedelta(days=1)).isoformat()))
        with self.assertRaises(SharedLibraryError):
            self.library.admit("project-a", receipt["candidate_id"], receipt["candidate_digest"], "agent:qa-validator")
        expired_approved = dict(
            record(status="approved", expires_at=(date.today() - timedelta(days=1)).isoformat()),
            verified_at=date.today().isoformat(),
            admission={"mode": "reviewed_public_evidence", "reviewed_by": "agent:qa-validator",
                       "candidate_digest": "sha256:" + "b" * 64, "admitted_at": date.today().isoformat()},
        )
        self.root.joinpath("approved").mkdir(parents=True, exist_ok=True)
        target = self.root / "approved" / "expired.v1.json"
        target.write_text(json.dumps(expired_approved))
        self.assertEqual(self.library.search("project-b", "quote"), [])

    def test_invalid_and_corrupt_records_fail_safely(self):
        self.root.joinpath("approved").mkdir(parents=True, exist_ok=True)
        (self.root / "approved" / "broken.v1.json").write_text("{not json")
        self.assertEqual(self.library.health()["status"], "unavailable")
        (self.root / "approved" / "broken.v1.json").unlink()
        with self.assertRaises(SharedLibraryError):
            self.library.contribute("project-a", record(record_id="bogus-id"))
        with self.assertRaises(SharedLibraryError):
            self.library.contribute("project-a", record(kind="code", license_spdx="", test_refs=[]))

    def test_symlink_paths_and_private_provenance_fail_safely(self):
        outside = self.tmp / "outside"
        outside.mkdir()
        self.root.joinpath("approved").mkdir(parents=True, exist_ok=True)
        os.symlink(outside, self.root / "approved" / "link.v1.json")
        self.assertEqual(self.library.health()["status"], "unavailable")
        (self.root / "approved" / "link.v1.json").unlink()
        for reference in (
            "http://example.com/insecure",
            "https://localhost/guide",
            "https://127.0.0.1/guide",
            "https://10.0.0.1/guide",
            "https://user:pass@example.com/guide",
        ):
            with self.assertRaises(SharedLibraryError):
                self.library.contribute("project-a", record(source={"kind": "public_url", "reference": reference, "revision": "r1", "sha256": "a" * 64}))


class AtomicityTest(LibraryTestBase):
    def test_concurrent_writes_never_publish_partials(self):
        receipts = []
        errors = []

        def worker(index):
            try:
                receipts.append(self.contribute(value=record(record_id=f"knowledge:frank/test-{index}")))
            except SharedLibraryError as error:
                errors.append(error)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        for path in (self.root / "candidates" / "project-a").glob("*.json"):
            self.assertIsInstance(json.loads(path.read_text()), dict)
        self.assertEqual([p.name for p in (self.root / "candidates" / "project-a").glob(".tmp-*")], [])

    def test_identical_recontribution_is_idempotent(self):
        first = self.contribute()
        second = self.contribute()
        self.assertEqual(first, second)

    def test_private_and_customer_material_never_enters_the_queue(self):
        private = record(summary="Customer X doubled conversions using our private playbook.")
        private["sensitivity"] = "private_customer"
        with self.assertRaises(SharedLibraryError):
            self.library.contribute("project-a", private)


class MiniHandoffTest(unittest.TestCase):
    def test_mini_handoff_queues_only_public_candidates_into_isolated_root(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from mini.knowledge import knowledge_binding, queue_public_candidates, shared_library_status

        tmp = Path(tempfile.mkdtemp(prefix="shared-library-mini-"))
        try:
            seed = tmp / "seed.json"
            seed.write_text(json.dumps({"schema": "schema://frank.shared-library-catalog/v1", "version": 1, "records": []}))
            root = tmp / "library"
            status = shared_library_status.__wrapped__ if hasattr(shared_library_status, "__wrapped__") else None
            import mini.knowledge as knowledge

            knowledge._STATUS_CACHE.update(at=0.0, value=None)
            public = {
                "industry": "services",
                "candidates": [
                    {"fact": "Sending a follow-up within two days raises reply rates on public quote boards.", "source_kind": "public_source", "source_reference": "https://example.com/quote-followup", "confidence": "medium", "sensitivity": "public_general", "valid_until": ""},
                    {"fact": "Customer Acme pays net-30 and prefers email.", "source_kind": "customer_derived", "source_reference": "", "confidence": "high", "sensitivity": "private_customer", "valid_until": ""},
                    {"fact": "Probably most industries behave similarly.", "source_kind": "inference", "source_reference": "", "confidence": "low", "sensitivity": "uncertain", "valid_until": ""},
                ],
            }
            result = queue_public_candidates(public, root)
            self.assertEqual(result, {"status": "queued", "queued_count": 1})
            library_root = root / "knowledge/shared-library"
            queued = list((library_root / "candidates" / "mini-frank").glob("*.json"))
            self.assertEqual(len(queued), 1)
            body = json.loads(queued[0].read_text())
            self.assertNotIn("Acme", json.dumps(body))
            self.assertEqual(queue_public_candidates({"industry": "x", "candidates": []}, root), {"status": "nothing_public", "queued_count": 0})
            binding = knowledge_binding("account-1", "job-1")
            self.assertEqual(binding["shared_industry"]["status"], "unavailable")
            self.assertEqual(binding["reference_context"]["provider"], "service:frank-central-library")
            self.assertEqual(binding["candidate_contribution"]["mode"], "public_candidates_queue_central_library")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            import mini.knowledge as knowledge

            knowledge._STATUS_CACHE.update(at=0.0, value=None)


if __name__ == "__main__":
    unittest.main()
