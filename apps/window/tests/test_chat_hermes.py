import json
import unittest
from unittest.mock import patch

import server


class _Stream:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def __iter__(self):
        yield b"event: assistant.delta\n"
        yield b'data: {"delta":"still working"}\n\n'
        yield b"event: done\n"
        yield b'data: {"type":"done"}\n\n'


class HermesChatApiTest(unittest.TestCase):
    def setUp(self):
        self.client = server.app.test_client()

    @patch("server.hermes_request")
    def test_lists_live_hermes_sessions(self, request):
        request.return_value = {
            "data": [{
                "id": "session-1",
                "title": "Frank main",
                "source": "api_server",
                "model": "deepseek-v4-pro",
                "started_at": 10,
                "last_active": 20,
                "message_count": 7,
                "preview": "latest prompt",
            }]
        }

        response = self.client.get("/api/chat/sessions")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["sessions"], [{
            "id": "session-1",
            "title": "Frank main",
            "source": "api_server",
            "model": "deepseek-v4-pro",
            "created_at": 10,
            "updated_at": 20,
            "message_count": 7,
            "preview": "latest prompt",
        }])
        request.assert_called_once_with("/api/sessions?limit=100&include_children=true")

    @patch("server.hermes_request")
    def test_creates_an_unassigned_session_in_the_one_profile(self, request):
        request.return_value = {
            "session": {
                "id": "session-2",
                "source": "api_server",
                "model": "qwen3.8-max",
                "started_at": 30,
            }
        }

        response = self.client.post("/api/chat/sessions", json={
            "title": "New chat",
            "model": "qwen3.8-max",
            "provider": "custom",
        })

        self.assertEqual(response.status_code, 201)
        request.assert_called_once_with(
            "/api/sessions",
            {
                "source": "api_server",
                "model": "qwen3.8-max",
                "provider": "custom",
                "require_model_lock": True,
            },
            method="POST",
        )

    @patch("server.hermes_request")
    def test_reads_the_authoritative_hermes_transcript(self, request):
        request.return_value = {
            "data": [
                {"role": "user", "content": "hello", "timestamp": 40},
                {"role": "tool", "content": "private tool output", "tool_name": "terminal", "timestamp": 41},
                {"role": "assistant", "content": "hi", "timestamp": 42},
            ]
        }

        response = self.client.get("/api/chat?session_id=session-3")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [(item["role"], item["text"]) for item in response.get_json()["messages"]],
            [("user", "hello"), ("assistant", "hi")],
        )
        request.assert_called_once_with("/api/sessions/session-3/messages?limit=500&order=oldest")

    @patch("server.hermes_request")
    def test_model_changes_are_persisted_by_hermes(self, request):
        request.return_value = {"runtime": {"model": "grok-4.6", "model_lock": "accepted"}}

        response = self.client.post(
            "/api/chat/sessions/session-4/model",
            json={"model": "grok-4.6", "provider": "xai"},
        )

        self.assertEqual(response.status_code, 200)
        request.assert_called_once_with(
            "/api/sessions/session-4/model",
            {"model": "grok-4.6", "provider": "xai", "require_model_lock": True},
            method="POST",
        )

    @patch("server.urllib.request.urlopen", return_value=_Stream())
    def test_turn_uses_native_session_stream_without_a_deadline(self, urlopen):
        response = self.client.post("/api/chat/turn", json={
            "chat_id": "session-5",
            "text": "take as long as needed",
            "model": "deepseek-v4-pro",
            "provider": "deepseek",
        })
        payload = response.get_data(as_text=True)

        self.assertEqual(response.status_code, 200)
        self.assertIn("event: assistant.delta", payload)
        upstream = urlopen.call_args.args[0]
        self.assertTrue(upstream.full_url.endswith("/api/sessions/session-5/chat/stream"))
        self.assertEqual(urlopen.call_args.kwargs, {})
        self.assertEqual(json.loads(upstream.data), {
            "message": "take as long as needed",
            "model": "deepseek-v4-pro",
            "provider": "deepseek",
            "require_model_lock": True,
        })


if __name__ == "__main__":
    unittest.main()
