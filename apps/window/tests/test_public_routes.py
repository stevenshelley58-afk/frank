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

    def test_canonical_mini_page_and_public_assets_are_served_from_frank(self):
        with self.client.get("/mini-frank", query_string={"from": "root"}) as root:
            self.assertEqual(root.status_code, 308)
            self.assertEqual(root.headers["Location"], "/mini-frank/?from=root")

        with self.client.get("/mini-frank/") as page:
            self.assertEqual(page.status_code, 200)
            document = page.get_data(as_text=True)
        self.assertIn("Mini Frank", document)
        self.assertIn('href="/mini-frank/mini.css"', document)
        self.assertIn('src="/mini-frank/mini.js"', document)

        for path, marker in {
            "/mini-frank/mini.css": "--sans",
            "/mini-frank/mini.js": "./mini_stream.mjs",
            "/mini-frank/mini_stream.mjs": "parseSseBlock",
            "/mini-frank/mini_api.mjs": "createMiniApi",
            "/mini-frank/style.css": "--sans",
            "/mini-frank/app.js": "./mini_stream.mjs",
            "/mini-frank/stream.mjs": "parseSseBlock",
            "/mini-frank/api.mjs": "createMiniApi",
            "/mini-frank/site-preview.html": 'id="site-name"',
            "/mini-frank/site-preview.css": ".site-hero",
            "/mini-frank/site-preview.js": "URLSearchParams",
        }.items():
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200, path)
                self.assertIn(marker, response.get_data(as_text=True), path)

        with self.client.get("/mini-frank/assets/demo-business-hero.png") as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, "image/png")

        with self.client.get("/mini-frank/not-a-public-page.html") as response:
            self.assertEqual(response.status_code, 404)

    def test_old_entry_and_asset_links_redirect_to_canonical_paths(self):
        for path in ("/frank", "/frank/", "/mini", "/mini/"):
            with self.client.get(path, query_string={"next": "saved"}) as response:
                self.assertEqual(response.status_code, 308, path)
                self.assertEqual(response.headers["Location"], "/mini-frank/?next=saved")

        for old_path, new_path in {
            "/frank/style.css": "/mini-frank/style.css",
            "/frank/app.js": "/mini-frank/app.js",
            "/frank/assets/demo-business-hero.png": "/mini-frank/assets/demo-business-hero.png",
            "/mini/mini.css": "/mini-frank/mini.css",
            "/mini/mini.js": "/mini-frank/mini.js",
            "/mini/mini_stream.mjs": "/mini-frank/mini_stream.mjs",
            "/mini/mini_api.mjs": "/mini-frank/mini_api.mjs",
            "/mini/site-preview.html": "/mini-frank/site-preview.html",
            "/mini/assets/demo-business-hero.png": "/mini-frank/assets/demo-business-hero.png",
            "/mini/index.html": "/mini-frank/",
        }.items():
            with self.client.get(old_path, query_string={"v": "1"}) as response:
                self.assertEqual(response.status_code, 308, old_path)
                self.assertEqual(response.headers["Location"], f"{new_path}?v=1", old_path)

        with self.client.get("/mini-frank/index.html", query_string={"v": "2"}) as response:
            self.assertEqual(response.status_code, 308)
            self.assertEqual(response.headers["Location"], "/mini-frank/?v=2")

    def test_legacy_redirects_reject_dot_segment_paths(self):
        for path in ("/frank/%2e%2e/server.py", "/mini/%2e%2e/server.py"):
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 404, path)

    def test_root_remains_protected_by_caddy_fallback(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        public = caddyfile.index("@mini_ui path /mini-frank /mini-frank/* /frank /frank/* /mini /mini/*")
        fallback = caddyfile.index("        handle {\n            import frank_private_response_headers", public)
        self.assertLess(public, caddyfile.index("basic_auth"))
        self.assertIn("basic_auth", caddyfile[fallback:])
        public_route = caddyfile[public:fallback]
        self.assertIn("reverse_proxy frank-window:8080", public_route)
        self.assertNotIn("/srv/mini-frank-site", caddyfile)


if __name__ == "__main__":
    unittest.main()
