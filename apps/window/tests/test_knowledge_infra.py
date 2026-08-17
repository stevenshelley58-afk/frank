import json
import inspect
import tempfile
import unittest
import threading
import urllib.request
import urllib.error
from unittest.mock import patch
from pathlib import Path


ROOT = Path(__file__).parents[1] / "infra" / "knowledge"


class KnowledgeInfraContractTests(unittest.TestCase):
    def test_vault_projection_is_content_free_and_deterministic(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from vault_projection import project

        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"
            vault.mkdir()
            (vault / "z.md").write_text("# One #Tag\nSee [[Alpha|label]] and [[Alpha]].\n", encoding="utf-8")
            (vault / "a.md").write_text("secret body", encoding="utf-8")
            destination = Path(temp) / "projection.json"
            first = project(vault, destination)
            second = project(vault, destination)
            self.assertEqual(first, second)
            self.assertFalse(first["content"])
            self.assertEqual([note["path"] for note in first["notes"]], ["a.md", "z.md"])
            self.assertEqual(first["notes"][1]["wikilinks"], ["Alpha"])
            self.assertEqual(first["notes"][1]["tags"], ["tag"])
            self.assertNotIn("secret body", destination.read_text(encoding="utf-8"))

    def test_projection_skips_symlinks_and_oversized_notes(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from vault_projection import project
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"
            vault.mkdir()
            outside = Path(temp) / "outside.md"
            outside.write_text("outside", encoding="utf-8")
            try:
                (vault / "escape.md").symlink_to(outside)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            (vault / "large.md").write_bytes(b"x" * (2 * 1024 * 1024 + 1))
            (vault / "malformed.md").write_bytes(b"\xff\xfe")
            result = project(vault, Path(temp) / "projection.json")
            self.assertEqual(result["notes"], [])

    def test_projection_rejects_destination_inside_vault(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from vault_projection import project
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"; vault.mkdir()
            with self.assertRaises(ValueError): project(vault, vault / "projection.json")

    def test_pins_and_private_bindings_are_explicit(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
        compose = (ROOT / "compose.yml").read_text(encoding="utf-8")
        self.assertIn("graphiti-core==0.29.3", requirements)
        self.assertIn("graphifyy==0.9.45", requirements)
        self.assertIn("NEO4J_IMAGE", compose)
        self.assertIn("immutable Neo4j image digest", compose)
        self.assertIn('127.0.0.1:7687:7687', compose)
        self.assertIn('127.0.0.1:8091:8091', compose)
        self.assertIn('BIND_PORT: 8092', compose)
        self.assertIn('frank-knowledge-projection', compose)
        self.assertIn('knowledge-egress', compose)
        self.assertIn("build:", compose)

    def test_docs_preserve_frank_hermes_boundary(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        contract = (ROOT / "hermes-graphiti-provider.md").read_text(encoding="utf-8")
        self.assertIn("Frank may consume only an explicitly authorised", readme)
        self.assertIn("Frank receives only an\nauthorised projection", contract)
        self.assertIn("corrections", contract)
        self.assertIn("/readyz", contract)

    def test_provider_contract_rejects_cross_namespace_requests(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from provider_contract import MemoryRequest

        MemoryRequest("project/acme", "request-1", "search").validate()
        with self.assertRaises(ValueError):
            MemoryRequest("profile/default", "request-1", "search").validate()
        with self.assertRaises(ValueError):
            MemoryRequest("project/acme", "request-1", "raw-cypher").validate()

    def test_provider_http_namespace_auth_and_bounds(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import provider_server
        class Backend:
            def ready(self): return True
            def call(self, operation, namespace, payload): return {"operation": operation, "namespace": namespace}
        provider_server.TOKEN = "test-token"
        provider_server.ALLOWED = ("project/acme",)
        provider_server.Handler.backend = Backend()
        server = provider_server.ThreadingHTTPServer(("127.0.0.1", 0), provider_server.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = "http://127.0.0.1:%d/v1/search" % server.server_port
        try:
            request = urllib.request.Request(url, data=json.dumps({"request_id":"request-1", "query":"hello"}).encode(), method="POST", headers={"Authorization":"Bearer test-token", "X-Hermes-Namespace":"project/acme", "Content-Type":"application/json"})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(json.loads(response.read())["namespace"], "project/acme")
            bad = urllib.request.Request(url, data=b"{}", method="POST", headers={"Authorization":"Bearer test-token", "X-Hermes-Namespace":"project/acme", "Content-Length":"1048577"})
            with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(bad)
            self.assertEqual(error.exception.code, 413)
        finally:
            server.shutdown(); thread.join(timeout=2); server.server_close()

    def test_hermes_plugin_calls_private_gateway(self):
        import sys
        import types
        agent = types.ModuleType("agent"); memory = types.ModuleType("agent.memory_provider")
        class MemoryProvider: pass
        memory.MemoryProvider = MemoryProvider; agent.memory_provider = memory
        sys.modules["agent"] = agent; sys.modules["agent.memory_provider"] = memory
        sys.path.insert(0, str(ROOT / "hermes_plugin"))
        import __init__ as plugin
        provider = plugin.GraphitiMemoryProvider()
        for method in ("initialize", "system_prompt_block", "prefetch", "sync_turn", "get_tool_schemas", "handle_tool_call", "shutdown"):
            self.assertTrue(callable(getattr(provider, method)))
        with patch.object(plugin, "_call", return_value={"accepted": True}) as mocked:
            self.assertEqual(provider.add("project/acme", "request-1", {"user_content":"x", "assistant_content":"y"}), {"accepted": True})
            mocked.assert_called_once_with("POST", "/v1/episodes", "project/acme", {"request_id":"request-1", "user_content":"x", "assistant_content":"y"})

    def _plugin(self):
        import sys
        import types

        agent = types.ModuleType("agent")
        memory = types.ModuleType("agent.memory_provider")

        class MemoryProvider:
            pass

        memory.MemoryProvider = MemoryProvider
        agent.memory_provider = memory
        sys.modules["agent"] = agent
        sys.modules["agent.memory_provider"] = memory
        sys.path.insert(0, str(ROOT / "hermes_plugin"))
        import __init__ as plugin

        return plugin

    def test_plugin_matches_hermes_abc_and_register_contract(self):
        plugin = self._plugin()
        signatures = {
            "initialize": "initialize",
            "prefetch": "prefetch",
            "sync_turn": "sync_turn",
        }
        for method in signatures:
            parameters = list(inspect.signature(getattr(plugin.GraphitiMemoryProvider, method)).parameters.values())
            self.assertEqual(parameters[0].name, "self")
            self.assertEqual(parameters[1].name, "session_id" if method == "initialize" else ("query" if method == "prefetch" else "user_content"))
        sync_parameters = inspect.signature(plugin.GraphitiMemoryProvider.sync_turn).parameters
        self.assertEqual(list(sync_parameters)[0:3], ["self", "user_content", "assistant_content"])
        self.assertEqual(sync_parameters["session_id"].kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertEqual(sync_parameters["messages"].kind, inspect.Parameter.KEYWORD_ONLY)
        register_parameters = inspect.signature(plugin.register).parameters
        self.assertEqual(list(register_parameters), ["ctx"])
        schema = plugin.GraphitiMemoryProvider().get_config_schema()
        self.assertIsInstance(schema, list)
        self.assertEqual({field["key"] for field in schema}, {"provider_url", "provider_token", "namespace"})
        for field in schema:
            self.assertIn(field["type"], {"text", "integer", "number", "boolean"})
            self.assertIn("required", field)
            self.assertIn("secret", field)

    def test_prefetch_only_injects_matching_current_query(self):
        plugin = self._plugin()
        provider = plugin.GraphitiMemoryProvider()
        with patch.dict("os.environ", {
            "HERMES_GRAPHITI_PROVIDER_URL": "http://127.0.0.1:8091",
            "HERMES_GRAPHITI_PROVIDER_TOKEN": "token",
            "HERMES_GRAPHITI_NAMESPACE": "project/acme",
            "HERMES_ALLOWED_NAMESPACES": "project/acme",
        }, clear=False):
            provider.initialize("session")
            first_started = threading.Event()
            release_first = threading.Event()

            def search(namespace, request_id, query, limit=20):
                if query == "old":
                    first_started.set()
                    release_first.wait(1)
                return {"query": query}

            with patch.object(provider, "search", side_effect=search):
                provider.queue_prefetch("old")
                self.assertTrue(first_started.wait(1))
                provider.queue_prefetch("new")
                release_first.set()
                self.assertEqual(json.loads(provider.prefetch("new"))["query"], "new")
            provider.shutdown()

    def test_sync_worker_is_separate_and_bounded(self):
        plugin = self._plugin()
        provider = plugin.GraphitiMemoryProvider()
        with patch.dict("os.environ", {
            "HERMES_GRAPHITI_PROVIDER_URL": "http://127.0.0.1:8091",
            "HERMES_GRAPHITI_PROVIDER_TOKEN": "token",
            "HERMES_GRAPHITI_NAMESPACE": "project/acme",
            "HERMES_ALLOWED_NAMESPACES": "project/acme",
        }, clear=False):
            provider.initialize("session")
            active = 0
            maximum = 0
            lock = threading.Lock()
            release = threading.Event()

            def add(*args):
                nonlocal active, maximum
                with lock:
                    active += 1
                    maximum = max(maximum, active)
                release.wait(1)
                with lock:
                    active -= 1
                return {"accepted": True}

            with patch.object(provider, "add", side_effect=add), patch.object(
                provider, "search", return_value={"results": []}
            ):
                provider.queue_prefetch("query")
                provider.sync_turn("u", "a")
                provider.sync_turn("u2", "a2")
                release.set()
                provider.shutdown()
            self.assertLessEqual(maximum, 1)

    def test_gateway_rejects_unknown_fields_and_exact_namespace(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import provider_server

        class Backend:
            def ready(self):
                return True

            def call(self, operation, namespace, payload):
                return {"operation": operation, "namespace": namespace}

        provider_server.TOKEN = "test-token"
        provider_server.ALLOWED = ("project/acme",)
        provider_server.Handler.backend = Backend()
        server = provider_server.ThreadingHTTPServer(("127.0.0.1", 0), provider_server.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = "http://127.0.0.1:%d/v1/search" % server.server_port
        try:
            def post(namespace, payload, token="test-token"):
                request = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode(),
                    method="POST",
                    headers={
                        "Authorization": "Bearer " + token,
                        "X-Hermes-Namespace": namespace,
                        "Content-Type": "application/json",
                    },
                )
                return urllib.request.urlopen(request)

            with self.assertRaises(urllib.error.HTTPError) as error:
                post("project/acme", {"request_id": "request-1", "query": "x", "extra": "no"})
            self.assertEqual(error.exception.code, 400)
            with self.assertRaises(urllib.error.HTTPError) as error:
                post("project/other", {"request_id": "request-1", "query": "x"})
            self.assertEqual(error.exception.code, 403)
            with self.assertRaises(urllib.error.HTTPError) as error:
                post("project/acme", {"request_id": "request-1", "query": "x"}, token="wrong")
            self.assertEqual(error.exception.code, 401)
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_search_projection_is_json_safe_and_namespace_scoped(self):
        import sys
        from datetime import datetime, timezone
        sys.path.insert(0, str(ROOT))
        from provider_server import project_search_hit

        class Weird:
            def __str__(self):
                return "secret should not be serialized"

        class Hit:
            group_id = "project/acme"
            uuid = "id"
            name = "name"
            fact = "safe fact"
            valid_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
            invalid_at = None
            created_at = Weird()
            expired_at = None
            source_node_uuid = None
            target_node_uuid = None

        result = project_search_hit(Hit(), "project/acme")
        json.dumps(result)
        self.assertIsNone(result["created_at"])
        self.assertIsNone(project_search_hit(Hit(), "project/other"))

    def test_graphiti_client_closes_on_operation_error(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import provider_server

        class EpisodeType:
            json = "json"

        class Client:
            def __init__(self):
                self.closed = False

            async def add_episode(self, **kwargs):
                raise RuntimeError("backend failure")

            async def close(self):
                self.closed = True

        client = Client()
        class Graphiti:
            def __new__(cls, *args, **kwargs):
                return client

        backend = object.__new__(provider_server.GraphitiBackend)
        backend._uri = "bolt://neo4j"
        backend._user = "neo4j"
        backend._password = "password"
        backend._graphiti = Graphiti
        backend._episode_type = EpisodeType
        with self.assertRaises(RuntimeError):
            backend.call("episode", "project/acme", {
                "request_id": "request-1",
                "user_content": "u",
                "assistant_content": "a",
            })
        self.assertTrue(client.closed)

    def test_projection_adapter_uses_direct_bounded_neo4j_driver(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import projection_server

        calls = []

        class Record:
            def __init__(self, value):
                self.value = value

            def data(self):
                return self.value

        class Result:
            def __iter__(self):
                return iter([
                    Record({"uuid": "memory-1", "name": "Memory", "group_id": "project/acme"}),
                    Record({"uuid": None, "name": None, "group_id": "project/acme", "source_node_uuid": "memory-1", "target_node_uuid": "memory-2"}),
                ])

        class Session:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def run(self, query, **params):
                calls.append((query, params))
                return Result()

        class Driver:
            def session(self): return Session()
            def close(self): calls.append(("closed", {}))

        def factory(uri, **kwargs):
            calls.append((uri, kwargs))
            return Driver()

        backend = projection_server.Neo4jProjectionBackend(
            "bolt://neo4j:7687", "neo4j", "password", driver_factory=factory
        )
        records = backend.projection_records("project/acme")
        backend.close()
        self.assertEqual(len(records), 2)
        self.assertEqual(calls[0], ("bolt://neo4j:7687", {"auth": ("neo4j", "password")}))
        query, params = calls[1]
        self.assertEqual(params, {"group_id": "project/acme"})
        self.assertIn("UNION ALL", query)
        self.assertIn("LIMIT 10000", query)
        self.assertNotIn("episode_body", query)
        self.assertNotIn("fact", query)
        self.assertEqual(calls[-1][0], "closed")

    def test_correction_target_must_exist_in_the_same_namespace(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import provider_server

        class EpisodeType:
            json = "json"

        class Driver:
            async def execute_query(self, query, **params):
                self.query = query
                self.params = params
                if params["group_id"] == "project/acme" and params["memory_id"] == "memory-1":
                    return type("Result", (), {"records": [{"uuid": "memory-1"}]})()
                return type("Result", (), {"records": []})()

        class Client:
            def __init__(self):
                self.driver = Driver()
                self.closed = False
                self.episodes = []

            async def add_episode(self, **kwargs):
                self.episodes.append(kwargs)

            async def close(self):
                self.closed = True

        clients = []

        class Graphiti:
            def __new__(cls, *args, **kwargs):
                client = Client(); clients.append(client); return client

        backend = object.__new__(provider_server.GraphitiBackend)
        backend._uri = "bolt://neo4j"
        backend._user = "neo4j"
        backend._password = "password"
        backend._graphiti = Graphiti
        backend._episode_type = EpisodeType

        result = backend.call("correction_episode", "project/acme", {
            "request_id": "request-1",
            "memory_id": "memory-1",
            "replacement": "updated",
        })
        self.assertTrue(result["accepted"])
        self.assertEqual(len(clients[-1].episodes), 1)
        self.assertTrue(clients[-1].closed)

        with self.assertRaises(ValueError):
            backend.call("correction_episode", "project/other", {
                "request_id": "request-2",
                "memory_id": "memory-1",
                "replacement": "must not cross namespaces",
            })
        self.assertTrue(clients[-1].closed)

    def test_startup_environment_gates(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import provider_server
        required = {
            "HERMES_GRAPHITI_PROVIDER_TOKEN": "token",
            "HERMES_ALLOWED_NAMESPACES": "project/acme",
            "OPENAI_API_KEY": "secret",
            "NEO4J_URI": "bolt://neo4j:7687",
            "NEO4J_USER": "neo4j",
            "NEO4J_PASSWORD": "password",
        }
        with patch.dict("os.environ", required, clear=True):
            self.assertEqual(provider_server.validate_startup_config()[1], ("project/acme",))
            for key in ("HERMES_GRAPHITI_PROVIDER_TOKEN", "HERMES_ALLOWED_NAMESPACES", "OPENAI_API_KEY"):
                broken = dict(required)
                broken.pop(key)
                with patch.dict("os.environ", broken, clear=True):
                    with self.assertRaises(RuntimeError):
                        provider_server.validate_startup_config()

    def test_graphify_and_vault_path_safety(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from graphify_supervisor import validate_inputs
        from vault_projection import project

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project_dir = root / "project"
            project_dir.mkdir()
            (project_dir / ".graphifyignore").write_text(
                ".env\n*.db\n*.sqlite*\nnode_modules/\nout\n", encoding="utf-8"
            )
            output = root / "out"
            self.assertEqual(validate_inputs(project_dir, output)[1], output)
            vault = root / "vault"
            vault.mkdir()
            symlink_parent = root / "link"
            try:
                symlink_parent.symlink_to(root, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            with self.assertRaises(ValueError):
                project(vault, symlink_parent / "projection.json")

    def test_docs_and_compose_do_not_claim_unsafe_capabilities(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        contract = (ROOT / "hermes-graphiti-provider.md").read_text(encoding="utf-8")
        compose = (ROOT / "compose.yml").read_text(encoding="utf-8")
        self.assertNotIn("CRUD", readme)
        self.assertNotIn("DELETE /v1", contract)
        self.assertIn("internal: true", compose)
        self.assertIn("healthcheck:", compose)

    def test_combined_v2_projection_is_bounded_content_free_and_deterministic(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from knowledge_projection import build_combined_projection

        graphiti = [{
            "group_id": "project/frank", "uuid": "a", "name": "Alpha",
            "fact": "Alpha relates to Beta", "target_node_uuid": "b",
            "valid_at": "2026-01-01T00:00:00Z", "episode_body": "DO NOT LEAK",
        }, {"group_id": "project/other", "uuid": "x", "name": "Other"}]
        vault = {"schema": "frank.vault-projection.v1", "content": False, "notes": [{
            "path": "Alpha.md", "sha256": "a" * 64, "wikilinks": ["Beta"], "tags": ["safe"],
            "body": "DO NOT LEAK",
        }]}
        graphify = {"nodes": [{"id": "main", "label": "main.py", "source_file": "main.py", "content": "LEAK"}],
                    "links": []}
        first = build_combined_projection("project/frank", graphiti=graphiti, vault=vault, graphify=graphify,
                                         generated_at="2026-01-01T00:00:00Z")
        second = build_combined_projection("project/frank", graphiti=graphiti, vault=vault, graphify=graphify,
                                          generated_at="2026-01-01T00:00:00Z")
        self.assertEqual(first, second)
        self.assertEqual(set(first), {"schema", "graph_id", "graph_revision", "generated_at", "provider", "subject", "scope", "lens", "capabilities", "nodes", "edges", "groups", "trace_ref", "extensions"})
        self.assertEqual(first["schema"], "schema://frank.graph/v2")
        self.assertEqual(first["subject"], first["scope"], "project/frank")
        self.assertEqual(first["lens"], "knowledge.combined")
        serialized = json.dumps(first)
        self.assertNotIn("DO NOT LEAK", serialized)
        self.assertNotIn("episode_body", serialized)
        self.assertNotIn("Alpha relates to Beta", serialized)
        self.assertEqual(first["subject"], {"kind": "project", "id": "frank"})
        for item in first["nodes"] + first["edges"]:
            self.assertEqual(set(item["source"]), {"provider_id", "provider_version", "source_type", "source_ref", "sha256"})
            self.assertNotRegex(item["source"]["source_ref"], r"^(?:/|[A-Za-z]:)")

    def test_graphify_adapter_current_export_and_fail_closed(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from knowledge_projection import adapt_graphify_export
        payload = {"directed": False, "nodes": [
            {"id": "main", "label": "main.py", "source_file": "main.py", "source_location": "L1", "snippet": "secret"},
            {"id": "run", "label": "run", "source_file": "main.py", "source_location": "L2", "content": "secret"},
        ], "links": [{"source": "main", "target": "run", "relation": "contains", "content": "secret"}]}
        nodes, edges = adapt_graphify_export(payload, "project/frank")
        self.assertEqual(len(nodes), 2); self.assertEqual(len(edges), 1)
        self.assertNotIn("snippet", json.dumps(nodes)); self.assertNotIn("content", json.dumps(edges))
        self.assertEqual(adapt_graphify_export({"nodes": [], "edges": []}, "project/frank"), ([], []))

    def test_mutation_gateway_has_no_projection_routes(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import provider_server
        provider_server.TOKEN = "provider-token"
        provider_server.ALLOWED = ("project/frank",)
        provider_server.Handler.backend = object()
        server = provider_server.ThreadingHTTPServer(("127.0.0.1", 0), provider_server.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for path in ("/v2/knowledge/projection?project=project/frank", "/v1/knowledge/projection", "/v1/projection"):
                request = urllib.request.Request(
                    "http://127.0.0.1:%d%s" % (server.server_port, path),
                    headers={"Authorization": "Bearer provider-token"},
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown(); thread.join(timeout=2); server.server_close()

    def test_projection_listener_is_read_only_and_separate(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import projection_server
        projection_server.TOKEN = "projection-token"
        projection_server.ALLOWED = ("project/frank",)
        projection_server.Handler.backend = type("Backend", (), {"projection_records": lambda self, project: []})()
        server = projection_server.ThreadingHTTPServer(("127.0.0.1", 0), projection_server.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = "http://127.0.0.1:%d/v2/knowledge/projection?project=project/frank&lens=knowledge.combined" % server.server_port
        try:
            request = urllib.request.Request(url, headers={"Authorization": "Bearer projection-token"})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(json.loads(response.read())["schema"], "schema://frank.graph/v2")
            post = urllib.request.Request(url, data=b"{}", method="POST", headers={"Authorization": "Bearer projection-token"})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(post)
            self.assertEqual(error.exception.code, 405)
        finally:
            server.shutdown(); thread.join(timeout=2); server.server_close()

    def test_operator_runner_is_source_safe_and_writes_projection(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import knowledge_runner
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "source"; vault = root / "vault"; output = root / "knowledge"
            source.mkdir(); vault.mkdir(); (source / ".graphifyignore").write_text(".env\n*.db\n*.sqlite*\nnode_modules/\ngraphify\n", encoding="utf-8")
            (source / "main.py").write_text("def main():\n    return 1\n", encoding="utf-8")
            (vault / "note.md").write_text("# Safe #tag", encoding="utf-8")
            def fake_graphify(_source, destination):
                graph = destination / "graphify-out"; graph.mkdir(parents=True)
                (graph / "graph.json").write_text(json.dumps({"nodes": [{"id": "main", "label": "main.py", "source_file": "main.py"}], "links": []}), encoding="utf-8")
                return 0
            with patch.object(knowledge_runner, "run_graphify", side_effect=fake_graphify):
                result = knowledge_runner.run_project("project/frank", source, vault, output)
            self.assertEqual(result["schema"], "schema://frank.graph/v2")
            self.assertTrue((output / "project/frank/projection.json").is_file())
            self.assertFalse((source / "graphify-out").exists())

    def test_deploy_contract_gates_readiness_and_preserves_config(self):
        deploy = (ROOT / "deploy.sh").read_text(encoding="utf-8")
        check = (ROOT / "check.sh").read_text(encoding="utf-8")
        compose = (ROOT / "compose.yml").read_text(encoding="utf-8")
        self.assertIn("FRANK_KNOWLEDGE_PROJECTION_TOKEN", deploy)
        self.assertIn("config.yaml.knowledge.", deploy)
        self.assertIn("check.sh", deploy)
        self.assertIn("/readyz", check)
        self.assertIn("FRANK_KNOWLEDGE_ROOT", compose)
        self.assertIn("/knowledge:ro", compose)

    def test_activation_is_fixed_namespace_root_gated_and_serialized(self):
        deploy = (ROOT / "deploy.sh").read_text(encoding="utf-8")
        check = (ROOT / "check.sh").read_text(encoding="utf-8")
        helper = (ROOT / "root-helper.sh").read_text(encoding="utf-8")
        installer = (ROOT / "install-root-helper.sh").read_text(encoding="utf-8")
        self.assertIn("FIXED_PROJECT=project/frank", deploy)
        self.assertIn("flock -n 9", deploy)
        self.assertIn("APPROVED_SHA=/var/lib/frank/release/approved-sha", deploy)
        self.assertIn('git -C "$REPO_ROOT" status --porcelain --untracked-files=all', deploy)
        self.assertIn('"$approved_sha" == "$release_sha"', deploy)
        self.assertIn("HERMES_ALLOWED_NAMESPACES must be exactly project/frank", deploy)
        self.assertIn("FRANK_KNOWLEDGE_ALLOWED_PROJECTS must be exactly project/frank", deploy)
        self.assertIn("projection accepted: nodes=%d edges=%d", check)
        self.assertNotIn("read().decode())", check)
        self.assertIn("[[ $# -eq 0 ]]", helper)
        self.assertIn("env -i", helper)
        self.assertIn('git -C "$REPO_ROOT" rev-parse HEAD', helper)
        self.assertIn('"$approved" == "$sha"', helper)
        self.assertIn("NOPASSWD: %s", installer)
        self.assertNotIn("NOPASSWD: ALL", installer)

    def test_secret_parser_rejects_duplicates_unknown_control_and_symlinks(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from secret_env import parse

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "knowledge.env"
            def write(value):
                path.write_bytes(value.encode("utf-8"))
                path.chmod(0o600)
            write("HERMES_ALLOWED_NAMESPACES=project/frank\n")
            self.assertEqual(parse(path, "knowledge")["HERMES_ALLOWED_NAMESPACES"], "project/frank")
            for invalid in (
                "HERMES_ALLOWED_NAMESPACES=project/frank\nHERMES_ALLOWED_NAMESPACES=project/frank\n",
                "UNKNOWN=value\n",
                "HERMES_ALLOWED_NAMESPACES=project/frank\r\n",
                "HERMES_ALLOWED_NAMESPACES=\n",
            ):
                write(invalid)
                with self.assertRaises(ValueError):
                    parse(path, "knowledge")
            try:
                link = Path(temp) / "link"
                link.symlink_to(path)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            with self.assertRaises(ValueError):
                parse(link, "knowledge")
            broken = Path(temp) / "broken"
            broken.symlink_to(Path(temp) / "missing")
            with self.assertRaises(ValueError):
                parse(broken, "knowledge", allow_missing=True)

    def test_projection_runtime_is_fixed_to_frank(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import projection_server
        with patch.dict("os.environ", {
            "FRANK_KNOWLEDGE_PROJECTION_TOKEN": "token",
            "FRANK_KNOWLEDGE_ALLOWED_PROJECTS": "project/frank",
        }, clear=True):
            self.assertEqual(projection_server.validate_config()[1], ("project/frank",))
        with patch.dict("os.environ", {
            "FRANK_KNOWLEDGE_PROJECTION_TOKEN": "token",
            "FRANK_KNOWLEDGE_ALLOWED_PROJECTS": "project/acme",
        }, clear=True):
            with self.assertRaises(RuntimeError):
                projection_server.validate_config()


if __name__ == "__main__":
    unittest.main()
