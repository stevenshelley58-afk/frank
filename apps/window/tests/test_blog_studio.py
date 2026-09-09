import json
from io import BytesIO
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.error import HTTPError

from flask import Flask

from blog_studio import EVENT_KINDS, create_blog_studio_blueprint, public_blog_run, public_event


RUN_ID = "trun_0123456789abcdef0123456789abcdef"


def hermes_run(**overrides):
    value = {
        "id": RUN_ID,
        "request_id": "req_public",
        "tool_id": "content-factory",
        "status": "running",
        "stage": "draft",
        "progress": 0.43,
        "scope": {"project_id": "frank"},
        "payload": {
            "job_name": "A useful article",
            "source_bundle": {
                "text": "private source copy",
                "text_length": 19,
                "urls": ["https://example.com/source"],
            },
        },
        "output": {"candidate": {}},
    }
    value.update(overrides)
    return value


class BlogStudioProjectionTest(unittest.TestCase):
    def test_public_event_allowlist_matches_the_declarative_tool_contract(self):
        manifest_path = Path(__file__).parents[1] / "tools" / "content-factory" / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(EVENT_KINDS, set(manifest["hermes"]["event_kinds"]))
        self.assertEqual(EVENT_KINDS, set(manifest["trace"]["event_allowlist"]))

    def test_projection_is_closed_and_redacts_sensitive_values(self):
        raw = hermes_run(output={
            "candidate": {
                "article": {
                    "title": "Public title",
                    "markdown": "Safe copy. api_key=super-secret-token-value",
                },
                "research": {
                    "summary": "Read C:\\projects\\private\\notes.txt",
                    "sources": [{
                        "title": "Source",
                        "url": "https://example.com/evidence",
                        "evidence_ref": "evidence-1",
                    }],
                },
                "artifacts": [{
                    "name": "article.md",
                    "type": "article",
                    "sha256": "a" * 64,
                    "provenance": {
                        "prompt_ref": "blog/writer@2",
                        "model_ref": "provider/model",
                        "raw_prompt": "must never escape",
                    },
                }],
                "review": {"status": "ready", "blockers": []},
                "private_state": {"raw_model_output": "never"},
            },
            "raw_prompt": "never",
        })

        public = public_blog_run(raw)
        encoded = json.dumps(public)

        self.assertEqual(public["status"], "running")
        self.assertEqual(public["stage"], "draft")
        self.assertTrue(public["source"]["has_text"])
        self.assertNotIn("private source copy", encoded)
        self.assertNotIn("super-secret-token-value", encoded)
        self.assertNotIn("C:\\\\projects", encoded)
        self.assertNotIn("raw_prompt", encoded)
        self.assertNotIn("raw_model_output", encoded)
        self.assertEqual(public["artifacts"][0]["url"], f"/api/blog-studio/runs/{RUN_ID}/artifacts/article.md?project_id=frank")
        self.assertNotIn("provenance", public["artifacts"][0])

    def test_projection_rejects_unsafe_source_urls_and_artifacts(self):
        raw = hermes_run(
            payload={
                "source_bundle": {
                    "urls": [
                        "https://example.com/good",
                        "https://example.com/private?access_token=secret",
                        "file:///etc/passwd",
                        "http://127.0.0.1/private",
                        "http://localhost/private",
                    ]
                }
            },
            output={"candidate": {"artifacts": [
                {"name": "article.html", "type": "html"},
                {"name": "../escape.md", "type": "markdown"},
                {"name": "article.md", "type": "markdown"},
            ]}},
        )

        public = public_blog_run(raw)

        self.assertEqual(public["source"]["urls"], ["https://example.com/good"])
        self.assertEqual([item["name"] for item in public["artifacts"]], ["article.md"])

    def test_event_projection_uses_kind_allowlist_and_keeps_errors_as_text(self):
        self.assertIsNone(public_event({"kind": "prompt.raw", "data": {"prompt": "secret"}}))

        event = public_event({
            "sequence": 9,
            "kind": "tool.completed",
            "status": "error",
            "node_id": "fact_check",
            "data": {"tool": "browser", "error": "api_key=secret-value", "raw": "never"},
        })

        self.assertEqual(event["node_id"], "qa")
        self.assertIsInstance(event["data"]["error"], str)
        self.assertNotIn("secret-value", event["data"]["error"])
        self.assertNotIn("raw", event["data"])

        structured = public_event({
            "kind": "run.failed",
            "data": {"error": {"credential": "DO_NOT_LEAK"}},
        })
        self.assertEqual(structured["data"]["error"], "")
        self.assertNotIn("DO_NOT_LEAK", json.dumps(structured))

    def test_completed_status_requires_a_valid_release_proof(self):
        missing = public_blog_run(hermes_run(status="completed", output={"candidate": {}}))
        malformed = public_blog_run(hermes_run(status="completed", output={
            "release": {"status": "released", "release_id": "cfrel_bad", "sha256": "wrong", "artifact_name": "article.md"},
        }))
        released = public_blog_run(hermes_run(status="completed", output={
            "release": {"status": "released", "release_id": "cfrel_valid", "version": 2, "sha256": "a" * 64, "artifact_name": "article.md"},
        }))

        self.assertEqual(missing["status"], "unavailable")
        self.assertEqual(missing["release"], {})
        self.assertEqual(malformed["status"], "unavailable")
        self.assertEqual(malformed["release"], {})
        self.assertEqual(released["status"], "published")
        self.assertEqual(released["release"]["status"], "published")
        self.assertIn("project_id=frank", released["release"]["download_url"])

    def test_persisted_source_descriptors_remain_visible_without_private_paths(self):
        public = public_blog_run(hermes_run(payload={"source_bundle": {"sources": [
            {"kind": "text", "name": "pasted.txt", "size": 42, "path": "C:\\private\\source.txt"},
            {"kind": "url", "name": "url.json", "size": 80},
            {"kind": "attachment", "name": "brief.pdf", "media_type": "application/pdf", "size": 1024, "sha256": "b" * 64, "path": "/srv/private/brief.pdf"},
        ], "count": 3}}))

        self.assertEqual(public["source"]["source_count"], 3)
        self.assertEqual(public["source"]["url_count"], 1)
        self.assertEqual(public["source"]["attachment_count"], 1)
        self.assertTrue(public["source"]["has_text"])
        self.assertNotIn("private", json.dumps(public["source"]).lower())


class BlogStudioApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.calls = []
        self.next_error = None
        self.run_override = None
        self.app = Flask(__name__)
        self.app.register_blueprint(create_blog_studio_blueprint(
            project_getter=lambda project_id: {"id": project_id, "name": "Frank", "root": "frank"}
            if project_id == "frank" else None,
            project_context=lambda project: f"Hermes context for {project['id']}",
            hermes_request=self.hermes_request,
            hermes_base=lambda: "http://hermes.invalid",
            hermes_key=lambda: "",
            clean_attachments=lambda values: [],
            upload_target=lambda upload_id: Path(self.temp.name) / upload_id if upload_id else None,
        ))
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def hermes_request(self, path, payload=None, *, method=None, timeout=30):
        self.calls.append({"path": path, "payload": payload, "method": method, "timeout": timeout})
        if self.next_error is not None:
            error, self.next_error = self.next_error, None
            raise error
        run = self.run_override or hermes_run()
        if path == "/v1/tool-runs" and method == "POST":
            return {"run": run}
        if path.startswith("/v1/tool-runs?"):
            return {"runs": [run]}
        return {"run": run}

    def test_create_sends_closed_hermes_command_with_stable_idempotency(self):
        response = self.client.post("/api/blog-studio/runs", json={
            "project_id": "frank",
            "job_name": "Launch article",
            "topic": "Explain how the new workflow helps editors.",
            "source_text": "Internal source material",
            "source_urls": ["https://example.com/source"],
            "direction": {
                "audience": "Operators",
                "outcome": "Understand the workflow",
                "cta": "Start a run",
                "locale": "en-AU",
            },
            "outputs": {
                "length": "deep",
                "research_mode": "verify-enrich",
                "media": "briefs",
                "companions": ["email"],
            },
            "client_request_id": "browser-request-123",
        })

        self.assertEqual(response.status_code, 202, response.get_json())
        command = self.calls[0]["payload"]
        self.assertEqual(command["tool_id"], "content-factory")
        self.assertEqual(command["action"], "run")
        self.assertEqual(command["idempotency_key"], "blog-studio:browser-request-123")
        self.assertEqual(command["scope"], {"project_id": "frank"})
        self.assertEqual(command["payload"]["project_id"], "frank")
        self.assertRegex(command["payload"]["content_id"], r"^content_[0-9a-f]{24}$")
        self.assertEqual(command["payload"]["project_context"], "Hermes context for frank")
        self.assertNotIn("prompt_refs", json.dumps(command))
        self.assertNotIn("model_policy", json.dumps(command))

    def test_create_fails_closed_for_unknown_fields_and_unsafe_urls(self):
        unsafe = self.client.post("/api/blog-studio/runs", json={
            "project_id": "frank",
            "topic": "A valid article topic",
            "source_urls": ["https://example.com/source?api_key=secret"],
        })
        missing = self.client.post("/api/blog-studio/runs", json={"project_id": "frank"})

        self.assertEqual(unsafe.status_code, 400)
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(self.calls, [])

    def test_create_accepts_source_only_or_direction_only_contracts(self):
        source_only = self.client.post("/api/blog-studio/runs", json={
            "project_id": "frank", "source_text": "A source-led assignment.",
        })
        direction_only = self.client.post("/api/blog-studio/runs", json={
            "project_id": "frank", "direction": {"outcome": "Help operators decide."},
        })

        self.assertEqual([source_only.status_code, direction_only.status_code], [202, 202])
        commands = [item["payload"] for item in self.calls if item["method"] == "POST"]
        self.assertEqual(commands[0]["payload"]["job_name"], "Source-led article")
        self.assertEqual(commands[1]["payload"]["job_name"], "Help operators decide.")

    def test_list_is_pinned_to_content_factory_and_project(self):
        response = self.client.get("/api/blog-studio/runs?project_id=frank&limit=12")

        self.assertEqual(response.status_code, 200)
        query = parse_qs(urlsplit(self.calls[0]["path"]).query)
        self.assertEqual(query["tool_id"], ["content-factory"])
        self.assertEqual(query["project_id"], ["frank"])
        self.assertEqual(query["limit"], ["12"])

    def test_review_retry_and_cancel_translate_to_existing_hermes_routes(self):
        query = "?project_id=frank"
        review = self.client.post(f"/api/blog-studio/runs/{RUN_ID}/review{query}", json={
            "decision": "request_changes",
            "note": "Tighten the opening.",
            "from_stage": "draft",
            "artifact_versions": {"article": 3},
        })
        rerun = self.client.post(f"/api/blog-studio/runs/{RUN_ID}/rerun{query}", json={
            "from_stage": "research",
            "instructions": "Verify the newest figures.",
        })
        resume = self.client.post(f"/api/blog-studio/runs/{RUN_ID}/resume{query}", json={"from_stage": "qa"})
        cancel = self.client.post(f"/api/blog-studio/runs/{RUN_ID}/cancel{query}", json={"reason": "No longer needed"})

        self.assertEqual([review.status_code, rerun.status_code, resume.status_code, cancel.status_code], [200, 200, 200, 200])
        actions = [item for item in self.calls if item["method"] == "POST"]
        self.assertEqual([item["path"].rsplit("/", 1)[-1] for item in actions], ["approval", "retry", "retry", "cancel"])
        self.assertEqual(actions[1]["payload"]["mode"], "rerun")
        self.assertEqual(actions[1]["payload"]["stage"], "research")
        self.assertEqual(actions[2]["payload"], {"stage": "qa", "instructions": "", "mode": "resume"})

    def test_withdraw_is_an_explicit_post_release_approval_action(self):
        response = self.client.post(
            f"/api/blog-studio/runs/{RUN_ID}/withdraw?project_id=frank",
            json={"reason": "The article is now out of date."},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.calls[-1]["path"].endswith("/approval"))
        self.assertEqual(self.calls[-1]["payload"], {
            "decision": "withdraw",
            "note": "The article is now out of date.",
        })

    def test_hermes_conflicts_remain_actionable_without_leaking_upstream_data(self):
        self.next_error = HTTPError(
            "http://hermes.invalid/v1/tool-runs/private",
            409,
            "Conflict",
            {},
            BytesIO(b'{"error":{"message":"The run is not waiting for review."},"private":"hidden"}'),
        )

        response = self.client.post(
            f"/api/blog-studio/runs/{RUN_ID}/review?project_id=frank",
            json={"decision": "approve"},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json(), {"error": "The run is not waiting for review."})

    def test_per_run_routes_reject_foreign_tools_projects_and_missing_scope(self):
        missing = self.client.get(f"/api/blog-studio/runs/{RUN_ID}")
        self.run_override = hermes_run(tool_id="ad-template-generator")
        foreign_tool = self.client.post(
            f"/api/blog-studio/runs/{RUN_ID}/cancel?project_id=frank", json={"reason": "no"},
        )
        self.run_override = hermes_run(scope={"project_id": "another-project"})
        foreign_project = self.client.get(f"/api/blog-studio/runs/{RUN_ID}?project_id=frank")

        self.assertEqual([missing.status_code, foreign_tool.status_code, foreign_project.status_code], [400, 404, 404])
        self.assertFalse(any(item["method"] == "POST" for item in self.calls))

    def test_invalid_action_stage_fails_closed_without_contacting_hermes(self):
        response = self.client.post(
            f"/api/blog-studio/runs/{RUN_ID}/rerun?project_id=frank",
            json={"from_stage": "drafft", "instructions": "Try again"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.calls, [])

    def test_artifact_route_never_serves_html_or_path_traversal(self):
        html = self.client.get(f"/api/blog-studio/runs/{RUN_ID}/artifacts/article.html")
        escaped = self.client.get(f"/api/blog-studio/runs/{RUN_ID}/artifacts/..%2Fsecret.md")

        self.assertEqual(html.status_code, 404)
        self.assertEqual(escaped.status_code, 404)


if __name__ == "__main__":
    unittest.main()
