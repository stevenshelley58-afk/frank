"""Memory admission + global promotion tests (fake Hindsight client)."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flask import Flask

from infra.memory_admission import AdmissionRefused, AdmissionRequest, MemoryAdmission
from memory_inspector import MemoryInspector, create_blueprint


class FakeClient:
    def __init__(self, responses=None):
        self.calls = []
        self.responses = responses or {}

    def request(self, method, path, payload=None, *, timeout=None):
        self.calls.append((method, path, payload))
        if method == "GET" and "/documents/" in path:
            document_id = path.rsplit("/", 1)[-1]
            return {
                "id": document_id,
                "original_text": "Deployment runs on the VPS, not the laptop.",
                "document_metadata": {"source": "hermes"},
                "tags": ["observation"],
                "memory_count": 2,
            }
        return self.responses.get((method, path), {"ok": True, "status": "completed"})


def _project():
    return {"id": "blockwise", "root": "blockwise"}


class AdmissionTest(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.admission = MemoryAdmission(self.client, global_bank_id="steven-global")

    def _request(self, **overrides):
        entry = {
            "kind": "direct-user",
            "content": "Always deploy from the VPS worktree, never the laptop checkout.",
            "provenance": {"source": "chat-2026-09-03", "bank_id": "steven-blockwise"},
            "user_attributed": True,
            "idempotency_key": "adm-001",
        }
        entry.update(overrides)
        return AdmissionRequest(**entry)

    def test_direct_user_fact_is_admitted_to_project_bank(self):
        result = self.admission.admit(self._request())
        self.assertTrue(result["ok"])
        self.assertEqual(result["bank_id"], "steven-blockwise")
        method, path, payload = self.client.calls[-1]
        self.assertEqual(method, "POST")
        self.assertIn("/banks/steven-blockwise/memories", path)
        item = payload["items"][0]
        self.assertEqual(item["metadata"]["admission_kind"], "direct-user")
        self.assertEqual(item["metadata"]["attributed_to"], "steven")
        self.assertTrue(item["document_id"].startswith("admitted-"))
        self.assertEqual(payload["async"], False)

    def test_global_preference_goes_to_global_bank(self):
        result = self.admission.admit(
            self._request(kind="global-preference", scope="global",
                          provenance={"source": "memory-view", "origin_bank": "steven-blockwise",
                                      "origin_document": "doc-9"})
        )
        self.assertEqual(result["bank_id"], "steven-global")
        self.assertIn("/banks/steven-global/memories", self.client.calls[-1][1])

    def test_refusals(self):
        cases = [
            self._request(user_attributed=False),                      # not user-authored
            self._request(kind="assistant-prose"),                     # unsupported kind
            self._request(idempotency_key=""),                         # no idempotency
            self._request(provenance={"bank_id": "steven-blockwise"}), # no provenance source
            self._request(content=""),                                 # empty
            self._request(content="api_key = sk-abcdefghij0123456789"),  # secret
            self._request(content="password: hunter2 something"),      # secret-ish
            self._request(scope="global"),                             # global without global provenance kind
            self._request(provenance={"source": "x"}),                 # project admission without bank id
        ]
        for case in cases:
            with self.assertRaises(AdmissionRefused, msg=case.content or case.kind):
                self.admission.admit(case)

    def test_duplicate_injection_is_idempotent_document_id(self):
        first = self.admission.admit(self._request())
        second = self.admission.admit(self._request())
        self.assertEqual(first["document_id"], second["document_id"])


class PromoteGlobalTest(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.inspector = MemoryInspector(lambda pid: _project(), self.client, global_bank_id="steven-global")
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(self.inspector))
        app.config["TESTING"] = True
        self.client_http = app.test_client()

    def test_promotion_requires_exact_confirmation_and_key(self):
        with self.assertRaises(Exception):
            self.inspector.promote_document_global(_project(), "doc-1", "wrong", "key-1")
        result = self.inspector.promote_document_global(_project(), "doc-1", "PROMOTE doc-1", "idem-abc")
        self.assertEqual(result["origin_bank"], "steven-blockwise")
        self.assertEqual(result["global_bank_id"], "steven-global")
        self.assertEqual(result["promoted_document_id"], "admitted-promoted-idem-abc")
        method, path, payload = self.client.calls[-1]
        self.assertIn("/banks/steven-global/memories", path)
        metadata = payload["items"][0]["metadata"]
        self.assertEqual(metadata["origin_bank"], "steven-blockwise")
        self.assertEqual(metadata["origin_document"], "doc-1")

    def test_promotion_idempotency_reuses_document_id(self):
        first = self.inspector.promote_document_global(_project(), "doc-1", "PROMOTE doc-1", "idem-1")
        second = self.inspector.promote_document_global(_project(), "doc-1", "PROMOTE doc-1", "idem-1")
        self.assertEqual(first["promoted_document_id"], second["promoted_document_id"])

    def test_route_requires_same_origin(self):
        body = {"confirmation": "PROMOTE doc-1", "idempotency_key": "idem-2"}
        no_origin = self.client_http.post("/api/projects/blockwise/memory/documents/doc-1/promote-global", json=body)
        self.assertEqual(no_origin.status_code, 403)
        cross = self.client_http.post(
            "/api/projects/blockwise/memory/documents/doc-1/promote-global", json=body,
            headers={"Origin": "https://evil.example", "Content-Type": "application/json"},
        )
        self.assertEqual(cross.status_code, 403)
        wrong_type = self.client_http.post(
            "/api/projects/blockwise/memory/documents/doc-1/promote-global", data=json.dumps(body),
            headers={"Origin": "http://localhost/", "Content-Type": "text/plain"},
        )
        self.assertEqual(wrong_type.status_code, 415)

    def test_route_promotes_with_provenance(self):
        response = self.client_http.post(
            "/api/projects/blockwise/memory/documents/doc-1/promote-global",
            json={"confirmation": "PROMOTE doc-1", "idempotency_key": "idem-3"},
            headers={"Origin": "http://localhost/", "Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["origin_document"], "doc-1")

    def test_recall_unchanged_and_forget_confirmation_unchanged(self):
        recall = self.inspector.recall(_project(), "where does deployment run")
        self.assertEqual(recall["bank_id"], "steven-blockwise")
        with self.assertRaises(Exception):
            self.inspector.forget_document(_project(), "doc-1", "WRONG")


if __name__ == "__main__":
    unittest.main()
