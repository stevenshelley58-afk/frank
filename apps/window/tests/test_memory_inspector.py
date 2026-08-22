import unittest

from flask import Flask

from memory_inspector import HindsightUnavailable, MemoryInspector, SCHEMA, create_blueprint


class FakeHindsight:
    def __init__(self):
        self.calls = []
        self.responses = {
            ("GET", "/health"): {"status": "healthy"},
            ("GET", "/version"): {"version": "0.6.1"},
            ("GET", "/v1/default/banks"): {"banks": [{"bank_id": "steven-blockwise"}]},
            ("GET", "/v1/default/banks/steven-blockwise/stats"): {
                "pending_operations": 0, "failed_operations": 1,
            },
            ("GET", "/v1/default/banks/steven-blockwise/documents?limit=100&offset=0"): {
                "total": 1,
                "items": [{
                    "id": "doc-1", "created_at": "2026-08-22T01:00:00Z",
                    "updated_at": "2026-08-22T02:00:00Z", "memory_unit_count": 2,
                    "tags": ["project:blockwise"],
                    "retain_params": {"context": "project conversation"},
                    "document_metadata": {
                        "source": "hermes", "session_id": "session-1",
                        "api_key": "must-not-leak",
                    },
                }],
            },
            ("GET", "/v1/default/banks/steven-blockwise/memories/list?limit=100&offset=0"): {
                "total": 1,
                "items": [{
                    "id": "memory-1", "text": "Use the approved campaign workflow.",
                    "fact_type": "world", "mentioned_at": "2026-08-22T02:00:00Z",
                    "chunk_id": "steven-blockwise_doc-1_0", "proof_count": 1,
                    "tags": ["project:blockwise"],
                }],
            },
            ("GET", "/v1/default/banks/steven-blockwise/operations?limit=50&offset=0"): {
                "operations": [{
                    "id": "operation-1", "task_type": "retain", "status": "failed",
                    "created_at": "2026-08-22T02:01:00Z", "error_message": "provider timeout",
                }],
            },
            ("GET", "/v1/default/banks/steven-blockwise/audit-logs?limit=50&offset=0"): {
                "items": [{"id": "audit-1", "action": "recall", "status": "ok"}],
            },
            ("GET", "/v1/default/banks/steven-blockwise/documents/doc-1"): {
                "id": "doc-1", "original_text": "Original durable project decision.",
                "memory_unit_count": 2, "tags": ["project:blockwise"],
                "retain_params": {"context": "project conversation"},
                "document_metadata": {"source": "hermes", "api_key": "must-not-leak"},
            },
            ("POST", "/v1/default/banks/steven-blockwise/memories/recall"): {
                "results": [{"id": "memory-1", "text": "Approved campaign workflow", "type": "world", "score": 0.92}],
                "trace": {"visited": 3},
            },
            ("POST", "/v1/default/banks/steven-blockwise/memories"): {"success": True},
            ("DELETE", "/v1/default/banks/steven-blockwise/documents/doc-1"): {"success": True},
        }

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        value = self.responses.get((method, path))
        if value is None:
            raise AssertionError(f"unexpected request: {method} {path}")
        return value


class MemoryInspectorTests(unittest.TestCase):
    def setUp(self):
        self.hindsight = FakeHindsight()
        projects = {
            "blockwise": {"id": "blockwise", "name": "Blockwise", "root": "blockwise"},
        }
        inspector = MemoryInspector(projects.get, self.hindsight)
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(inspector))
        self.client = app.test_client()

    def test_snapshot_uses_only_the_bound_project_bank_and_sanitizes_metadata(self):
        response = self.client.get("/api/projects/blockwise/memory")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["schema"], SCHEMA)
        self.assertEqual(data["provider"]["bank_id"], "steven-blockwise")
        self.assertTrue(data["provider"]["bank_exists"])
        self.assertEqual(data["counts"], {"memories": 1, "documents": 1, "pending": 0, "failed": 1})
        self.assertEqual(data["memories"][0]["source_document_id"], "doc-1")
        self.assertEqual(data["documents"][0]["metadata"]["session_id"], "session-1")
        self.assertNotIn("api_key", str(data))
        self.assertTrue(all("steven-blockwise" in path or path in {"/health", "/version", "/v1/default/banks"} for _, path, _ in self.hindsight.calls))

    def test_new_project_without_a_bank_is_a_healthy_empty_state(self):
        self.hindsight.responses[("GET", "/v1/default/banks")] = {"banks": []}
        response = self.client.get("/api/projects/blockwise/memory")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertFalse(data["provider"]["bank_exists"])
        self.assertEqual(data["counts"], {"memories": 0, "documents": 0, "pending": 0, "failed": 0})
        self.assertEqual(data["memories"], [])

    def test_source_text_is_loaded_only_by_the_explicit_document_route(self):
        summary = self.client.get("/api/projects/blockwise/memory").get_json()
        self.assertNotIn("Original durable", str(summary))
        response = self.client.get("/api/projects/blockwise/memory/documents/doc-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["document"]["content"], "Original durable project decision.")
        self.assertNotIn("api_key", str(response.get_json()))

    def test_correction_replaces_the_native_hindsight_source_document(self):
        response = self.client.put(
            "/api/projects/blockwise/memory/documents/doc-1",
            json={"content": "Corrected durable project decision."},
        )
        self.assertEqual(response.status_code, 200)
        call = self.hindsight.calls[-1]
        self.assertEqual(call[:2], ("POST", "/v1/default/banks/steven-blockwise/memories"))
        item = call[2]["items"][0]
        self.assertEqual(item["document_id"], "doc-1")
        self.assertEqual(item["update_mode"], "replace")
        self.assertEqual(item["metadata"]["source"], "frank-memory-inspector")
        self.assertNotIn("api_key", item["metadata"])

    def test_forget_requires_an_exact_confirmation_and_deletes_the_source(self):
        rejected = self.client.delete(
            "/api/projects/blockwise/memory/documents/doc-1",
            json={"confirmation": "yes"},
        )
        self.assertEqual(rejected.status_code, 409)
        accepted = self.client.delete(
            "/api/projects/blockwise/memory/documents/doc-1",
            json={"confirmation": "FORGET doc-1"},
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(self.hindsight.calls[-1][:2], ("DELETE", "/v1/default/banks/steven-blockwise/documents/doc-1"))

    def test_recall_is_project_scoped_and_rejects_extra_fields(self):
        response = self.client.post("/api/projects/blockwise/memory/recall", json={"query": "campaign workflow"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["bank_id"], "steven-blockwise")
        self.assertEqual(self.hindsight.calls[-1][1], "/v1/default/banks/steven-blockwise/memories/recall")
        rejected = self.client.post("/api/projects/blockwise/memory/recall", json={"query": "x", "bank_id": "steven-frank"})
        self.assertEqual(rejected.status_code, 400)

    def test_missing_project_and_provider_failure_are_truthful(self):
        self.assertEqual(self.client.get("/api/projects/nope/memory").status_code, 404)
        self.hindsight.responses[("GET", "/health")] = None

        def unavailable(method, path, payload=None):
            raise HindsightUnavailable("Hindsight memory is unavailable.")

        self.hindsight.request = unavailable
        response = self.client.get("/api/projects/blockwise/memory")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "Hindsight memory is unavailable.")


if __name__ == "__main__":
    unittest.main()
