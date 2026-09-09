import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "host" / "frank_serve_bridge.py"
SPEC = importlib.util.spec_from_file_location("frank_serve_bridge", MODULE_PATH)
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(bridge)


class FrankServeBridgeTest(unittest.TestCase):
    def test_ad_db_is_the_only_new_private_serve_surface(self):
        self.assertTrue(bridge._allowed("/v1/ad-db/ads", "GET"))
        self.assertTrue(bridge._allowed("/v1/ad-db/ads/abc/media/def", "HEAD"))
        self.assertTrue(bridge._allowed("/v1/ad-db/runs/scan", "POST"))
        self.assertFalse(bridge._allowed("/v1/ad-db/runs/scan", "DELETE"))
        self.assertFalse(bridge._allowed("/v1/other", "GET"))

    def test_customer_token_is_scoped_to_ad_reads_only(self):
        token = {"X-Hermes-Ad-Db-Read-Token": "customer"}
        self.assertEqual(bridge._auth_headers("/v1/ad-db/ads", "GET", token), token)
        self.assertEqual(
            bridge._auth_headers("/v1/ad-db/ads/ad-1/media/asset-1", "HEAD", token),
            token,
        )
        self.assertEqual(bridge._auth_headers("/v1/ad-db/prospects", "GET", token), {})
        self.assertEqual(bridge._auth_headers("/v1/ad-db/runs", "GET", token), {})
        self.assertEqual(bridge._auth_headers("/v1/ad-db/ads", "POST", token), {})

    def test_operator_session_token_retains_the_existing_private_surface(self):
        token = {"X-Hermes-Session-Token": "operator"}
        self.assertEqual(bridge._auth_headers("/api/sessions", "POST", token), token)
        self.assertEqual(bridge._auth_headers("/v1/ad-db/runs/scan", "POST", token), token)

    def test_archive_range_contract_is_forwarded_without_redirects(self):
        self.assertEqual(
            bridge.REQUEST_PASSTHROUGH_HEADERS,
            ("Range", "If-Range", "If-None-Match"),
        )
        self.assertIn("Content-Range", bridge.RESPONSE_PASSTHROUGH_HEADERS)
        self.assertIn("Accept-Ranges", bridge.RESPONSE_PASSTHROUGH_HEADERS)
        self.assertIs(bridge.Handler.do_HEAD, bridge.Handler._proxy)


if __name__ == "__main__":
    unittest.main()
