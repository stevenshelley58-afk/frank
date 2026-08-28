from pathlib import Path
import unittest

import server


ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "window"


class PublicFrankRouteTest(unittest.TestCase):
    def setUp(self):
        self.previous_web = server.WEB
        server.WEB = APP / "web"
        self.client = server.app.test_client()

    def tearDown(self):
        server.WEB = self.previous_web

    def test_canonical_page_and_neutral_public_assets_are_served(self):
        with self.client.get("/frank", query_string={"from": "root"}) as root:
            self.assertEqual(root.status_code, 308)
            self.assertEqual(root.headers["Location"], "/frank/?from=root")

        with self.client.get("/frank/") as page:
            self.assertEqual(page.status_code, 200)
            document = page.get_data(as_text=True)
        self.assertIn('href="/frank/style.css"', document)
        self.assertIn('src="/frank/app.js"', document)
        self.assertNotIn("/mini", document)

        for path, marker in {
            "/frank/style.css": "--sans",
            "/frank/app.js": "./stream.mjs",
            "/frank/stream.mjs": "parseSseBlock",
            "/frank/api.mjs": "createMiniApi",
        }.items():
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200, path)
                self.assertIn(marker, response.get_data(as_text=True), path)

    def test_old_entry_and_asset_links_redirect_to_canonical_paths(self):
        for path in ("/mini", "/mini/"):
            with self.client.get(path, query_string={"next": "saved"}) as response:
                self.assertEqual(response.status_code, 308, path)
                self.assertEqual(response.headers["Location"], "/frank/?next=saved")

        for old_path, new_path in {
            "/mini/mini.css": "/frank/style.css",
            "/mini/mini.js": "/frank/app.js",
            "/mini/mini_stream.mjs": "/frank/stream.mjs",
            "/mini/mini_api.mjs": "/frank/api.mjs",
            "/mini/index.html": "/frank/",
        }.items():
            with self.client.get(old_path, query_string={"v": "1"}) as response:
                self.assertEqual(response.status_code, 308, old_path)
                self.assertEqual(response.headers["Location"], f"{new_path}?v=1", old_path)

    def test_root_remains_protected_by_caddy_fallback(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        public = caddyfile.index("@frank_ui path /frank /frank/*")
        fallback = caddyfile.index("        handle {\n            import frank_private_response_headers", public)
        self.assertLess(public, caddyfile.index("basic_auth"))
        self.assertIn("basic_auth", caddyfile[fallback:])
        self.assertIn("@mini_legacy path /mini /mini/*", caddyfile)
        self.assertIn("redir @mini_legacy /frank/ 308", caddyfile)


if __name__ == "__main__":
    unittest.main()
