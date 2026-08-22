import os
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class TemplateReleaseRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.release_root = Path(cls.temp.name) / "releases"
        (cls.release_root / "release-1").mkdir(parents=True)
        (cls.release_root / "release-1" / "pack.json").write_text('{"schema":"blockwise.template-pack/v1"}', encoding="utf-8")
        (cls.release_root / "release-1" / "sample.png").write_bytes(b"PNG fixture")
        (cls.release_root / "release-1" / "font.woff2").write_bytes(b"font fixture")
        os.environ["AD_TEMPLATE_GENERATOR_RELEASE_ROOT"] = str(cls.release_root)
        import server
        cls.server = server
        server.TEMPLATE_RELEASE_ROOT = cls.release_root.resolve()
        cls.client = server.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()
        os.environ.pop("AD_TEMPLATE_GENERATOR_RELEASE_ROOT", None)

    def test_pack_sample_and_font_are_readable(self):
        for artifact, content_type in (("pack.json", "application/json"), ("sample.png", "image/png"), ("font.woff2", "font/woff2")):
            response = self.client.get(f"/releases/ad-template-generator/release-1/{artifact}")
            try:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, (self.release_root / "release-1" / artifact).read_bytes())
                self.assertTrue(response.headers["ETag"])
                self.assertIn(content_type, response.headers["Content-Type"])
            finally:
                response.close()
                if hasattr(response.response, "close"):
                    response.response.close()

    def test_head_has_no_body_and_missing_directory_is_not_listed(self):
        response = self.client.head("/releases/ad-template-generator/release-1/pack.json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"")
        for path in (
            "/releases/ad-template-generator",
            "/releases/ad-template-generator/",
            "/releases/ad-template-generator/release-1",
            "/releases/ad-template-generator/release-1/",
        ):
            directory_response = self.client.get(path)
            try:
                self.assertEqual(directory_response.status_code, 404, path)
            finally:
                directory_response.close()

    def test_traversal_private_extensions_and_non_files_fail(self):
        cases = (
            "/releases/ad-template-generator/../release-1/pack.json",
            "/releases/ad-template-generator/release-1/../release-1/pack.json",
            "/releases/ad-template-generator/release-1/secret.env",
            "/releases/ad-template-generator/release-1/pack.json.sig",
            "/releases/ad-template-generator/release-1/nope.json",
        )
        for path in cases:
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_symlink_is_not_served(self):
        link = self.release_root / "release-1" / "linked.json"
        try:
            link.symlink_to(self.release_root / "release-1" / "pack.json")
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable in this test environment")
        self.assertEqual(self.client.get("/releases/ad-template-generator/release-1/linked.json").status_code, 404)
