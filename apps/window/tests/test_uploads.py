import tempfile
import unittest
from pathlib import Path

import server


class UploadDeleteApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_upload_dir = server.UPLOAD_DIR
        server.UPLOAD_DIR = Path(self.temp.name) / "uploads"
        server.UPLOAD_DIR.mkdir(parents=True)
        self.client = server.app.test_client()

    def tearDown(self):
        server.UPLOAD_DIR = self.original_upload_dir
        self.temp.cleanup()

    def test_deletes_staged_files_and_prunes_empty_batch(self):
        target = server.UPLOAD_DIR / "batch" / "wrong-folder" / "image.png"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"image")

        response = self.client.delete(
            "/api/chat/uploads",
            json={"ids": ["batch/wrong-folder/image.png"]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {"ok": True, "deleted": ["batch/wrong-folder/image.png"], "missing": []},
        )
        self.assertFalse(target.exists())
        self.assertFalse((server.UPLOAD_DIR / "batch").exists())

    def test_rejects_escape_and_reports_already_missing_files(self):
        escaped = self.client.delete("/api/chat/uploads", json={"ids": ["../secret"]})
        self.assertEqual(escaped.status_code, 400)

        missing = self.client.delete("/api/chat/uploads", json={"ids": ["batch/missing.txt"]})
        self.assertEqual(missing.status_code, 200)
        self.assertEqual(missing.get_json()["missing"], ["batch/missing.txt"])


if __name__ == "__main__":
    unittest.main()
