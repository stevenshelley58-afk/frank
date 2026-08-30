import unittest

from graph.discovery import DiscoveryError, deduplicate_candidates, normalize_candidate, validate_source_url
from graph.import_preview import preview_import


def candidate(name="owner/tool", url="https://github.com/owner/tool"):
    return {"name": name, "html_url": url, "source_revision": "a" * 40, "license": {"spdx_id": "MIT"}, "pushed_at": "2026-08-30T00:00:00Z", "fit": "useful"}


class DiscoveryTests(unittest.TestCase):
    def test_allowlist_and_credentials_rejected(self):
        self.assertEqual(validate_source_url("https://github.com/owner/tool/"), "https://github.com/owner/tool")
        with self.assertRaises(DiscoveryError): validate_source_url("https://evil.example/tool")
        with self.assertRaises(DiscoveryError): validate_source_url("https://user:pass@github.com/owner/tool")

    def test_normalize_separates_state_axes_and_dedupes(self):
        rows = deduplicate_candidates([normalize_candidate(candidate()), normalize_candidate(candidate(url="https://github.com/owner/tool/"))])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["state_axes"]["installation"], "not_installed")
        self.assertEqual(rows[0]["state_axes"]["production_authority"], "none")

    def test_preview_is_no_write_and_has_immutable_provenance(self):
        result = preview_import(existing=[], incoming=[candidate()], source_revision="rev_" + "a" * 40, query_hash="sha256:" + "b" * 64)
        self.assertFalse(result["preview"]["applies"])
        self.assertEqual(len(result["preview"]["diff"]["added"]), 1)
        self.assertEqual(result["preview"]["state_effect"]["enablement"], "unchanged")
        self.assertTrue(result["receipt"]["payload_hash"].startswith("sha256:"))


if __name__ == "__main__": unittest.main()
