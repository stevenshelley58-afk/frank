import copy
import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flask import Flask

from graph.contract import normalize_manifest
from graph.provider import ProviderUnavailable, ReadOnlyProvider, create_blueprint, redact_allowlisted_fields


TRACE_ID = "0123456789abcdef0123456789abcdef"
SAFE_HASH = "sha256:" + "a" * 64
MANIFEST = {
    "schema": "schema://frank.tool-app-manifest/v1",
    "id": "fixture-tool",
    "version": "0.1.1",
    "name": "Fixture Tool",
    "description": "Fixture.",
    "scopes": ["global", "project"],
    "settings": {"schema": "schema://frank.tool-app-settings/v1", "properties": {}},
    "pipelines": [{
        "schema": "schema://frank.tool-app-pipeline/v1",
        "id": "main",
        "version": "0.1.1",
        "nodes": [
            {"id": "prepare", "kind": "step"},
            {"id": "publish", "kind": "step"},
            {"id": "archive", "kind": "step"},
        ],
        "edges": [
            {"from": "prepare", "to": "publish"},
            {"from": "prepare", "to": "archive"},
        ],
    }],
}
GRAPH = normalize_manifest(MANIFEST, as_of="2026-08-14T00:00:00Z", permissions=["inspect"])
ALLOWLIST = {
    "attributes": [
        "gen_ai.request.model", "gen_ai.usage.input_tokens",
        "gen_ai.input.messages", "gen_ai.input.messages.id", "systemPrompt",
        "gen_ai.completion", "gen_ai.completions", "llm.response",
        "gen_ai.tool.call.args", "gen_ai.tool.definitions", "gen_ai.tool.definitions_count",
        "llm.tools", "tool.request", "tool.response", "function.arguments", "function.result",
        "function.body", "legacy.prompt", "legacy.completion", "legacy.input", "legacy.output",
        "legacy", "gen_ai",
    ],
    "fields": ["prompt_hash", "tool_ref", "completion_count", "usage", "cost", "prompt", "input", "tool_results", "llm.response"],
}
UNTRUSTED_FIELDS = {
    "prompt_hash": SAFE_HASH,
    "tool_ref": "tool-catalog:one",
    "completion_count": 2,
    "usage": {"prompt_tokens": 4, "completion_tokens": 8},
    "prompt": "never expose prompt",
    "input": "never expose model input",
    "attributes": {
        "gen_ai.request.model": "gpt-safe",
        "gen_ai.usage.input_tokens": 12,
        "gen_ai.input.messages": [{"content": "never expose message"}],
        "gen_ai.input.messages.id": "never-expose-message-id",
        "systemPrompt": "never expose system prompt",
        "gen_ai.completion": "never expose completion",
        "gen_ai.completions": ["never expose completions"],
        "llm.response": "never expose legacy response",
        "gen_ai.tool.call.args": {"query": "never expose args"},
        "gen_ai.tool.definitions": [{"name": "never expose definition"}],
        "gen_ai.tool.definitions_count": 1,
        "llm.tools": [{"name": "never expose tool"}],
        "tool.request": {"body": "never expose request"},
        "tool.response": {"body": "never expose response"},
        "function.arguments": {"query": "never expose function args"},
        "function.result": "never expose function result",
        "function.body": "never expose function body",
        "legacy.prompt": "never expose legacy prompt",
        "legacy.completion": "never expose legacy completion",
        "legacy.input": "never expose legacy input",
        "legacy.output": "never expose legacy output",
        "legacy": {"llm": {"response": "never expose nested legacy response"}, "tool": {"request": "never expose nested request"}},
        "gen_ai": {"completion": "never expose nested completion"},
        "unknown": "not allowlisted",
    },
}


class GraphProviderTest(unittest.TestCase):
    def client(self, provider):
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(provider))
        return app.test_client()

    def graph_client(self, graph=GRAPH):
        return self.client(ReadOnlyProvider(graph_reader=lambda **kwargs: copy.deepcopy(graph)))

    def test_unregistered_provider_fails_closed_without_fallback_store(self):
        response = self.client(ReadOnlyProvider()).get("/api/graphs/tool/fixture-tool")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["status"], "unavailable")

    def test_graph_endpoint_is_get_only_and_binds_request_identity(self):
        seen = {}

        def read_graph(**kwargs):
            seen.update(kwargs)
            return copy.deepcopy(GRAPH)

        client = self.client(ReadOnlyProvider(graph_reader=read_graph))
        response = client.get("/api/graphs/tool/fixture-tool?lens=tool.pipeline")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(seen["kind"], "tool")
        self.assertEqual(client.post("/api/graphs/tool/fixture-tool").status_code, 405)
        self.assertEqual(client.get("/api/graphs/tool/fixture-tool?source=/vps/secrets").status_code, 400)
        self.assertEqual(client.get("/api/graphs/unknown/fixture-tool").status_code, 404)
        self.assertEqual(client.get(f"/api/graphs/tool/fixture-tool?trace_id={TRACE_ID}").status_code, 400)

    def test_graph_rejects_cross_entity_scope_lens_trace_and_revision_projections(self):
        cases = []
        wrong_subject = copy.deepcopy(GRAPH)
        wrong_subject["subject"]["id"] = "other-tool"
        cases.append((wrong_subject, "/api/graphs/tool/fixture-tool?lens=tool.pipeline"))
        wrong_graph_id = copy.deepcopy(GRAPH)
        wrong_graph_id["graph_id"] = "tool:other-tool"
        cases.append((wrong_graph_id, "/api/graphs/tool/fixture-tool?lens=tool.pipeline"))
        wrong_lens = copy.deepcopy(GRAPH)
        wrong_lens["lens"] = "run.trace"
        cases.append((wrong_lens, "/api/graphs/tool/fixture-tool?lens=tool.pipeline"))
        wrong_scope = copy.deepcopy(GRAPH)
        wrong_scope["scope"] = {"kind": "project", "id": "other"}
        cases.append((wrong_scope, "/api/graphs/tool/fixture-tool?lens=tool.pipeline"))
        cases.append((GRAPH, "/api/graphs/tool/fixture-tool?lens=tool.pipeline&settings_revision_id=4"))
        for graph, path in cases:
            with self.subTest(path=path):
                self.assertEqual(self.graph_client(graph).get(path).status_code, 503)

    def test_allowlisted_projection_blocks_standard_and_legacy_content_paths(self):
        body = {
            **redact_allowlisted_fields(copy.deepcopy(UNTRUSTED_FIELDS), ALLOWLIST["fields"]),
            "attributes": redact_allowlisted_fields(copy.deepcopy(UNTRUSTED_FIELDS["attributes"]), ALLOWLIST["attributes"]),
        }
        self.assertEqual(body["prompt_hash"], SAFE_HASH)
        self.assertEqual(body["tool_ref"], "tool-catalog:one")
        self.assertEqual(body["completion_count"], 2)
        self.assertEqual(body["usage"], {"prompt_tokens": 4, "completion_tokens": 8})
        self.assertEqual(body["attributes"]["gen_ai.request.model"], "gpt-safe")
        self.assertEqual(body["attributes"]["gen_ai.usage.input_tokens"], 12)
        for key in (
            "gen_ai.tool.definitions", "llm.tools", "tool.request", "tool.response",
            "function.arguments", "function.result", "function.body", "legacy.prompt",
            "gen_ai.tool.definitions_count",
        ):
            self.assertNotIn(key, body["attributes"])
        serialized = repr(body)
        for secret_text in (
            "never expose", "systemPrompt", "gen_ai.input.messages", "tool_results", "unknown",
            "gen_ai.completion", "gen_ai.completions", "llm.response", "gen_ai.tool.call.args",
        ):
            self.assertNotIn(secret_text, serialized)

    def test_allowlisted_projection_validates_metadata_and_denies_sensitive_suffix_aliases_first(self):
        safe = {
            "artifact_hash": SAFE_HASH,
            "trace_id": TRACE_ID,
            "receipt_ref": "receipt:one",
            "token_count": 0,
            "usage": {"input_tokens": 12, "output_tokens": 3},
            "model_version": "2026-08-14",
        }
        self.assertEqual(redact_allowlisted_fields(safe, list(safe)), safe)

        sensitive = {
            "credential_ref": "credential:one",
            "secret_id": "secret:one",
            "access_token_id": "token:one",
            "api_key_hash": SAFE_HASH,
            "password_hash": SAFE_HASH,
            "request": {"private": "body"},
            "response": {"private": "body"},
            "tool.parameters": {"private": "body"},
            "tool.parameters_hash": SAFE_HASH,
            "tool.description_id": "private-description",
            "tool.definitions_count": 4,
            "tool.args": {"private": "body"},
            "tool.results": {"private": "body"},
            "tool.request": {"private": "body"},
            "tool.response": {"private": "body"},
            "tool.body": "private body",
            "tool.schema": {"private": "definition"},
            "tools": [{"private": "definition"}],
            "function.parameters": {"private": "body"},
            "function.description": "private description",
            "function.definitions": [{"private": "body"}],
            "function.args": {"private": "body"},
            "function.results": {"private": "body"},
            "function.request": {"private": "body"},
            "function.response": {"private": "body"},
            "function.body": "private body",
            "function.schema": {"private": "definition"},
            "functions": [{"private": "definition"}],
            "model.response": "private response",
            "model.response_id": "private-response",
            "response_text": "private response",
        }
        self.assertEqual(redact_allowlisted_fields(sensitive, list(sensitive)), {})

        invalid_metadata = {
            "prompt_hash": "private prompt body",
            "token_count": "many private tokens",
            "trace_id": {"private": "body"},
            "receipt_ref": "private reference with spaces",
        }
        for key, value in invalid_metadata.items():
            with self.subTest(key=key):
                with self.assertRaises(ProviderUnavailable):
                    redact_allowlisted_fields({key: value}, [key])

        benign = {
            "artifact_hash": SAFE_HASH,
            "request_id": "request:one",
            "response_ref": "response:one",
            "receipt_ref": "receipt:one",
            "token_count": 12,
            "usage": {"input_tokens": 4, "output_tokens": 8},
        }
        self.assertEqual(redact_allowlisted_fields(benign, list(benign)), benign)

    def test_cyclic_reader_payloads_and_duplicate_node_capabilities_fail_closed(self):
        duplicate_capabilities = copy.deepcopy(GRAPH)
        duplicate_capabilities["nodes"][0]["capabilities"] = ["inspect", "inspect"]
        self.assertEqual(
            self.graph_client(duplicate_capabilities).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline").status_code,
            503,
        )

        cyclic_selection = copy.deepcopy(GRAPH)
        selection = {}
        selection["node_id"] = selection
        cyclic_selection["extensions"] = {"frank.graph.selection": selection}
        response = self.graph_client(cyclic_selection).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("RecursionError", response.get_data(as_text=True))

        cyclic_metadata = {}
        cyclic_metadata["child"] = cyclic_metadata
        with self.assertRaises(ProviderUnavailable):
            redact_allowlisted_fields({"metadata": cyclic_metadata}, ["metadata"])
        cyclic_allowlist = []
        cyclic_allowlist.append(cyclic_allowlist)
        with self.assertRaises(ProviderUnavailable):
            redact_allowlisted_fields({}, cyclic_allowlist)

    def test_shared_adversarial_validation_corpus_fails_closed_on_the_server(self):
        corpus_path = Path(__file__).resolve().parent / "fixtures" / "graph" / "adversarial-validation-corpus.json"
        corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
        for case in corpus:
            with self.subTest(case=case["id"]):
                graph = copy.deepcopy(GRAPH)
                mutations = case.get("mutations", [{"path": case.get("path"), "value": case.get("value")}])
                for mutation in mutations:
                    target = graph
                    for part in mutation["path"][:-1]:
                        target = target[part]
                    target[mutation["path"][-1]] = mutation["value"]
                response = self.graph_client(graph).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline")
                self.assertEqual(response.status_code, 503)

    def test_graph_rejects_duplicate_pipeline_edge_source_id(self):
        graph = copy.deepcopy(GRAPH)
        graph["edges"][1]["source_id"] = 0
        graph["edges"][1]["id"] = "tool:fixture-tool/pipeline:main/edge:0:prepare:archive"
        response = self.graph_client(graph).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline")
        self.assertEqual(response.status_code, 503)

    def test_graph_accepts_indexed_runtime_paths_for_duplicate_canonical_pipeline_ids(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["pipelines"].append(copy.deepcopy(manifest["pipelines"][0]))
        graph = normalize_manifest(manifest, as_of="2026-08-14T00:00:00Z")
        response = self.graph_client(graph).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual([group["id"] for group in payload["groups"]], ["main:0", "main:1"])
        self.assertEqual({node["source"]["pipeline_id"] for node in payload["nodes"]}, {"main"})

    def test_graph_accepts_canonical_ids_beyond_the_old_160_character_limit(self):
        manifest = copy.deepcopy(MANIFEST)
        long_tool_id = "t" * 161
        long_pipeline_id = "p" * 161
        long_node_ids = ["n" * 161, "m" * 161, "a" * 161]
        manifest["id"] = long_tool_id
        manifest["pipelines"][0]["id"] = long_pipeline_id
        for node, node_id in zip(manifest["pipelines"][0]["nodes"], long_node_ids):
            node["id"] = node_id
        manifest["pipelines"][0]["edges"] = [
            {"from": long_node_ids[0], "to": long_node_ids[1]},
            {"from": long_node_ids[0], "to": long_node_ids[2]},
        ]
        graph = normalize_manifest(manifest, as_of="2026-08-14T00:00:00Z")
        client = self.client(ReadOnlyProvider(graph_reader=lambda **kwargs: copy.deepcopy(graph)))
        response = client.get(f"/api/graphs/tool/{long_tool_id}?lens=tool.pipeline")
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.get_json()["edges"][0]["id"]), 639)

    def test_graph_accepts_schema_valid_generic_groups_without_adapter_specific_semantics(self):
        graph = copy.deepcopy(GRAPH)
        graph["groups"] = [{"id": "review-group", "label": "Human readable review group"}]
        graph["nodes"][0]["presentation"] = {"group_id": "review-group"}
        response = self.graph_client(graph).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline")
        self.assertEqual(response.status_code, 200)

    def test_graph_accepts_maximum_javascript_safe_settings_revision(self):
        graph = copy.deepcopy(GRAPH)
        graph["nodes"][0]["settings_revision_ref"] = {
            "schema": "schema://frank.tool-app-settings/v1",
            "scope": {"kind": "global"},
            "revision": 9_007_199_254_740_991,
        }
        client = self.graph_client(graph)
        response = client.get(
            "/api/graphs/tool/fixture-tool?lens=tool.pipeline&settings_revision_id=9007199254740991"
        )
        self.assertEqual(response.status_code, 200)

    def test_graph_accepts_maximum_javascript_safe_edge_source_and_group_order(self):
        graph = copy.deepcopy(GRAPH)
        maximum = 9_007_199_254_740_991
        graph["edges"][0]["source_id"] = maximum
        graph["edges"][0]["id"] = (
            f"tool:fixture-tool/pipeline:main/edge:{maximum}:prepare:publish"
        )
        graph["groups"] = [{"id": "review-group", "label": "Review", "order": maximum}]
        graph["nodes"][0]["presentation"] = {"group_id": "review-group"}
        response = self.graph_client(graph).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline")
        self.assertEqual(response.status_code, 200)

    def test_current_v1_registers_no_uncorrelated_trace_endpoint(self):
        client = self.client(ReadOnlyProvider())
        self.assertEqual(client.get(f"/api/traces/{TRACE_ID}").status_code, 404)
        self.assertEqual(client.post(f"/api/traces/{TRACE_ID}").status_code, 404)

    def test_graph_rejects_invalid_nested_contracts_markup_and_extensions(self):
        cases = []
        for field, mutation in (
            ("source", lambda graph: graph["nodes"][0]["source"].update({"payload": "body"})),
            ("presentation", lambda graph: graph["nodes"][0]["presentation"].update({"style": "raw"})),
            ("edge-source", lambda graph: graph["edges"].append({"bad": True})),
            ("extension", lambda graph: graph["nodes"][0].update({"extensions": {"not_namespaced": True}})),
            ("extension-body", lambda graph: graph["nodes"][0].update({"extensions": {"frank.graph.note": "arbitrary body"}})),
            ("markup", lambda graph: graph["nodes"][0].update({"label": "<b>unsafe</b>"})),
            ("control", lambda graph: graph["nodes"][0].update({"label": "bad\x01label"})),
            ("non-finite", lambda graph: graph.update({"extensions": {"frank.graph.selection": {"node_id": math.nan}}})),
        ):
            graph = copy.deepcopy(GRAPH)
            mutation(graph)
            cases.append((field, graph))
        settings_graph = normalize_manifest(
            MANIFEST,
            settings_revision={"schema": "schema://frank.tool-app-settings/v1", "scope": {"kind": "global"}, "revision": 1, "settings": {}},
            as_of="2026-08-14T00:00:00Z",
        )
        settings_graph["nodes"][0]["settings_revision_ref"]["schema"] = "wrong"
        cases.append(("settings", settings_graph))
        cyclic_groups = copy.deepcopy(GRAPH)
        cyclic_groups["groups"] = [
            {"id": "one", "label": "One", "parent_id": "two"},
            {"id": "two", "label": "Two", "parent_id": "one"},
        ]
        cases.append(("cyclic-groups", cyclic_groups))
        for label, graph in cases:
            with self.subTest(label=label):
                self.assertEqual(self.graph_client(graph).get("/api/graphs/tool/fixture-tool?lens=tool.pipeline").status_code, 503)

    def test_reader_failures_hide_internal_details(self):
        client = self.client(ReadOnlyProvider(graph_reader=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("/vps/private"))))
        response = client.get("/api/graphs/tool/fixture-tool")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("/vps/private", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
