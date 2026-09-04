import base64
import unittest

from hermes_adapter.http import RestSurface
from hermes_adapter.serve import ServeClient, ServeError, serve_status_gate


def serve_surface(handler):
    return RestSurface(
        "serve", "http://127.0.0.1:19121", lambda: {"X-Hermes-Session-Token": "st"},
        urlopen=lambda request, timeout: _FakeResponse(handler(request)),
    )


class _FakeResponse:
    def __init__(self, result):
        self.result = result

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    @property
    def status(self):
        return self.result[0]

    def read(self, limit):
        import json

        body = self.result[1]
        return b"" if body is None else json.dumps(body).encode()


class ServeStatusGateTest(unittest.TestCase):
    def test_gated_dashboard_fails_closed(self):
        with self.assertRaises(ServeError):
            serve_status_gate({"auth_required": True, "dashboard.public_url": None})
        with self.assertRaises(ServeError):
            serve_status_gate({"auth_required": False, "dashboard.public_url": "https://leak.example"})

    def test_contracted_status_passes(self):
        view = serve_status_gate({"auth_required": False, "dashboard.public_url": None, "gateway_state": "running"})
        self.assertTrue(view["gateway_ready"])


class TranscribeTest(unittest.TestCase):
    def test_silence_is_success_not_error(self):
        client = ServeClient(serve_surface(lambda request: (200, {"ok": True, "transcript": "", "provider": None})))
        audio = base64.b64encode(b"abc").decode()
        result = client.transcribe(f"data:audio/wav;base64,{audio}")
        self.assertEqual(result, {"ok": True, "transcript": "", "provider": None})

    def test_decoded_cap_enforced_after_base64_decode(self):
        client = ServeClient(serve_surface(lambda request: (200, {"ok": True, "transcript": "x"})))
        huge = base64.b64encode(b"\0" * (25 * 1024 * 1024 + 1)).decode()
        with self.assertRaises(ServeError) as caught:
            client.transcribe(f"data:audio/wav;base64,{huge}")
        self.assertEqual(caught.exception.frank_code, "hermes.payload_too_large")

    def test_invalid_data_urls_rejected(self):
        client = ServeClient(serve_surface(lambda request: (200, {"ok": True, "transcript": "x"})))
        with self.assertRaises(ServeError):
            client.transcribe("not-a-data-url")
        with self.assertRaises(ServeError):
            client.transcribe("data:audio/wav;base64,!!!not-base64!!!")

    def test_voice_config_is_not_an_allowed_endpoint(self):
        from hermes_adapter.http import ENDPOINTS

        self.assertNotIn(("serve", "GET", "/api/audio/voice-config"), ENDPOINTS)


if __name__ == "__main__":
    unittest.main()
