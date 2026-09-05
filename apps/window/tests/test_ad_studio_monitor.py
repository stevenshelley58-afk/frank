import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import server


class AdStudioMonitorTest(unittest.TestCase):
    def test_run_projection_has_durable_source_url_and_replayed_receipt(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun-example",
            "status": "completed",
            "stage": "live",
            "payload": {"sources": [{
                "name": "source-house.PNG", "size": 42,
                "media_type": "image/png", "origin": "device",
            }]},
            "output": {"import": {"template_id": "template-1", "status": "replayed"}},
        })
        self.assertEqual(
            projected["source"]["url"],
            "/api/ad-studio/runs/trun-example/artifacts/source.png",
        )
        self.assertEqual(projected["output"]["import"]["status"], "replayed")
        self.assertEqual(projected["output"]["import"]["template_id"], "template-1")
        self.assertEqual(
            projected["output"]["import"]["template_url"],
            "https://blockwise.sale/ad-studio/templates/template-1",
        )

    def test_import_projection_rejects_unsafe_or_mismatched_destinations(self):
        unsafe = server._public_ad_studio_import({
            "status": "imported",
            "template_id": "../admin",
            "template_url": "https://evil.example/ad-studio/templates/template-1",
            "internal_receipt": {"secret": "never public"},
        })
        self.assertEqual(unsafe, {"status": "imported"})

        mismatched = server._public_ad_studio_import({
            "status": "ready",
            "template_id": "template-1",
            "template_url": "https://blockwise.sale/ad-studio/templates/template-2",
        })
        self.assertEqual(mismatched, {"status": "ready"})

    def test_run_projection_exposes_frozen_models_and_truthful_usage_source(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun-model-profile",
            "model_policy_revision": 35,
            "model_policy": {
                "name": "private policy detail must not leak",
                "stages": {
                    "analyse": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-sol", "secret": "never"}},
                    "compare": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-luna"}},
                    "quality-escalation": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-sol"}},
                    "final-review-a": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-luna"}},
                    "final-review-b": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-sol"}},
                },
            },
            "output": {"usage": {"total_tokens": 1234, "estimated_cost_usd": 0.125}, "cost": {}},
        })

        self.assertEqual(projected["model_profile"]["source"], "Hermes frozen run policy")
        self.assertEqual(projected["model_profile"]["revision"], 35)
        self.assertEqual(
            [(role["role"], role["provider"], role["model"]) for role in projected["model_profile"]["roles"]],
            [
                ("builder", "openai-codex", "gpt-5.6-sol"),
                ("comparator", "openai-codex", "gpt-5.6-luna"),
                ("quality-escalation", "openai-codex", "gpt-5.6-sol"),
                ("final-review-a", "openai-codex", "gpt-5.6-luna"),
                ("final-review-b", "openai-codex", "gpt-5.6-sol"),
            ],
        )
        self.assertNotIn("secret", json.dumps(projected))
        self.assertNotIn("private policy detail", json.dumps(projected))
        self.assertEqual(projected["usage"]["source"], "Hermes run ledger")
        self.assertEqual(projected["usage"]["status"], "reported")
        self.assertEqual(projected["usage"]["billing"], "ChatGPT/Codex OAuth — not OpenAI API dashboard")
        self.assertEqual(projected["usage"]["total_tokens"], 1234)
        self.assertEqual(projected["usage"]["estimated_cost_usd"], 0.125)

    def test_missing_usage_is_reported_as_missing_not_zero(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun-no-usage",
            "model_policy": {"stages": {"compare": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-luna"}}}},
            "output": {},
        })

        self.assertEqual(projected["usage"]["status"], "not_reported")
        self.assertNotIn("total_tokens", projected["usage"])
        self.assertIsNone(projected["cost"])

    def test_ready_for_review_projection_exposes_only_safe_recorded_evidence(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "status": "ready_for_review",
            "output": {"review_summary": {
                "source": {"name": "source.png", "url": "https://private.example/source.png"},
                "previews": [
                    {"name": "final-feed.png", "placement": "feed", "kind": "template", "private_path": "/srv/private"},
                    {"name": "meta-story.png", "placement": "story", "kind": "meta-preview"},
                ],
                "diffs": [{"name": "diff-feed.png", "placement": "feed", "view": "difference"}],
                "scores": {"overall": 9.8, "feed": 9.9, "story": 9.8, "reviewers": [
                    {"label": "Final A", "score": 9.8, "decision": "pass", "prompt": "never public"},
                ]},
                "warnings": [{"code": "FONT", "message": "Poppins replaced", "secret": "never"}],
                "font_substitution": [{"source": "Paid Font", "replacement": "Poppins", "reason": "Closest available"}],
                "iterations": 7,
                "elapsed_seconds": 144,
                "cost_usd": 0.42,
                "model_profile": {"source": "Hermes frozen run policy", "immutable": True, "roles": [
                    {"role": "builder", "label": "Builder", "provider": "openai-codex", "model": "gpt-5.6-sol", "secret": "never"},
                ]},
                "smoke_test": {"status": "passed", "passed": True, "checks": [{"label": "Editor opened", "passed": True}]},
                "layers": [{"id": "headline", "name": "Headline", "type": "text", "placement": "feed", "editable": True, "bounds": [0, 0, 1, 1]}],
            }},
        })

        summary = projected["output"]["review_summary"]
        self.assertEqual(summary["source"]["url"], "/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/artifacts/source.png")
        self.assertEqual(summary["previews"][0]["url"], "/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/artifacts/final-feed.png")
        self.assertEqual(summary["scores"]["reviewers"][0], {"label": "Final A", "decision": "pass", "score": 9.8})
        self.assertEqual(summary["smoke_test"]["checks"], [{"label": "Editor opened", "passed": True}])
        self.assertEqual(summary["model_profile"]["roles"], [{"role": "builder", "label": "Builder", "provider": "openai-codex", "model": "gpt-5.6-sol"}])
        self.assertEqual(summary["layers"], [{"id": "headline", "name": "Headline", "type": "text", "placement": "feed", "editable": True}])
        serialized = json.dumps(summary)
        self.assertNotIn("private.example", serialized)
        self.assertNotIn("/srv/private", serialized)
        self.assertNotIn("never public", serialized)

    def test_exact_clone_root_output_is_adapted_for_ready_review(self):
        projected = server._public_ad_studio_run({
            "run_id": "trun_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "status": "ready_for_review",
            "model_policy_revision": 41,
            "model_policy": {"stages": {
                "analyse": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-sol"}},
                "compare": {"primary": {"provider": "openai-codex", "model": "gpt-5.6-luna"}},
            }},
            "output": {
                "process": "exact-clone", "source": "source.png",
                "references": [
                    {"name": "source-map.json", "sourcePlacement": "feed"},
                    {"name": "reference-story.png", "placement": "story", "kind": "reciprocal-image-reference"},
                ],
                "iterations": [
                    {"iteration": 1, "decision": "revise", "previews": ["iteration-01-feed.png", "iteration-01-story.png"]},
                    {"iteration": 2, "decision": "accepted", "previews": ["iteration-02-feed.png", "iteration-02-story.png"]},
                ],
                "previews": [
                    {"name": "iteration-03-feed.png", "placement": "feed", "kind": "final-neutral-shippable"},
                    {"name": "iteration-03-story.png", "placement": "story", "kind": "final-neutral-shippable"},
                ],
                "diffs": [{"name": "iteration-02-feed-difference.png", "placement": "feed", "kind": "difference"}],
                "scores": {"comparator": {"overall": 0.98}},
                "final_review": {"reviewers": [
                    {"decision": "accept", "scores": {"overall": 0.99}},
                    {"decision": "accept", "scores": {"overall": 9.8}},
                ]},
                "elapsed_seconds": 90,
                "smoke_test": {"status": "passed"},
                "layers": {"feed": {"ordered": [{"layerId": "headline", "type": "text", "inputKey": "headline"}]}, "story": {"ordered": []}},
            },
        })
        summary = projected["output"]["review_summary"]
        self.assertEqual(summary["source"]["placement"], "feed")
        self.assertEqual(summary["references"][0]["name"], "reference-story.png")
        self.assertEqual([item["kind"] for item in summary["previews"]], ["qa-source-filled", "qa-source-filled", "final-neutral-shippable", "final-neutral-shippable"])
        self.assertEqual(summary["scores"]["overall"], 9.8)
        self.assertEqual([item["score"] for item in summary["scores"]["reviewers"]], [9.9, 9.8])
        self.assertTrue(summary["smoke_test"]["passed"])
        self.assertEqual(summary["layers"][0]["id"], "headline")
        self.assertEqual(summary["model_profile"]["revision"], 41)

    def test_running_exact_clone_recovers_latest_durable_review_evidence(self):
        run_id = "trun_cccccccccccccccccccccccccccccccc"
        projected = server._public_ad_studio_run({
            "run_id": run_id,
            "status": "running",
            "stage": "compare",
            "payload": {"sources": [{"name": "campaign.png", "path": "/srv/private/source.png"}]},
            "output": {},
        }, events=[
            {"sequence": 0, "kind": "command.accepted", "data": {"model_profile": {
                "profile_revision": 44,
                "builder": {"provider": "openai-codex", "model": "gpt-5.6-sol"},
                "comparator": {"provider": "openai-codex", "model": "gpt-5.6-luna"},
            }}},
            {"sequence": 4, "kind": "source-map.completed", "data": {}},
            {"sequence": 7, "kind": "aspect-reference-image.started", "data": {
                "source_placement": "feed", "target_placement": "story",
            }},
            {"sequence": 9, "kind": "aspect-reference.started", "data": {
                "source_placement": "feed", "target_placement": "story",
            }},
            {"sequence": 15, "kind": "iteration.rendered", "data": {
                "iteration": 1,
                "previews": ["iteration-01-feed.png", "iteration-01-story.png"],
                "diffs": ["iteration-01-feed-overlay.png"],
            }},
            {"sequence": 20, "kind": "iteration.rendered", "data": {
                "iteration": 2,
                "previews": ["iteration-02-feed.png", "iteration-02-story.png", "/srv/private/nope.png"],
                "diffs": [
                    "iteration-02-feed-overlay.png", "iteration-02-feed-difference.png",
                    "iteration-02-story-overlay.png", "iteration-02-story-difference.png",
                    "iteration-02-story-reference-edges.png",
                ],
                "layers": {"feed": {"ordered": [{"layerId": "headline", "type": "text", "inputKey": "headline"}]}, "story": {"ordered": []}},
            }},
            {"sequence": 21, "kind": "iteration.compared", "data": {
                "iteration": 2, "decision": "revise", "score": 0.94,
                "scores": {"overall": 0.94, "feed": 0.95, "story": 0.93},
            }},
        ])

        summary = projected["output"]["review_summary"]
        self.assertEqual(summary["source"]["name"], "source.png")
        self.assertEqual(summary["source"]["placement"], "feed")
        self.assertEqual(summary["references"], [{
            "name": "reference-story.png", "url": f"/api/ad-studio/runs/{run_id}/artifacts/reference-story.png",
            "kind": "reciprocal-image-reference", "placement": "story",
        }])
        self.assertEqual([item["name"] for item in summary["previews"]], ["iteration-02-feed.png", "iteration-02-story.png"])
        self.assertEqual([item["kind"] for item in summary["diffs"]], ["overlay", "difference", "overlay", "difference"])
        self.assertEqual(summary["scores"]["overall"], 9.4)
        self.assertEqual(summary["layers"][0]["id"], "headline")
        self.assertEqual(projected["model_profile"]["revision"], 44)
        self.assertEqual(projected["stage"], "compare")
        self.assertEqual([item["iteration"] for item in projected["output"]["iterations"]], [1, 2])
        self.assertNotIn("/srv/private", json.dumps(projected))

    def test_failed_exact_clone_uses_only_proven_artifacts_and_keeps_error(self):
        run_id = "trun_dddddddddddddddddddddddddddddddd"
        projected = server._public_ad_studio_run({
            "run_id": run_id,
            "status": "failed",
            "stage": "render",
            "payload": {"sources": [{"name": "campaign.jpg"}]},
            "output": {},
            "error": "renderer stopped",
        }, events=[
            {"sequence": 2, "kind": "source-map.completed", "data": {}},
            {"sequence": 3, "kind": "aspect-reference-image.completed", "data": {
                "source_placement": "feed", "target_placement": "story", "name": "private-generated-name.png",
            }},
            {"sequence": 8, "kind": "iteration.rendered", "data": {
                "iteration": 1,
                "previews": ["iteration-01-feed.png", "iteration-01-story.png"],
                "diffs": ["iteration-01-story-overlay.png", "not-an-artifact.png"],
            }},
            {"sequence": 9, "kind": "iteration.compared", "data": {
                "iteration": 1, "decision": "accept", "score": 9.8,
            }},
        ])

        summary = projected["output"]["review_summary"]
        self.assertEqual(projected["status"], "failed")
        self.assertEqual(projected["error"], "renderer stopped")
        self.assertEqual(summary["source"]["name"], "source.jpg")
        self.assertNotIn("references", summary)
        self.assertEqual([item["name"] for item in summary["previews"]], ["iteration-01-feed.png", "iteration-01-story.png"])
        self.assertEqual([item["name"] for item in summary["diffs"]], ["iteration-01-story-overlay.png"])
        self.assertEqual(summary["scores"]["overall"], 9.8)
        self.assertNotIn("private-generated-name", json.dumps(projected))

    def test_review_decisions_proxy_exact_hermes_routes_and_bodies(self):
        responses = [
            ("/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/approve", {}),
            ("/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/request-changes", {"instructions": "Increase title tracking."}),
            ("/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/discard", {"reason": "Wrong source."}),
        ]
        with mock.patch.object(server, "hermes_request", return_value={"run_id": "trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "status": "approved"}) as request_mock:
            client = server.app.test_client()
            for route, body in responses:
                response = client.post(route, json=body)
                self.assertEqual(response.status_code, 200)
            self.assertEqual(
                [(call.args[0], call.args[1]) for call in request_mock.call_args_list],
                [
                    ("/v1/tool-runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/approve", {}),
                    ("/v1/tool-runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/request-changes", {"instructions": "Increase title tracking."}),
                    ("/v1/tool-runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/discard", {"reason": "Wrong source."}),
                ],
            )
            self.assertTrue(all(call.kwargs == {"method": "POST", "timeout": 15} for call in request_mock.call_args_list))

    def test_review_decisions_fail_closed_on_invalid_operator_input(self):
        client = server.app.test_client()
        self.assertEqual(client.post("/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/approve", json={"force": True}).status_code, 400)
        self.assertEqual(client.post("/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/request-changes", json={"instructions": ""}).status_code, 400)
        self.assertEqual(client.post("/api/ad-studio/runs/trun_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/discard", json={"reason": "x" * 1_001}).status_code, 400)

    def test_archify_receipt_is_bound_to_spec_artifact_and_validator(self):
        previous = (
            server.ARCHIFY_ARTIFACT, server.ARCHIFY_SPEC,
            server.ARCHIFY_CLI, server.ARCHIFY_RECEIPT,
        )
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                files = {
                    "artifactSha256": root / "diagram.html",
                    "specSha256": root / "diagram.json",
                    "validatorSha256": root / "archify.mjs",
                }
                for index, path in enumerate(files.values(), 1):
                    path.write_bytes(f"file-{index}".encode("ascii"))
                receipt = root / "validation-receipt.json"
                receipt.write_text(json.dumps({
                    "schema": "frank.archify-build-validation.v1",
                    "validated": True,
                    **{key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in files.items()},
                }), encoding="utf-8")
                server.ARCHIFY_ARTIFACT = files["artifactSha256"]
                server.ARCHIFY_SPEC = files["specSha256"]
                server.ARCHIFY_CLI = files["validatorSha256"]
                server.ARCHIFY_RECEIPT = receipt
                self.assertTrue(server._archify_build_validated())
                server.ARCHIFY_ARTIFACT.write_bytes(b"changed")
                self.assertFalse(server._archify_build_validated())
        finally:
            (
                server.ARCHIFY_ARTIFACT, server.ARCHIFY_SPEC,
                server.ARCHIFY_CLI, server.ARCHIFY_RECEIPT,
            ) = previous

    def test_agenttrail_is_explicitly_unavailable_when_not_configured(self):
        previous = server.AGENTTRAIL_URL
        try:
            server.AGENTTRAIL_URL = ""
            response = server.app.test_client().get("/api/ad-studio/implementation-activity")
            self.assertEqual(response.status_code, 503)
            self.assertFalse(response.get_json()["available"])
            self.assertIn("not configured", response.get_json()["message"])
        finally:
            server.AGENTTRAIL_URL = previous


if __name__ == "__main__":
    unittest.main()
