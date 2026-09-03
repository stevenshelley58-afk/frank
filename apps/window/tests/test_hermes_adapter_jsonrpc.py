import json
import unittest

from hermes_adapter.jsonrpc import (
    DuplicateResponseError,
    JsonRpcCore,
    JsonRpcError,
    MalformedResponseError,
    RequestTimeoutError,
    UnknownResponseError,
)


class FakeClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class JsonRpcCoreTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.clock = FakeClock()
        self.core = JsonRpcCore(self.sent.append, timeout=5.0, monotonic=self.clock)

    def test_request_ids_are_unique(self):
        self.assertNotEqual(self.core.next_request_id(), self.core.next_request_id())

    def test_begin_request_sends_framed_request(self):
        request_id, frame = self.core.begin_request("session.list", {"limit": 20})
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(frame["jsonrpc"], "2.0")
        self.assertEqual(frame["id"], request_id)
        self.assertEqual(frame["method"], "session.list")
        self.assertEqual(frame["params"], {"limit": 20})

    def test_response_matches_exactly_once(self):
        request_id, _ = self.core.begin_request("session.list")
        matched = self.core.handle_message({"jsonrpc": "2.0", "id": request_id, "result": {"ok": True}})
        self.assertEqual(matched, request_id)
        self.assertTrue(self.core.is_settled(request_id))
        with self.assertRaises(DuplicateResponseError):
            self.core.handle_message({"jsonrpc": "2.0", "id": request_id, "result": {"ok": True}})

    def test_unknown_response_rejected_without_disturbing_inflight(self):
        _, first_frame = self.core.begin_request("a")
        self.core.begin_request("b")
        with self.assertRaises(UnknownResponseError):
            self.core.handle_message({"jsonrpc": "2.0", "id": "req-other", "result": {}})
        self.assertEqual(self.core.inflight_ids, sorted([first_frame["id"], self.sent[1]["id"]]))

    def test_malformed_frames_rejected(self):
        with self.assertRaises(MalformedResponseError):
            self.core.handle_message("not json{")
        with self.assertRaises(MalformedResponseError):
            self.core.handle_message({"id": 1, "result": {}})
        with self.assertRaises(MalformedResponseError):
            self.core.handle_message({"jsonrpc": "1.0", "id": "x", "result": {}})

    def test_native_error_normalized_with_redacted_detail(self):
        request_id, _ = self.core.begin_request("kanban.task.create")
        self.core.handle_message({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32602,
                "message": "bad params",
                "data": {"token": "abcdef123456", "hint": "id required"},
            },
        })
        with self.assertRaises(JsonRpcError) as caught:
            self.core.wait(request_id)
        error = caught.exception
        self.assertEqual(error.frank_code, "hermes.invalid_params")
        self.assertEqual(error.native_code, -32602)
        self.assertNotIn("abcdef123456", error.native_detail["token"])
        self.assertEqual(error.native_detail["hint"], "id required")

    def test_wait_returns_result_and_raises_native_error(self):
        request_id, _ = self.core.begin_request("x")
        self.core.handle_message({"jsonrpc": "2.0", "id": request_id, "result": 42})
        self.assertEqual(self.core.wait(request_id), 42)

        request_id2, _ = self.core.begin_request("y")
        self.core.handle_message({
            "jsonrpc": "2.0",
            "id": request_id2,
            "error": {"code": -32000, "message": "nope"},
        })
        with self.assertRaises(JsonRpcError):
            self.core.wait(request_id2)

    def test_deadline_expiry_times_out(self):
        request_id, _ = self.core.begin_request("slow", timeout=5.0)
        self.clock.advance(6.0)
        self.assertEqual(self.core.expire_deadlines(), [request_id])
        with self.assertRaises(RequestTimeoutError):
            self.core.wait(request_id)

    def test_request_id_cannot_be_reused(self):
        request_id, _ = self.core.begin_request("a")
        with self.assertRaises(ValueError):
            self.core.begin_request("a", request_id=request_id)

    def test_method_validation(self):
        with self.assertRaises(ValueError):
            self.core.begin_request("")
        with self.assertRaises(ValueError):
            self.core.begin_request("some/path")

    def test_wire_string_frames_accepted(self):
        request_id, _ = self.core.begin_request("a")
        matched = self.core.handle_message(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": "ok"}))
        self.assertEqual(matched, request_id)


if __name__ == "__main__":
    unittest.main()
