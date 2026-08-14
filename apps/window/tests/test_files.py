import tempfile
import unittest
from pathlib import Path

import server


class FilesApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "projects" / "frank").mkdir(parents=True)
        (self.root / "projects" / "frank" / "README.md").write_text("Frank\n", encoding="utf-8")
        (self.root / "projects" / "frank" / ".env").write_text("NOPE=1\n", encoding="utf-8")
        server.ROOTS["vps"] = self.root
        self.client = server.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def test_exposes_one_vps_tree_and_hides_dotfiles(self):
        roots = self.client.get("/api/roots").get_json()
        self.assertEqual(roots, {"roots": [{"exists": True, "id": "vps", "name": "VPS"}]})

        root = self.client.get("/api/tree?root=vps&path=").get_json()
        self.assertEqual([entry["name"] for entry in root["entries"]], ["projects"])

        frank = self.client.get("/api/tree?root=vps&path=projects/frank").get_json()
        self.assertEqual([entry["name"] for entry in frank["entries"]], ["README.md"])

    def test_reads_files_but_refuses_root_escape(self):
        response = self.client.get("/api/file?root=vps&path=projects/frank/README.md")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["text"], "Frank\n")

        escaped = self.client.get("/api/file?root=vps&path=../outside.txt")
        self.assertEqual(escaped.status_code, 400)


if __name__ == "__main__":
    unittest.main()
