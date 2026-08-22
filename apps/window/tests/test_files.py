import tempfile
import unittest
from pathlib import Path

import server


class FilesApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.previous_root = server.ROOTS["vps"]
        self.previous_upload_dir = server.UPLOAD_DIR
        (self.root / "projects" / "frank").mkdir(parents=True)
        (self.root / "projects" / "frank" / "README.md").write_text("Frank\n", encoding="utf-8")
        (self.root / "projects" / "frank" / ".env").write_text("NOPE=1\n", encoding="utf-8")
        server.ROOTS["vps"] = self.root
        server.UPLOAD_DIR = self.root / "uploads"
        self.client = server.app.test_client()

    def tearDown(self):
        server.ROOTS["vps"] = self.previous_root
        server.UPLOAD_DIR = self.previous_upload_dir
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

    def test_copies_selected_vps_images_into_chat_uploads(self):
        image = self.root / "projects" / "frank" / "source.png"
        image.write_bytes(b"fake-png")

        response = self.client.post(
            "/api/chat/uploads/vps",
            json={"files": [{"root": "vps", "path": "projects/frank/source.png"}]},
        )

        self.assertEqual(response.status_code, 200)
        attachment = response.get_json()["attachments"][0]
        self.assertEqual(attachment["name"], "source.png")
        self.assertEqual(attachment["source"], "vps")
        self.assertEqual(attachment["relative_path"], "projects/frank/source.png")
        stored = server.UPLOAD_DIR / attachment["id"]
        self.assertEqual(stored.read_bytes(), b"fake-png")

    def test_vps_upload_accepts_only_visible_images_inside_the_mount(self):
        hidden = self.root / "projects" / "frank" / ".private.png"
        hidden.write_bytes(b"hidden")

        hidden_response = self.client.post(
            "/api/chat/uploads/vps",
            json={"files": [{"root": "vps", "path": "projects/frank/.private.png"}]},
        )
        text_response = self.client.post(
            "/api/chat/uploads/vps",
            json={"files": [{"root": "vps", "path": "projects/frank/README.md"}]},
        )
        escaped_response = self.client.post(
            "/api/chat/uploads/vps",
            json={"files": [{"root": "vps", "path": "../outside.png"}]},
        )

        self.assertEqual(hidden_response.status_code, 400)
        self.assertEqual(text_response.status_code, 415)
        self.assertEqual(escaped_response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
