import threading
import time
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import server


PNG = b"\x89PNG\r\n\x1a\n" + (b"\x00" * 80)
JPEG = b"\xff\xd8\xff\xe0" + (b"\x00" * 80)


class AdStudioBatchApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous_upload_dir = server.UPLOAD_DIR
        self.previous_max_sources = server.AD_STUDIO_MAX_SOURCES
        self.previous_max_source_bytes = server.AD_STUDIO_MAX_SOURCE_BYTES
        self.previous_max_batch_bytes = server.AD_STUDIO_MAX_BATCH_BYTES
        server.UPLOAD_DIR = Path(self.temp.name) / "uploads"
        server.UPLOAD_DIR.mkdir(parents=True)
        self.client = server.app.test_client()
        self.project = {"id": "ad-project", "name": "Ad project", "root": "ad-project"}

    def tearDown(self):
        server.UPLOAD_DIR = self.previous_upload_dir
        server.AD_STUDIO_MAX_SOURCES = self.previous_max_sources
        server.AD_STUDIO_MAX_SOURCE_BYTES = self.previous_max_source_bytes
        server.AD_STUDIO_MAX_BATCH_BYTES = self.previous_max_batch_bytes
        self.temp.cleanup()

    def stage(self, name, content=PNG, *, batch="batch"):
        target = server.UPLOAD_DIR / batch / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return {"id": target.relative_to(server.UPLOAD_DIR).as_posix(), "name": name}

    @staticmethod
    def hermes_success(calls):
        lock = threading.Lock()

        def request(path, payload, **kwargs):
            with lock:
                calls.append(payload)
                sequence = len(calls)
            return {
                "run": {
                    "id": f"trun_{sequence:032x}",
                    "status": "queued",
                    "payload": payload["payload"],
                }
            }

        return request

    def post(self, attachments, hermes):
        with (
            mock.patch.object(server._project_store, "get_project", return_value=self.project),
            mock.patch.object(server, "hermes_request", side_effect=hermes),
        ):
            return self.client.post(
                "/api/ad-studio/runs",
                json={"project_id": "ad-project", "name": "Campaign", "brief": "Match it", "attachments": attachments},
            )

    def test_all_accepted_returns_202_with_one_run_per_image_and_unique_keys(self):
        attachments = [self.stage("one.png"), self.stage("two.jpg", JPEG)]
        calls = []
        response = self.post(attachments, self.hermes_success(calls))

        self.assertEqual(response.status_code, 202)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertFalse(payload["partial"])
        self.assertEqual(payload["accepted"], 2)
        self.assertEqual([item["status"] for item in payload["results"]], ["accepted", "accepted"])
        self.assertEqual(len(payload["runs"]), 2)
        self.assertEqual(len({item["request_id"] for item in calls}), 2)
        self.assertEqual(len({item["idempotency_key"] for item in calls}), 2)
        self.assertTrue(all(item["payload"]["placements"] == ["feed", "story"] for item in calls))
        self.assertFalse(any(server.UPLOAD_DIR.rglob("*.*")))

    def test_mixed_hermes_result_returns_ordered_207_and_cleans_all_staging(self):
        attachments = [self.stage("one.png"), self.stage("two.png"), self.stage("three.png")]
        calls = []
        lock = threading.Lock()

        def hermes(path, payload, **kwargs):
            name = payload["payload"]["sources"][0]["name"]
            with lock:
                calls.append(name)
                sequence = len(calls)
            if name == "two.png":
                raise OSError("upstream unavailable")
            return {"run": {"id": f"trun_{sequence:032x}", "status": "queued", "payload": payload["payload"]}}

        response = self.post(attachments, hermes)

        self.assertEqual(response.status_code, 207)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["partial"])
        self.assertEqual([item["index"] for item in payload["results"]], [0, 1, 2])
        self.assertEqual([item["status"] for item in payload["results"]], ["accepted", "failed", "accepted"])
        self.assertEqual(payload["results"][1]["error"]["code"], "hermes_unavailable")
        self.assertFalse(any(server.UPLOAD_DIR.rglob("*.*")))

    def test_all_rejected_returns_422_without_calling_hermes_and_cleans_files(self):
        attachments = [
            self.stage("fake.png", b"not a png"),
            self.stage("vector.svg", b"<svg></svg>"),
        ]
        hermes = mock.Mock()

        response = self.post(attachments, hermes)

        self.assertEqual(response.status_code, 422)
        payload = response.get_json()
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["accepted"], 0)
        self.assertEqual([item["error"]["code"] for item in payload["results"]], ["invalid_image", "unsupported_type"])
        hermes.assert_not_called()
        self.assertFalse(any(server.UPLOAD_DIR.rglob("*.*")))

    def test_signature_size_and_batch_count_are_bounded(self):
        server.AD_STUDIO_MAX_SOURCE_BYTES = len(PNG) - 1
        server.AD_STUDIO_MAX_BATCH_BYTES = len(PNG) * 2
        too_large = self.stage("large.png")
        response = self.post([too_large], mock.Mock())
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json()["results"][0]["error"]["code"], "file_too_large")
        self.assertFalse((server.UPLOAD_DIR / too_large["id"]).exists())

        server.AD_STUDIO_MAX_SOURCE_BYTES = len(PNG) * 2
        server.AD_STUDIO_MAX_SOURCES = 2
        over_count = [self.stage(f"source-{index}.png", batch="over") for index in range(3)]
        response = self.post(over_count, mock.Mock())
        self.assertEqual(response.status_code, 413)
        self.assertFalse(any((server.UPLOAD_DIR / "over").glob("*")))

    def test_hermes_starts_are_bounded_to_four_concurrent_requests(self):
        attachments = [self.stage(f"source-{index}.png") for index in range(7)]
        active = 0
        peak = 0
        sequence = 0
        lock = threading.Lock()

        def hermes(path, payload, **kwargs):
            nonlocal active, peak, sequence
            with lock:
                active += 1
                peak = max(peak, active)
                sequence += 1
                run_number = sequence
            time.sleep(0.04)
            with lock:
                active -= 1
            return {"run": {"id": f"trun_{run_number:032x}", "status": "queued", "payload": payload["payload"]}}

        response = self.post(attachments, hermes)

        self.assertEqual(response.status_code, 202)
        self.assertGreaterEqual(peak, 2)
        self.assertLessEqual(peak, 4)

    def test_single_json_request_preserves_run_and_runs_response_fields(self):
        attachment = self.stage("single.png")
        calls = []
        response = self.post([attachment], self.hermes_success(calls))

        self.assertEqual(response.status_code, 202)
        payload = response.get_json()
        self.assertEqual(payload["run"], payload["runs"][0])
        self.assertEqual(payload["run"]["id"], "trun_00000000000000000000000000000001")


if __name__ == "__main__":
    unittest.main()
