import copy
import json
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlsplit
import threading
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra" / "knowledge"))

from graph.provider import (
    KNOWLEDGE_LENS,
    MAX_V2_BODY_BYTES,
    KnowledgeProjectionClient,
    ProviderUnavailable,
    V2_GRAPH_SCHEMA,
    validate_knowledge_graph,
)


HASH = "sha256:" + "a" * 64


def graph_fixture():
    scope = {"kind": "project", "id": "acme"}
    source = {
        "provider_id": "hermes",
        "provider_version": "1.0.0",
        "source_type": "memory",
        "source_ref": "memory/acme/one",
        "sha256": HASH,
    }
    node = {
        "id": "g_acme/node:one",
        "source_id": "one",
        "kind": "memory",
        "label": "One",
        "scope": scope,
        "authority": "hermes",
        "source": source,
        "classification": "internal",
        "freshness": {"observed_at": "2026-08-14T00:00:00Z"},
        "capabilities": [],
        "ports": [],
        "status": "declared",
        "presentation": {},
        "extensions": {},
        "metadata": {"tag": "safe"},
    }
    second = copy.deepcopy(node)
    second["id"] = "g_acme/node:two"
    second["source_id"] = "two"
    return {
        "schema": V2_GRAPH_SCHEMA,
        "graph_id": "g_acme",
        "graph_revision": HASH,
        "generated_at": "2026-08-14T00:00:00Z",
        "provider": {"id": "hermes", "version": "1.0.0", "authority": "hermes"},
        "subject": scope,
        "scope": scope,
        "lens": KNOWLEDGE_LENS,
        "capabilities": ["knowledge.read"],
        "nodes": [node, second],
        "edges": [{
            "id": "g_acme/edge:one",
            "source_id": "one",
            "from": node["id"],
            "to": second["id"],
            "kind": "relation",
            "authority": "hermes",
            "classification": "internal",
            "source": source,
            "freshness": {"observed_at": "2026-08-14T00:00:00Z"},
            "status": "active",
            "presentation": {},
            "extensions": {},
            "metadata": {},
        }],
        "groups": [],
        "trace_ref": None,
        "extensions": {},
    }


class Response:
    status = 200
    headers = {}

    def __init__(self, body):
        self.body = body

    def read(self, _limit):
        return self.body

    def close(self):
        pass


class Opener:
    def __init__(self, response):
        self.response = response
        self.request = None
        self.timeout = None

    def open(self, request, timeout):
        self.request = request
        self.timeout = timeout
        return self.response


class KnowledgeProjectionBridgeTest(unittest.TestCase):
    def test_real_client_reaches_dedicated_projection_listener(self):
        import projection_server

        projection_server.TOKEN = "projection-token"
        projection_server.ALLOWED = ("project/frank",)
        projection_server.VAULT_DIR = ""
        projection_server.GRAPHIFY_DIR = ""
        projection_server.Handler.backend = type(
            "Backend",
            (),
            {
                "projection_records": lambda self, project: [{
                    "group_id": project,
                    "uuid": "memory-1",
                    "name": "Memory",
                }],
            },
        )()
        server = projection_server.ThreadingHTTPServer(("127.0.0.1", 0), projection_server.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = "http://127.0.0.1:%d/v2/knowledge/projection" % server.server_port
        try:
            client = KnowledgeProjectionClient(base_url, "projection-token", ["project/frank"])
            payload = client.fetch("frank")
            self.assertEqual(validate_knowledge_graph(payload, project_id="frank")["lens"], KNOWLEDGE_LENS)
            self.assertEqual(payload["subject"], {"kind": "project", "id": "frank"})

            for suffix in (
                "?project=project/frank",
                "?project=project/frank&lens=tool.pipeline",
                "?project=project/frank&lens=knowledge.combined&lens=knowledge.combined",
                "?project=project/frank&lens=knowledge.combined&extra=nope",
            ):
                request = urllib.request.Request(
                    base_url + suffix,
                    headers={"Authorization": "Bearer projection-token"},
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_v2_validates_and_rejects_cross_project_secret_markup_and_bad_references(self):
        self.assertEqual(validate_knowledge_graph(graph_fixture(), project_id="acme")["lens"], KNOWLEDGE_LENS)
        for mutation in (
            lambda value: value["subject"].update(id="other"),
            lambda value: value["nodes"][0].update(metadata={"password": "secret"}),
            lambda value: value["nodes"][0].update(metadata={"label": "<b>unsafe</b>"}),
            lambda value: value["edges"][0].update(to="g_acme/node:missing"),
        ):
            value = copy.deepcopy(graph_fixture())
            mutation(value)
            with self.assertRaises(ProviderUnavailable):
                validate_knowledge_graph(value, project_id="acme")

    def test_client_binds_bearer_request_and_rejects_oversized_response(self):
        opener = Opener(Response(json.dumps(graph_fixture()).encode()))
        client = KnowledgeProjectionClient("http://projection", "do-not-log", ["project/acme"], opener=opener)
        self.assertEqual(client.fetch("acme")["subject"]["id"], "acme")
        self.assertIn("Bearer do-not-log", opener.request.headers["Authorization"])
        parsed = urlsplit(opener.request.full_url)
        self.assertEqual(parsed.path, "")
        self.assertEqual(parse_qs(parsed.query), {"project": ["project/acme"], "lens": [KNOWLEDGE_LENS]})
        self.assertEqual(opener.timeout, 2.5)

        oversized = Response(b"x")
        oversized.headers = {"Content-Length": str(MAX_V2_BODY_BYTES + 1)}
        with self.assertRaises(ProviderUnavailable):
            KnowledgeProjectionClient("http://projection", "token", ["acme"], opener=Opener(oversized)).fetch("acme")

    def test_project_allowlist_uses_the_shared_64_character_boundary(self):
        valid = "a" + "b" * 63
        self.assertTrue(KnowledgeProjectionClient("http://projection", "token", [valid]).configured_for(valid))
        with self.assertRaises(ValueError):
            KnowledgeProjectionClient("http://projection", "token", [valid + "c"])

    def test_window_compose_does_not_mount_vault(self):
        compose = (Path(__file__).resolve().parents[1] / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertNotIn("/srv/vault:/vps/srv/vault", compose)
        self.assertIn("/projects:/vps/projects:ro", compose)
        self.assertIn("/srv/skills:/vps/srv/skills:ro", compose)


if __name__ == "__main__":
    unittest.main()
