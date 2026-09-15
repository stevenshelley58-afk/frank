"""Which document answers a Window page request.

The owner shell and the vanilla Window now share one origin, so the property
under test is that the split is exact: the owner routes, and only those, get the
React index, every other route keeps the vanilla Window, a real file is still
served as itself, and a checkout with no built bundle degrades to the vanilla
Window instead of failing.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import owner_shell


OWNER_PATHS = [
    "",
    "/",
    "project/blockwise",
    "/project/blockwise",
    "/project/blockwise/",
    "project/blockwise/mail",
    "project/blockwise/crm",
    "project/blockwise/support",
    "project/blockwise/campaigns",
    "project/blockwise/ads",
    "project/blockwise/revenue",
    "project/blockwise/results",
    "project/blockwise/notifications",
    "/project/blockwise/notifications/",
    "project/blockwise/customer/abc",
    "project/blockwise/customer/a",
    "project/blockwise/customer/" + "a" * 128,
    "project/blockwise/customer/A0._~-",
]

VANILLA_PATHS = [
    "project/blockwise/unknown",
    "project/blockwise/Crm",
    "project/other",
    "project/other/crm",
    "project",
    "project/blockwise/customer",
    "project/blockwise/customer/",
    "project/blockwise/customer/a/b",
    "project/blockwise/customer/-nope",
    "project/blockwise/customer/." ,
    "project/blockwise/customer/" + "a" * 129,
    "project/blockwise/customer/a%2Fb",
    "project%2Fblockwise",
    "project/blockwise/crm/extra",
    "entity/tool/mail",
    "hub",
    "blog-studio",
    "tools",
    "..",
    "../etc/passwd",
    "project/blockwise/..",
]


class OwnerShellGrammar(unittest.TestCase):
    def test_owner_paths_belong_to_the_shell(self):
        for path in OWNER_PATHS:
            with self.subTest(path=path):
                self.assertTrue(owner_shell.owner_shell_route(path))

    def test_every_other_path_stays_with_the_vanilla_window(self):
        for path in VANILLA_PATHS:
            with self.subTest(path=path):
                self.assertFalse(owner_shell.owner_shell_route(path))

    def test_none_is_treated_as_the_root(self):
        self.assertTrue(owner_shell.owner_shell_route(None))

    def test_the_section_allowlist_matches_the_browser_grammar(self):
        routing = (
            Path(__file__).resolve().parents[1] / "web" / "js" / "view-routing.js"
        ).read_text()
        for section in owner_shell.OWNER_SHELL_SECTIONS:
            with self.subTest(section=section):
                self.assertIn(f'"{section}"', routing)


class ResolveSpaDocument(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.web = Path(self._temp.name)
        (self.web / "index.html").write_text("vanilla")
        (self.web / "ui").mkdir()
        (self.web / "ui" / "index.html").write_text("shell")
        (self.web / "js").mkdir()
        (self.web / "js" / "app.js").write_text("// app")
        self.addCleanup(self._temp.cleanup)

    def served(self, path: str) -> str:
        directory, filename = owner_shell.resolve_spa_document(self.web, path)
        return (Path(directory) / filename).read_text()

    def test_owner_routes_resolve_to_the_shell_index(self):
        for path in ["/", "", "/project/blockwise", "/project/blockwise/crm", "/project/blockwise/customer/abc"]:
            with self.subTest(path=path):
                self.assertEqual(self.served(path), "shell")

    def test_every_other_route_resolves_to_the_vanilla_index(self):
        for path in ["/project/other", "/blog-studio", "/hub", "/project/blockwise/unknown"]:
            with self.subTest(path=path):
                self.assertEqual(self.served(path), "vanilla")

    def test_a_real_file_resolves_to_itself(self):
        directory, filename = owner_shell.resolve_spa_document(self.web, "js/app.js")
        self.assertEqual(filename, "app.js")
        self.assertEqual((Path(directory) / filename).read_text(), "// app")

    def test_a_path_escaping_the_web_root_never_names_a_file(self):
        outside = Path(self._temp.name).parent / "outside-the-web-root.txt"
        outside.write_text("secret")
        self.addCleanup(outside.unlink)
        directory, filename = owner_shell.resolve_spa_document(self.web, f"../{outside.name}")
        self.assertEqual((Path(directory) / filename).read_text(), "vanilla")

    def test_owner_routes_fall_back_to_the_vanilla_index_without_a_bundle(self):
        (self.web / "ui" / "index.html").unlink()
        self.assertIsNone(owner_shell.owner_shell_index(self.web))
        for path in ["/", "/project/blockwise", "/project/blockwise/crm"]:
            with self.subTest(path=path):
                self.assertEqual(self.served(path), "vanilla")


class ServedRoutes(unittest.TestCase):
    """The Flask surface: one entry point for the shell, assets under /ui/."""

    @classmethod
    def setUpClass(cls):
        import server  # noqa: PLC0415 - importing the app registers every blueprint

        cls.server = server

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.web = Path(self._temp.name)
        (self.web / "index.html").write_text("vanilla")
        (self.web / "ui" / "assets").mkdir(parents=True)
        (self.web / "ui" / "index.html").write_text("shell")
        (self.web / "ui" / "assets" / "x.js").write_text("// bundle")
        self.previous_web = self.server.WEB
        self.server.WEB = self.web.resolve()
        self.addCleanup(lambda: setattr(self.server, "WEB", self.previous_web))
        self.client = self.server.app.test_client()

    def test_the_old_bundle_entry_point_redirects_to_the_shell(self):
        for path in ["/ui", "/ui/", "/ui/index.html", "/ui/nope"]:
            with self.subTest(path=path), self.client.get(path) as response:
                self.assertEqual(response.status_code, 308)
                self.assertEqual(response.headers["Location"], "/")

    def test_bundle_assets_are_served_from_their_built_address(self):
        with self.client.get("/ui/assets/x.js") as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_data(as_text=True), "// bundle")

    def test_owner_routes_serve_the_shell_uncached(self):
        for path in ["/", "/project/blockwise", "/project/blockwise/crm", "/project/blockwise/customer/abc"]:
            with self.subTest(path=path), self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_data(as_text=True), "shell")
                self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_every_other_route_serves_the_vanilla_window(self):
        for path in ["/hub", "/blog-studio", "/project/other"]:
            with self.subTest(path=path), self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_data(as_text=True), "vanilla")


if __name__ == "__main__":
    unittest.main()
