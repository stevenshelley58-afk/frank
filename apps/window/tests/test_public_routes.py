from pathlib import Path
import unittest

import server


ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "window"


def _caddy_site_block(caddyfile: str, host: str) -> str:
    """Return one site block, bounded by its own braces.

    A following-host sentinel is deliberately not used. Additive hostnames are
    inserted between existing blocks, which silently widened the slice and
    pulled unrelated directives into the assertions (notably the identity
    provider's ``forward_auth``, which must never appear on the public
    opt-out path).
    """
    lines = [line for line in caddyfile.splitlines() if not line.lstrip().startswith("#")]
    body = "\n".join(lines)
    start = body.index(f"{host} {{")
    opening = body.index("{", start)
    depth = 0
    for index in range(opening, len(body)):
        if body[index] == "{":
            depth += 1
        elif body[index] == "}":
            depth -= 1
            if depth == 0:
                return body[start : index + 1]
    raise AssertionError(f"unterminated Caddy site block: {host}")


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

    def test_public_mail_optout_is_strictly_allowlisted(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        route = _caddy_site_block(caddyfile, "mail.blockwise.sale")

        self.assertIn("method GET POST", route)
        self.assertIn("path /email/unsubscribe/* /email/dnc/*", route)
        self.assertIn("reverse_proxy frank-owner-marketing-ingress:80", route)
        self.assertRegex(route, r"handle @mautic_optout \{[\s\S]*?reverse_proxy", msg=route)
        self.assertRegex(route, r"handle \{\s+respond 404\s+\}", msg=route)
        for forbidden in ("/s/*", "/api/*", "/admin/*", "/webviews/*"):
            self.assertNotIn(forbidden, route.lower())
        self.assertNotIn("forward_auth", route)
        self.assertNotIn("/r/*", route)

    def test_caddy_uses_existing_private_mautic_ingress_network(self):
        compose = (APP / "docker-compose.yml").read_text(encoding="utf-8")
        caddy_start = compose.index("  frank-caddy:")
        caddy_end = compose.index("\n\nvolumes:", caddy_start)
        caddy = compose[caddy_start:caddy_end]
        self.assertIn("- owner-marketing-ingress", caddy)
        self.assertIn(
            "owner-marketing-ingress:\n    external: true\n    name: frank_owner_marketing_ingress",
            compose,
        )

    def test_root_remains_protected_by_the_owner_session_boundary(self):
        caddyfile = (APP / "Caddyfile").read_text(encoding="utf-8")
        frank_start = caddyfile.index("frank.fail {")
        frank_end = caddyfile.index("\nblockwise.sale {", frank_start)
        frank = caddyfile[frank_start:frank_end]

        # The gate is applied once, before every owner route, so a request with
        # no session is answered by the outpost redirect before it can reach the
        # application. This replaced per-route Basic Auth, so the historical
        # matcher is asserted absent rather than merely unused.
        self.assertIn("import owner_identity_session_gate", frank)
        gate = frank.index("import owner_identity_session_gate")
        # The AgentTrail board and map artifacts are Frank's own surfaces, so the
        # owner session must be checked before they are reached.
        for route in ("@agenttrail path", "@map_artifact path"):
            self.assertTrue(frank.index(route) > gate, f"{route} must sit behind the gate")
        # /mcpx is deliberately ahead of the gate: the MCP server validates its
        # own bearer token and answers 401 itself, and the sign-in round trip
        # cannot complete if this route is gated. Asserted here so a future edit
        # neither gates it silently nor assumes the gateway is what protects it.
        self.assertLess(frank.index("@claude_mcp path"), gate)
        self.assertNotIn('respond "Frank is running."', frank)

        # The public Mini surfaces stay reachable and stay before the gate.
        public = frank.index("@mini_ui path /mini-frank /mini-frank/* /frank /frank/* /mini /mini/*")
        self.assertLess(public, gate)
        self.assertIn("reverse_proxy frank-window:8080", frank[public:gate])
        self.assertNotIn("/srv/mini-frank-site", caddyfile)


if __name__ == "__main__":
    unittest.main()
