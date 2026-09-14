"""The owner Ads reader contract, server half.

The workspace is a reader, and it decides what to render from the *status* a
reader answers with. Two things therefore have to be true, and both are asserted
here rather than trusted:

1. The reader vocabulary and the requirement sentences are the same on both
   sides of the wire. A reader the browser knows and the server does not becomes
   a page of HTML the browser has to guess about, which is exactly the state this
   contract exists to remove.
2. A reader that is not implemented yet answers 501 with the typed envelope, not
   the single-page application's ``index.html``. "Not connected, and here is what
   is missing" is an answer the owner can act on; a 200 page is not.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

import owner_ads

WINDOW_ROOT = Path(__file__).resolve().parents[1]
SOURCE_JS = WINDOW_ROOT / "web" / "js" / "ads" / "ads-source.js"


def _js_reader_paths() -> list[str]:
    source = SOURCE_JS.read_text(encoding="utf-8")
    match = re.search(r"export const READER_PATHS = Object\.freeze\(\{(.*?)\}\)", source, re.S)
    if not match:
        raise AssertionError("READER_PATHS is no longer declared as a frozen object in ads-source.js")
    return re.findall(r"^\s*([a-z_]+):", match.group(1), re.M)


def _js_reader_requirements() -> dict[str, str]:
    source = SOURCE_JS.read_text(encoding="utf-8")
    match = re.search(r"export const READER_REQUIREMENTS = Object\.freeze\(\{(.*?)\}\)", source, re.S)
    if not match:
        raise AssertionError("READER_REQUIREMENTS is no longer declared as a frozen object in ads-source.js")
    return dict(re.findall(r'^\s*([a-z_]+):\s*"([^"]+)"', match.group(1), re.M))


class ReaderVocabulary(unittest.TestCase):
    def test_python_and_browser_reader_lists_are_identical(self):
        self.assertEqual(list(owner_ads.READERS), _js_reader_paths())

    def test_every_reader_names_what_it_needs(self):
        self.assertEqual(set(owner_ads.READER_REQUIREMENTS), set(owner_ads.READERS))
        for reader in owner_ads.READERS:
            self.assertTrue(owner_ads.READER_REQUIREMENTS[reader].strip(), reader)

    def test_the_requirement_sentences_match_the_browser_word_for_word(self):
        # The workspace shows these sentences. Two slightly different versions of
        # the same sentence is how a screen ends up describing a different
        # requirement from the one the server is actually missing.
        self.assertEqual(owner_ads.READER_REQUIREMENTS, _js_reader_requirements())


class UnimplementedReader(unittest.TestCase):
    def setUp(self):
        from flask import Flask

        app = Flask(__name__)
        app.register_blueprint(owner_ads.create_blueprint())
        app.config.update(TESTING=True)
        self.client = app.test_client()

    def test_every_reader_answers_not_connected_with_its_requirement(self):
        for reader in owner_ads.READERS:
            response = self.client.get(f"/api/owner/ads/{reader}")
            self.assertEqual(response.status_code, owner_ads.NOT_IMPLEMENTED, reader)
            payload = response.get_json()
            self.assertEqual(payload["status"], "not_connected", reader)
            self.assertEqual(payload["detail"], owner_ads.READER_REQUIREMENTS[reader], reader)
            self.assertIsNone(payload["data"], "a reader with no rows must not carry a value")
            self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    def test_an_unknown_reader_is_refused_rather_than_answered(self):
        response = self.client.get("/api/owner/ads/everything")
        self.assertEqual(response.status_code, 404)
        self.assertIn("unknown ads reader", response.get_json()["detail"])

    def test_the_reader_route_does_not_shadow_the_spa(self):
        # The reader blueprint owns one prefix and nothing else: a route that
        # swallowed `/project/...` would break the shell that hosts the workspace.
        # Flask's own static route is the one exception and is not ours.
        rules = {rule.rule for rule in self.client.application.url_map.iter_rules() if not rule.rule.startswith("/static/")}
        self.assertEqual(rules, {"/api/owner/ads/<reader>"})


if __name__ == "__main__":
    unittest.main()
