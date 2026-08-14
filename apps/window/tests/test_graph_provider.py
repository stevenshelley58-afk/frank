import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flask import Flask

from graph.provider import ReadOnlyProvider, create_blueprint


GRAPH = {
    "schema": "schema://frank.graph/v1",
    "graph_id": "tool:fixture-tool",
    "nodes": [],
    "edges": [],
    "groups": [],
    "lens": "tool.pipeline",
}
TRACE = {"schema": "schema://frank.tool-app-trace/v1", "trace_id": "0123456789abcdef0123456789abcdef"}


class GraphProviderTest(unittest.TestCase):
    def client(self, provider):
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(provider))
        return app.test_client()

    def test_unregistered_provider_fails_closed_without_fallback_store(self):
        response = self.client(ReadOnlyProvider()).get("/api/graphs/tool/fixture-tool")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["status"], "unavailable")

    def test_graph_endpoint_is_allowlisted_get_only_and_passes_opaque_selectors(self):
        seen = {}

        def read_graph(**kwargs):
            seen.update(kwargs)
            return GRAPH

        client = self.client(ReadOnlyProvider(graph_reader=read_graph))
        response = client.get("/api/graphs/tool/fixture-tool?lens=tool.pipeline&settings_revision_id=rev-4&trace_id=0123456789abcdef0123456789abcdef")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(seen["kind"], "tool")
        self.assertEqual(seen["selectors"]["settings_revision_id"], "rev-4")
        self.assertEqual(client.post("/api/graphs/tool/fixture-tool").status_code, 405)
        self.assertEqual(client.get("/api/graphs/tool/fixture-tool?source=/vps/secrets").status_code, 400)
        self.assertEqual(client.get("/api/graphs/unknown/fixture-tool").status_code, 404)

    def test_trace_endpoint_requires_lowercase_w3c_id_and_never_fabricates(self):
        client = self.client(ReadOnlyProvider(trace_reader=lambda **kwargs: {**TRACE, "spans": [{"name": "safe", "prompt": "never expose"}]}))
        trace_id = TRACE["trace_id"]
        response = client.get(f"/api/traces/{trace_id}")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("never expose", response.get_data(as_text=True))
        self.assertEqual(client.get(f"/api/traces/{trace_id.upper()}").status_code, 404)
        self.assertEqual(client.post(f"/api/traces/{trace_id}").status_code, 405)
        self.assertEqual(client.get("/api/traces/0123456789abcdef0123456789abcde0").status_code, 503)

    def test_invalid_reader_payload_fails_closed(self):
        client = self.client(ReadOnlyProvider(graph_reader=lambda **kwargs: {"schema": "wrong"}))
        response = client.get("/api/graphs/tool/fixture-tool")
        self.assertEqual(response.status_code, 503)

    def test_reader_failures_are_unavailable_without_internal_error_details(self):
        client = self.client(ReadOnlyProvider(graph_reader=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("/vps/private"))))
        response = client.get("/api/graphs/tool/fixture-tool")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("/vps/private", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
