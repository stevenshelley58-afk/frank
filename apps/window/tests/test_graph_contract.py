import copy
import hashlib
import importlib.util
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from graph.contract import (
    GraphContractError,
    canonical_manifest_sha256,
    normalize_manifest,
)


TRACE_ID = "0123456789abcdef0123456789abcdef"
MANIFEST = {
    "schema": "schema://frank.tool-app-manifest/v1",
    "id": "fixture-tool",
    "version": "0.1.1",
    "name": "Fixture Tool",
    "description": "A pure adapter fixture.",
    "scopes": ["global", "project"],
    "settings": {"schema": "schema://frank.tool-app-settings/v1", "properties": {"mode": {"type": "string"}}},
    "pipelines": [{
        "schema": "schema://frank.tool-app-pipeline/v1",
        "id": "main",
        "version": "0.1.1",
        "nodes": [{"id": "prepare", "kind": "step"}, {"id": "publish", "kind": "step"}],
        "edges": [{"from": "prepare", "to": "publish"}],
    }],
    "trace": {
        "schema": "schema://frank.tool-app-trace/v1",
        "span_prefix": "frank.fixture",
        "event_kinds": ["stage-completed"],
        "attributes": ["fixture.safe"],
    },
    "capabilities": ["display-only"],
    "domain_metadata": {"note": "not projected"},
}


def project(**overrides):
    return normalize_manifest(MANIFEST, as_of="2026-08-14T00:00:00Z", **overrides)


class GraphContractTest(unittest.TestCase):
    def test_accepts_canonical_zero_major_semver_and_requires_real_freshness(self):
        graph = project(permissions=["inspect"])
        self.assertEqual(graph["provider"]["version"], "1.0.0")
        self.assertEqual(graph["nodes"][0]["source"]["manifest_version"], "0.1.1")
        self.assertEqual(graph["capabilities"], ["inspect"])
        with self.assertRaisesRegex(GraphContractError, "freshness cannot be fabricated"):
            normalize_manifest(MANIFEST)

    def test_normalizes_flat_manifest_without_copying_domain_fields(self):
        graph = project()
        self.assertEqual(graph["schema"], "schema://frank.graph/v1")
        self.assertEqual(graph["graph_id"], "tool:fixture-tool")
        self.assertEqual([node["label"] for node in graph["nodes"]], ["prepare", "publish"])
        self.assertTrue(graph["nodes"][0]["extensions"]["frank.graph.entry"])
        self.assertFalse(graph["nodes"][1]["extensions"]["frank.graph.entry"])
        self.assertEqual(graph["edges"][0]["kind"], "control")
        self.assertNotIn("domain_metadata", repr(graph))
        self.assertEqual(graph["capabilities"], [])

    def test_pipeline_defaults_are_runtime_only_and_scope_is_explicit_without_global(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["pipelines"][0].pop("id")
        manifest["pipelines"][0].pop("version")
        graph = normalize_manifest(manifest, render_scope={"kind": "project", "id": "blockwise"}, as_of="2026-08-14T00:00:00Z")
        self.assertEqual(graph["graph_id"], "project:blockwise/tool:fixture-tool")
        self.assertIn("pipeline-0", graph["nodes"][0]["id"])
        project_only = {**MANIFEST, "scopes": ["project"]}
        with self.assertRaisesRegex(GraphContractError, "render_scope is required"):
            normalize_manifest(project_only, as_of="2026-08-14T00:00:00Z")

    def test_duplicate_source_pipeline_ids_use_runtime_only_indexed_paths_and_reject_ambiguous_spans(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["pipelines"].append(copy.deepcopy(manifest["pipelines"][0]))
        graph = normalize_manifest(manifest, as_of="2026-08-14T00:00:00Z")
        self.assertEqual([group["id"] for group in graph["groups"]], ["main:0", "main:1"])
        self.assertEqual([group["label"] for group in graph["groups"]], ["main", "main"])
        self.assertTrue(graph["nodes"][0]["id"].startswith("tool:fixture-tool/pipeline:main:0/"))
        self.assertTrue(graph["nodes"][2]["id"].startswith("tool:fixture-tool/pipeline:main:1/"))
        self.assertEqual({node["source"]["pipeline_id"] for node in graph["nodes"]}, {"main"})

        span = {
            "traceId": TRACE_ID,
            "spanId": "0123456789abcdef",
            "name": "frank.fixture.prepare",
            "attributes": {
                "frank.tool.id": "fixture-tool",
                "frank.pipeline.id": "main",
                "frank.pipeline.revision": "0.1.1",
                "frank.graph.node.id": "tool:fixture-tool/pipeline:main:0/node:prepare",
            },
            "status": {"code": "OK"},
        }
        with self.assertRaisesRegex(GraphContractError, "ambiguous"):
            normalize_manifest(manifest, spans=[span], as_of="2026-08-14T00:00:00Z")

    def test_declared_graph_ignores_any_canonical_safe_unrecognized_trace_value(self):
        for trace in (
            [],
            "display-only",
            {"schema": "schema://another.trace/v1", "safe": [1, True, None]},
            {"schema": "schema://frank.tool-app-trace/v1", "span_prefix": []},
        ):
            with self.subTest(trace=trace):
                manifest = copy.deepcopy(MANIFEST)
                manifest["trace"] = trace
                graph = normalize_manifest(manifest, as_of="2026-08-14T00:00:00Z")
                self.assertTrue(all(node["status"] == "declared" for node in graph["nodes"]))

    def test_manifest_acceptance_matches_canonical_validator_except_approved_pipeline_fallback(self):
        local_contract = Path(__file__).resolve().parents[1] / "tool_apps" / "contracts.py"
        configured_contract = os.environ.get("FRANK_CANONICAL_TOOL_CONTRACTS")
        candidates = [
            local_contract,
            Path(configured_contract) if configured_contract else None,
            Path("/tmp/frank-modular-integration/apps/window/tool_apps/contracts.py"),
        ]
        contract_path = next((path for path in candidates if path is not None and path.is_file()), None)
        if contract_path is None:
            self.skipTest("canonical Tool validator is not available in this isolated worktree")
        spec = importlib.util.spec_from_file_location("canonical_tool_contracts", contract_path)
        canonical = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(canonical)

        duplicate_pipeline = copy.deepcopy(MANIFEST)
        duplicate_pipeline["pipelines"].append(copy.deepcopy(duplicate_pipeline["pipelines"][0]))
        long_ids = copy.deepcopy(MANIFEST)
        long_ids["id"] = "t" * 161
        long_ids["pipelines"][0]["id"] = "p" * 161
        long_ids["pipelines"][0]["nodes"][0]["id"] = "n" * 161
        long_ids["pipelines"][0]["nodes"][1]["id"] = "m" * 161
        long_ids["pipelines"][0]["edges"] = [{"from": "n" * 161, "to": "m" * 161}]
        parity_cases = [
            MANIFEST,
            duplicate_pipeline,
            long_ids,
            {**MANIFEST, "trace": []},
            {**MANIFEST, "trace": {"schema": "schema://another.trace/v1", "safe": True}},
        ]
        for manifest in parity_cases:
            with self.subTest(trace=manifest.get("trace"), pipelines=len(manifest["pipelines"])):
                canonical.validate_manifest(copy.deepcopy(manifest))
                normalize_manifest(copy.deepcopy(manifest), as_of="2026-08-14T00:00:00Z")

        fallback = copy.deepcopy(MANIFEST)
        fallback["pipelines"][0].pop("id")
        fallback["pipelines"][0].pop("version")
        with self.assertRaises(canonical.ContractError):
            canonical.validate_manifest(copy.deepcopy(fallback))
        normalize_manifest(fallback, as_of="2026-08-14T00:00:00Z")

    def test_manifest_and_graph_revisions_use_rfc8785(self):
        self.assertEqual(
            canonical_manifest_sha256({"number": 1.0}),
            "sha256:" + hashlib.sha256(b'{"number":1}').hexdigest(),
        )
        utf16_canonical = '{"\U0001f600":2,"\ue000":1}'.encode("utf-8")
        self.assertEqual(
            canonical_manifest_sha256({"\ue000": 1, "\U0001f600": 2}),
            "sha256:" + hashlib.sha256(utf16_canonical).hexdigest(),
        )
        reordered = {key: MANIFEST[key] for key in reversed(list(MANIFEST))}
        self.assertEqual(project()["graph_revision"], normalize_manifest(reordered, as_of="2026-08-14T00:00:00Z")["graph_revision"])
        with self.assertRaisesRegex(GraphContractError, "does not match"):
            project(manifest_sha256="sha256:" + "0" * 64)

    def test_only_correlated_otlp_spans_can_overlay_node_state(self):
        scope = {"kind": "project", "id": "blockwise"}
        graph_id = "project:blockwise/tool:fixture-tool"
        span = {
            "traceId": TRACE_ID,
            "spanId": "0123456789abcdef",
            "name": "frank.fixture.publish",
            "attributes": {
                "frank.project.id": "blockwise",
                "frank.tool.id": "fixture-tool",
                "frank.pipeline.id": "main",
                "frank.pipeline.revision": "0.1.1",
                "frank.graph.node.id": f"{graph_id}/pipeline:main/node:publish",
                "gen_ai.input.messages": "never copied",
            },
            "status": {"code": "STATUS_CODE_OK"},
        }
        graph = project(
            render_scope=scope,
            spans=[span],
        )
        self.assertEqual([node["status"] for node in graph["nodes"]], ["declared", "succeeded"])
        self.assertEqual([node["authority"] for node in graph["nodes"]], ["manifest", "otel"])
        self.assertIsNone(graph["trace_ref"])
        self.assertNotIn("never copied", repr(graph))
        with self.assertRaises(GraphContractError):
            project(spans=[{**span, "attributes": {**span["attributes"], "frank.tool.id": "other-tool"}}], render_scope=scope)
        with self.assertRaisesRegex(GraphContractError, "pipeline revision"):
            project(spans=[{**span, "attributes": {**span["attributes"], "frank.pipeline.revision": "9.9.9"}}], render_scope=scope)
        with self.assertRaisesRegex(GraphContractError, "mix OTLP trace"):
            project(spans=[span, {**span, "traceId": "f" * 32, "spanId": "fedcba9876543210"}], render_scope=scope)
        with self.assertRaisesRegex(GraphContractError, "cannot bind"):
            normalize_manifest(
                {**MANIFEST, "scopes": ["workspace"]},
                render_scope={"kind": "workspace", "id": "one"},
                spans=[{**span, "attributes": {**span["attributes"], "frank.graph.node.id": "workspace:one/tool:fixture-tool/pipeline:main/node:publish"}}],
                as_of="2026-08-14T00:00:00Z",
            )
        pending_span = copy.deepcopy(span)
        pending_span.pop("status")
        pending = project(spans=[pending_span], render_scope=scope)
        self.assertEqual(pending["nodes"][1]["status"], "declared")
        self.assertEqual(pending["nodes"][1]["authority"], "manifest")
        empty_status = project(spans=[{**span, "status": {}}], render_scope=scope)
        self.assertEqual(empty_status["nodes"][1]["status"], "declared")
        with self.assertRaisesRegex(GraphContractError, "standard scalar"):
            project(spans=[{**span, "status": []}], render_scope=scope)

        global_span = copy.deepcopy(span)
        global_span["attributes"].pop("frank.project.id")
        global_span["attributes"]["frank.graph.node.id"] = "tool:fixture-tool/pipeline:main/node:publish"
        self.assertEqual(project(spans=[global_span])["nodes"][1]["status"], "succeeded")
        with self.assertRaisesRegex(GraphContractError, "project-scoped"):
            project(spans=[{**global_span, "attributes": {**global_span["attributes"], "frank.project.id": "blockwise"}}])
        manifest_without_trace = copy.deepcopy(MANIFEST)
        manifest_without_trace.pop("trace")
        with self.assertRaisesRegex(GraphContractError, "span_prefix"):
            normalize_manifest(manifest_without_trace, spans=[global_span], as_of="2026-08-14T00:00:00Z")
        invalid_prefix = copy.deepcopy(MANIFEST)
        invalid_prefix["trace"]["span_prefix"] = "frank..fixture"
        self.assertTrue(all(
            node["status"] == "declared"
            for node in normalize_manifest(invalid_prefix, as_of="2026-08-14T00:00:00Z")["nodes"]
        ))
        with self.assertRaisesRegex(GraphContractError, "span_prefix"):
            normalize_manifest(invalid_prefix, spans=[global_span], as_of="2026-08-14T00:00:00Z")

    def test_otlp_requires_exact_unique_nonzero_w3c_correlation_fields(self):
        graph_id = "tool:fixture-tool"
        attributes = {
            "frank.tool.id": "fixture-tool",
            "frank.pipeline.id": "main",
            "frank.pipeline.revision": "0.1.1",
            "frank.graph.node.id": f"{graph_id}/pipeline:main/node:prepare",
        }
        span = {
            "traceId": TRACE_ID,
            "spanId": "0123456789abcdef",
            "name": "frank.fixture.prepare",
            "attributes": attributes,
            "status": {"code": "OK"},
        }
        snake = copy.deepcopy(span)
        snake["trace_id"] = snake.pop("traceId")
        snake["span_id"] = snake.pop("spanId")
        all_zero_trace = {**span, "traceId": "0" * 32}
        all_zero_span = {**span, "spanId": "0" * 16}
        attribute_list = [
            {"key": key, "value": {"stringValue": value}}
            for key, value in attributes.items()
        ]
        duplicate_attributes = {**span, "attributes": [*attribute_list, copy.deepcopy(attribute_list[0])]}
        for invalid in (snake, all_zero_trace, all_zero_span, duplicate_attributes):
            with self.subTest(invalid=invalid):
                with self.assertRaises(GraphContractError):
                    project(spans=[invalid])

    def test_manifest_normalization_matches_canonical_id_version_and_shape_rules(self):
        invalid_manifests = []
        invalid_manifests.append({**MANIFEST, "id": "Fixture_Tool"})
        invalid_manifests.append({**MANIFEST, "version": "1.2"})
        invalid_manifests.append({**MANIFEST, "scopes": ["global", "global"]})
        bad_kind = copy.deepcopy(MANIFEST)
        bad_kind["pipelines"][0]["nodes"][0]["kind"] = "Bad_Kind"
        invalid_manifests.append(bad_kind)
        unknown_pipeline_field = copy.deepcopy(MANIFEST)
        unknown_pipeline_field["pipelines"][0]["description"] = "invented"
        invalid_manifests.append(unknown_pipeline_field)
        bad_settings = copy.deepcopy(MANIFEST)
        bad_settings["settings"] = {"properties": {}}
        invalid_manifests.append(bad_settings)
        forbidden_settings = copy.deepcopy(MANIFEST)
        forbidden_settings["settings"]["properties"]["connector_ref"] = {"type": "string"}
        invalid_manifests.append(forbidden_settings)
        for manifest in invalid_manifests:
            with self.subTest(manifest=manifest):
                with self.assertRaises(GraphContractError):
                    normalize_manifest(manifest, as_of="2026-08-14T00:00:00Z")

    def test_manifest_normalization_rejects_cycles_nonfinite_and_non_dag_pipelines(self):
        cyclic_value = copy.deepcopy(MANIFEST)
        cyclic_value["domain_metadata"]["cycle"] = cyclic_value
        nonfinite = copy.deepcopy(MANIFEST)
        nonfinite["domain_metadata"]["score"] = float("nan")
        self_loop = copy.deepcopy(MANIFEST)
        self_loop["pipelines"][0]["edges"] = [{"from": "prepare", "to": "prepare"}]
        pipeline_cycle = copy.deepcopy(MANIFEST)
        pipeline_cycle["pipelines"][0]["edges"].append({"from": "publish", "to": "prepare"})
        executable = copy.deepcopy(MANIFEST)
        executable["domain_metadata"]["handler"] = "run"
        for manifest in (cyclic_value, nonfinite, self_loop, pipeline_cycle, executable):
            with self.subTest(manifest_id=id(manifest)):
                with self.assertRaises(GraphContractError):
                    normalize_manifest(manifest, as_of="2026-08-14T00:00:00Z")

    def test_settings_and_selection_are_reference_only_and_bound(self):
        graph = project(
            settings_revision={"schema": "schema://frank.tool-app-settings/v1", "scope": {"kind": "global"}, "revision": 4, "settings": {"prompt": "never copy"}},
            selection={"node_id": "tool:fixture-tool/pipeline:main/node:prepare"},
        )
        self.assertEqual(graph["nodes"][0]["settings_revision_ref"]["revision"], 4)
        self.assertNotIn("never copy", repr(graph))
        self.assertEqual(graph["extensions"]["frank.graph.selection"]["node_id"], "tool:fixture-tool/pipeline:main/node:prepare")
        with self.assertRaises(GraphContractError):
            project(selection={"node_id": "tool:fixture-tool/pipeline:main/node:missing"})
        with self.assertRaises(GraphContractError):
            project(selection={"trace_id": TRACE_ID})
        with self.assertRaisesRegex(GraphContractError, "sensitive connection setting"):
            project(settings_revision={
                "schema": "schema://frank.tool-app-settings/v1",
                "scope": {"kind": "global"},
                "revision": 5,
                "settings": {"connector_ref": "connection:one"},
            })

    def test_rejects_unknown_lenses_versions_shapes_scope_and_permissions(self):
        cases = [
            {"lens": "tool.execute"},
            {"manifest": {**MANIFEST, "version": "not-semver"}},
            {"manifest": {**MANIFEST, "pipelines": [{"schema": "schema://frank.tool-app-pipeline/v1", "nodes": [{"id": "a", "kind": "x", "label": "bad"}], "edges": []}]}},
            {"render_scope": {"kind": "workspace", "id": "missing"}},
            {"permissions": ["<script>"]},
            {"permissions": "inspect"},
            {"lens": "run.trace"},
        ]
        for case in cases:
            with self.subTest(case=case):
                with self.assertRaises(GraphContractError):
                    normalize_manifest(
                        case.get("manifest", MANIFEST),
                        lens=case.get("lens", "tool.pipeline"),
                        render_scope=case.get("render_scope"),
                        permissions=case.get("permissions", ()),
                        as_of="2026-08-14T00:00:00Z",
                    )


if __name__ == "__main__":
    unittest.main()
