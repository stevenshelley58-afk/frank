import unittest
from unittest import mock

import server
from review_chat import ReviewChatError, validate_review_message


class ReviewChatTest(unittest.TestCase):
    def test_validation_bounds_and_normalizes(self):
        value = validate_review_message({
            "project_id": "blockwise", "message": "  fix it ", "annotations": [{
                "placement": "feed", "x": 0, "y": .1, "width": .5, "height": .25, "message": " fix logo "
            }], "expected_revision": 0, "idempotency_key": "review-1",
        })
        self.assertEqual(value["message"], "fix it")
        self.assertEqual(value["annotations"][0]["message"], "fix logo")

    def test_validation_rejects_nonfinite_and_uncontained(self):
        base = {"project_id": "blockwise", "message": "x", "annotations": [], "expected_revision": 0, "idempotency_key": "x"}
        for rect in ({"x": float("nan"), "y": 0, "width": .1, "height": .1}, {"x": .9, "y": 0, "width": .2, "height": .1}):
            body = dict(base, annotations=[dict(rect, placement="feed", message="x")])
            with self.assertRaises(ReviewChatError): validate_review_message(body)

    def test_route_forwards_structured_payload_and_scope(self):
        run_id = "trun_" + "a" * 32
        calls = []
        def fake(path, payload=None, **kwargs):
            calls.append((path, payload, kwargs))
            if path.endswith("/request-changes"): return {"status": "queued", "current_revision": 1}
            return {"scope": {"project_id": "blockwise"}, "status": "ready_for_review"}
        with mock.patch.object(server, "hermes_request", side_effect=fake):
            response = server.app.test_client().post(f"/api/ad-template-generator/runs/{run_id}/review-messages", json={
                "project_id": "blockwise", "message": "Fix logo", "annotations": [], "expected_revision": 0, "idempotency_key": "review-2",
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[1][1]["review"]["message"], "Fix logo")
        self.assertNotIn("instructions", calls[1][1])

    def test_scope_mismatch_rejected(self):
        run_id = "trun_" + "b" * 32
        with mock.patch.object(server, "hermes_request", return_value={"scope": {"project_id": "other"}}):
            response = server.app.test_client().post(f"/api/ad-template-generator/runs/{run_id}/review-messages", json={
                "project_id": "blockwise", "message": "Fix", "annotations": [], "expected_revision": 0, "idempotency_key": "review-3",
            })
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__": unittest.main()
