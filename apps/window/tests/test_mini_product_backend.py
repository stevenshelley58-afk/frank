import json
import os
import tempfile
import unittest
from pathlib import Path

from flask import Flask

from mini import GUIDANCE_SCHEMA, SELF_HOST_SCHEMA
from mini_frank import RESULT_SCHEMA_V2, create_blueprint


class MiniProductBackendTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.data_root = root / "data"
        self.preview_root = root / "previews"
        self.legacy_root = root / "legacy"
        self.legacy_root.mkdir()
        self.hermes_root = root / "hermes"
        self.sessions = []
        self.runs = []
        self.poll_status = "started"

        def project_getter(project_id):
            return {"id": project_id, "name": "Mini Frank", "root": project_id} if project_id == "mini-frank" else None

        def session_creator(project, **kwargs):
            session = {"id": kwargs.get("session_id_override") or "session"}
            self.sessions.append({"project": project, "kwargs": kwargs, "session": session})
            return session

        def hermes_request(path, payload=None, **kwargs):
            if path == "/v1/runs":
                run = {"run_id": f"run-{len(self.runs) + 1}", "payload": payload}
                self.runs.append(run)
                return {"run_id": run["run_id"], "status": "started"}
            if path.startswith("/v1/runs/"):
                return {"run_id": path.rsplit("/", 1)[-1], "status": self.poll_status}
            if path.startswith("/api/sessions/") and kwargs.get("method") == "DELETE":
                return {"deleted": True}
            raise AssertionError(f"unexpected Hermes request: {path}")

        app = Flask(__name__)
        self.blueprint = create_blueprint(
            data_root=self.data_root,
            project_view_root=self.preview_root,
            legacy_project_root=self.legacy_root,
            project_getter=project_getter,
            session_creator=session_creator,
            hermes_request=hermes_request,
            rate_limit_key="mini-product-test-key",
            free_project_limit=1,
            hermes_data_root=self.hermes_root,
            storage_min_free_bytes=0,
            tip_provider_url="https://tips.example.test/mini-frank",
            shared_comment_rate_limit=2,
        )
        app.register_blueprint(self.blueprint)
        app.testing = True
        self.client = app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def create_job(self, *, ip="203.0.113.50", headers=None, body=None):
        request_headers = {"X-Real-IP": ip, **(headers or {})}
        response = self.client.post(
            "/api/mini/jobs",
            json=body or {"problem": "Help my clinic reduce appointment no-shows."},
            headers=request_headers,
        )
        self.assertEqual(response.status_code, 202, response.get_data(as_text=True))
        return response.get_json()

    @staticmethod
    def owner_headers(created, **extra):
        return {"X-Mini-Claim": created["claim_token"], **extra}

    def mark_ready(self, created, *, guidance=None, self_host=None, industry_candidates=None):
        job_id = created["job"]["id"]
        workspace = self.data_root / "mini-shared" / "workspaces" / job_id
        public = workspace / "public"
        public.mkdir(parents=True, exist_ok=True)
        (public / "index.html").write_text("<html><body>Ready</body></html>", encoding="utf-8")
        (public / "build-notes.txt").write_text("Opened the static result locally.", encoding="utf-8")
        manifest = {
            "schema": RESULT_SCHEMA_V2,
            "job_id": job_id,
            "revision": 1,
            "result_type": "interactive",
            "title": "No-show follow-up kit",
            "summary": "A finished static follow-up kit for the clinic. Review it and request any revision for free.",
            "artifacts": [{
                "kind": "interactive",
                "label": "Open the follow-up kit",
                "url": f"https://preview.frank.fail/mini/{job_id}/",
            }],
            "details_url": f"https://preview.frank.fail/mini/{job_id}/build-notes.txt",
        }
        if guidance is not None:
            manifest["guidance"] = guidance
        if self_host is not None:
            manifest["self_host"] = self_host
        (workspace / "result.json").write_text(json.dumps(manifest), encoding="utf-8")
        if industry_candidates is not None:
            (workspace / "industry-candidates.json").write_text(
                json.dumps(industry_candidates), encoding="utf-8"
            )
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        jobs[job_id]["next_reconcile_at"] = 0
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        self.poll_status = "completed"
        self.blueprint.mini_reconcile_once()
        response = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.owner_headers(created))
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()["job"]

    def test_server_derives_stable_account_and_rejects_client_scope_substitution(self):
        rejected = self.client.post(
            "/api/mini/jobs",
            json={"problem": "Do work", "account_id": "acct_client_chosen_scope"},
        )
        self.assertEqual(rejected.status_code, 400)

        first = self.client.post("/api/mini/intakes", json={}, headers={"X-Real-IP": "203.0.113.1"}).get_json()
        second_response = self.client.post(
            "/api/mini/intakes",
            json={},
            headers={"X-Real-IP": "203.0.113.2", "X-Mini-Account-Claim": first["account_claim_token"]},
        )
        self.assertEqual(second_response.status_code, 201)
        second = second_response.get_json()
        self.assertEqual(first["intake"]["account_id"], second["intake"]["account_id"])

        submitted = self.client.post(
            f"/api/mini/intakes/{first['intake']['id']}/submit",
            json={"conversation": [{"role": "user", "text": "Build a booking reminder."}]},
            headers={"X-Mini-Claim": first["claim_token"]},
        )
        self.assertEqual(submitted.status_code, 202)
        self.assertEqual(submitted.get_json()["job"]["account_id"], first["intake"]["account_id"])
        self.assertEqual(
            self.client.get(
                f"/api/mini/jobs/{submitted.get_json()['job']['id']}",
                headers={"X-Mini-Claim": second["claim_token"]},
            ).status_code,
            404,
        )

        direct = self.create_job(ip="203.0.113.88")
        reopened = self.client.get(
            f"/api/mini/jobs/{direct['job']['id']}", headers=self.owner_headers(direct)
        )
        self.assertEqual(reopened.status_code, 200)
        recovered_account_claim = reopened.get_json()["account_claim_token"]
        continued = self.client.post(
            "/api/mini/intakes",
            json={},
            headers={
                "X-Real-IP": "203.0.113.89",
                "X-Mini-Account-Claim": recovered_account_claim,
            },
        )
        self.assertEqual(continued.status_code, 201)
        self.assertEqual(
            continued.get_json()["intake"]["account_id"], direct["job"]["account_id"]
        )

    def test_central_binding_and_private_hermes_memory_are_truthful(self):
        created = self.create_job()
        job = created["job"]
        receipt = job["binding_receipt"]
        self.assertEqual(receipt["source"], "governance/control-plane")
        self.assertEqual(receipt["references"]["project"], "project:mini-frank")
        self.assertEqual(receipt["references"]["runtime"], "runtime:hermes-default")
        self.assertEqual(receipt["references"]["memory_provider"], "service:hindsight")
        self.assertEqual(receipt["references"]["state_store"], "store:mini-frank-projects")
        self.assertNotIn("capabilities", receipt)
        knowledge = job["knowledge_binding"]
        self.assertEqual(knowledge["private"]["status"], "active")
        self.assertEqual(knowledge["shared_industry"]["status"], "unavailable")
        self.assertFalse(knowledge["client_scope_control"])
        self.assertEqual(self.sessions[0]["kwargs"]["memory_scope_override"], f"mini-job/{job['id']}")
        prompt = self.runs[0]["payload"]["input"]
        self.assertNotIn(job["account_id"], prompt)
        self.assertIn("industry-candidates.json", prompt)
        self.assertIn("shared-industry adapter is currently unavailable", prompt)
        self.assertTrue(created["customer_url"].startswith("/mini-frank/#project="))

    def test_result_gets_truthful_support_quality_and_releases_free_next_project(self):
        created = self.create_job(ip="203.0.113.77")
        job = self.mark_ready(created)
        self.assertEqual(job["quality"]["assessment"], "not_evaluated")
        self.assertTrue(job["quality"]["safe_ready"])
        self.assertEqual(job["guidance"]["source"], "frank_known")
        self.assertTrue(job["guidance"]["free_revisions"]["available"])
        self.assertEqual(job["guidance"]["related_free_projects"]["status"], "needs_owner_input")
        self.assertEqual(job["self_host"]["applicability"], "static_files")
        self.assertGreaterEqual(len(job["self_host"]["steps"]), 4)
        self.assertEqual(job["self_host"]["service"]["price_status"], "scope_required")
        next_project = self.client.post(
            "/api/mini/jobs",
            json={"problem": "Now help with inventory."},
            headers={"X-Real-IP": "203.0.113.77", "X-Mini-Account-Claim": created["account_claim_token"]},
        )
        self.assertEqual(next_project.status_code, 202, next_project.get_data(as_text=True))

    def test_valid_hermes_guidance_and_self_host_guide_are_preserved(self):
        guidance = {
            "schema": GUIDANCE_SCHEMA,
            "use_now": [{"title": "Use the SMS script", "why": "It addresses this clinic's missed confirmations.", "prompt": "Copy the script into the clinic's reminder tool."}],
            "free_revisions": [{"title": "Match the clinic tone", "why": "The owner may want different wording.", "prompt": "Rewrite the reminder in our calm, concise tone."}],
            "related_free_projects": [{"title": "Build a cancellation waitlist", "why": "It can fill appointments released by this flow.", "prompt": "Help me design a free cancellation waitlist project."}],
            "larger_project": {"status": "ready", "title": "Connect live reminders", "why": "Automation could remove manual sending.", "owner_prompt": "Scope a live reminder integration for this clinic."},
        }
        self_host = {
            "schema": SELF_HOST_SCHEMA,
            "applicability": "static_files",
            "overview": "This kit is a static site with no server runtime or database.",
            "requirements": ["The generated public folder", "A static HTTPS host"],
            "steps": [{"title": "Upload", "detail": "Upload index.html at the host's site root and open its HTTPS address."}],
            "operations": [{"area": "Monitoring", "detail": "Check the public page after every content update."}],
            "service_reason": "Frank can manage the static host if the owner does not want to maintain it.",
        }
        created = self.create_job()
        job = self.mark_ready(created, guidance=guidance, self_host=self_host)
        self.assertEqual(job["guidance"]["source"], "hermes_supplied")
        self.assertEqual(job["guidance"]["related_free_projects"]["status"], "ready")
        self.assertEqual(job["self_host"]["source"], "hermes_supplied")

    def test_industry_candidates_remain_private_until_hermes_adapter_exists(self):
        created = self.create_job()
        candidate = {
            "schema": "schema://frank.mini-industry-candidates/v1",
            "industry": "Australian medical spas",
            "candidates": [{
                "fact": "Public booking policies commonly distinguish consultations from treatment appointments.",
                "source_kind": "public_source",
                "source_reference": "A public industry source captured by Hermes",
                "confidence": "medium",
                "sensitivity": "public_general",
                "valid_until": "2027-08-30",
            }],
        }
        job = self.mark_ready(created, industry_candidates=candidate)
        receipt = job["industry_candidate_receipt"]
        self.assertEqual(receipt["status"], "captured_private")
        self.assertEqual(receipt["candidate_count"], 1)
        self.assertFalse(receipt["promoted"])
        self.assertNotIn(candidate["candidates"][0]["fact"], json.dumps(job))

    def test_share_comment_rotate_revoke_and_authority_boundaries(self):
        created = self.create_job()
        job = self.mark_ready(created)
        job_id = job["id"]
        shared = self.client.post(
            f"/api/mini/jobs/{job_id}/shares",
            json={"base_version": 1, "scope": "project", "role": "commenter"},
            headers=self.owner_headers(created),
        )
        self.assertEqual(shared.status_code, 201, shared.get_data(as_text=True))
        share = shared.get_json()["share"]
        token = share["token"]
        self.assertTrue(share["url"].startswith("/mini-frank/#share="))
        projection = self.client.get(f"/api/mini/shares/{token}")
        self.assertEqual(projection.status_code, 200)
        shared_payload = projection.get_json()["shared"]
        self.assertNotIn("job_id", shared_payload)
        self.assertNotIn("account_id", shared_payload)
        self.assertNotIn("owner_id", shared_payload)
        self.assertNotIn("claim_token", json.dumps(shared_payload))
        self.assertNotIn("requester_hash", json.dumps(shared_payload))
        self.assertFalse(shared_payload["share"]["can_execute"])
        shared_artifact_url = shared_payload["result"]["artifacts"][0]["url"]
        self.assertTrue(shared_artifact_url.startswith(f"/mini-frank/shared-artifacts/{token}/"))
        self.assertNotIn("preview.frank.fail/mini/", json.dumps(shared_payload))
        shared_artifact = self.client.get(shared_artifact_url, buffered=True)
        self.assertEqual(shared_artifact.status_code, 200)
        self.assertEqual(shared_artifact.headers["Cache-Control"], "no-store")
        self.assertEqual(shared_artifact.headers["Referrer-Policy"], "no-referrer")
        self.assertIn("script-src 'none'", shared_artifact.headers["Content-Security-Policy"])
        self.assertEqual(
            self.client.get(f"/mini-frank/shared-artifacts/{token}/.env").status_code,
            404,
        )

        comment = self.client.post(
            f"/api/mini/shares/{token}/comments",
            json={"base_version": 0, "text": "Could the opening line be shorter?"},
        )
        self.assertEqual(comment.status_code, 201, comment.get_data(as_text=True))
        conflict = self.client.post(
            f"/api/mini/shares/{token}/comments",
            json={"base_version": 0, "text": "This base is stale."},
        )
        self.assertEqual(conflict.status_code, 409)

        link_headers = {"X-Mini-Claim": token}
        self.assertEqual(
            self.client.post(f"/api/mini/jobs/{job_id}/changes", json={"change": "Run this"}, headers=link_headers).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                f"/api/mini/jobs/{job_id}/service-requests",
                json={"kind": "managed_hosting", "owner_reviewed": True},
                headers=link_headers,
            ).status_code,
            404,
        )

        rotated = self.client.post(
            f"/api/mini/jobs/{job_id}/shares/{share['id']}/rotate",
            json={"base_version": 2},
            headers=self.owner_headers(created),
        )
        self.assertEqual(rotated.status_code, 200)
        new_token = rotated.get_json()["share"]["token"]
        self.assertEqual(self.client.get(f"/api/mini/shares/{token}").status_code, 404)
        self.assertEqual(self.client.get(shared_artifact_url).status_code, 404)
        self.assertEqual(self.client.get(f"/api/mini/shares/{new_token}").status_code, 200)
        new_shared = self.client.get(f"/api/mini/shares/{new_token}").get_json()["shared"]
        new_artifact_url = new_shared["result"]["artifacts"][0]["url"]
        self.assertEqual(self.client.get(new_artifact_url, buffered=True).status_code, 200)

        revoked = self.client.post(
            f"/api/mini/jobs/{job_id}/shares/{share['id']}/revoke",
            json={"base_version": 3},
            headers=self.owner_headers(created),
        )
        self.assertEqual(revoked.status_code, 200)
        self.assertEqual(self.client.get(f"/api/mini/shares/{new_token}").status_code, 404)
        self.assertEqual(self.client.get(new_artifact_url).status_code, 404)

        owner = self.client.get(
            f"/api/mini/jobs/{job_id}", headers=self.owner_headers(created)
        ).get_json()["job"]
        owner_artifact_url = owner["result"]["artifacts"][0]["url"]
        self.assertTrue(owner_artifact_url.startswith(f"/mini-frank/owner-artifacts/{job_id}/"))
        self.assertNotIn("preview.frank.fail/mini/", json.dumps(owner["result"]))
        self.assertEqual(self.client.get(owner_artifact_url, buffered=True).status_code, 200)
        (self.preview_root / job_id / "downloads").mkdir(exist_ok=True)
        (self.preview_root / job_id / "downloads" / "owner-guide.pdf").write_bytes(b"PDF")
        owner_download_url = owner_artifact_url.rsplit("/", 1)[0] + "/downloads/owner-guide.pdf"
        owner_download = self.client.get(owner_download_url, buffered=True)
        self.assertEqual(owner_download.status_code, 200)
        self.assertTrue(owner_download.headers["Content-Disposition"].startswith("attachment;"))

    def test_tip_and_service_intents_never_change_entitlement_or_execute(self):
        tip = self.client.post("/api/mini/tips/checkout", json={})
        self.assertEqual(tip.status_code, 201)
        intent = tip.get_json()["intent"]
        self.assertFalse(intent["entitlement_changed"])
        self.assertFalse(intent["priority_changed"])
        self.assertTrue(intent["everything_remains_free"])

        created = self.create_job()
        job_id = created["job"]["id"]
        missing_review = self.client.post(
            f"/api/mini/jobs/{job_id}/service-handoffs",
            json={"kind": "video_call"},
            headers=self.owner_headers(created),
        )
        self.assertEqual(missing_review.status_code, 400)
        missing_contact = self.client.post(
            f"/api/mini/jobs/{job_id}/service-handoffs",
            json={"kind": "video_call", "owner_reviewed": True},
            headers=self.owner_headers(created),
        )
        self.assertEqual(missing_contact.status_code, 400)
        headers = self.owner_headers(created, **{"Idempotency-Key": "service-one"})
        service = self.client.post(
            f"/api/mini/jobs/{job_id}/service-handoffs",
            json={
                "kind": "video_call",
                "owner_reviewed": True,
                "note": "Discuss the booking integration.",
                "contact": {"method": "email", "value": "owner@example.test"},
            },
            headers=headers,
        )
        self.assertEqual(service.status_code, 201, service.get_data(as_text=True))
        payload = service.get_json()
        self.assertEqual(payload["request"]["status"], "saved_for_review")
        self.assertEqual(payload["request"]["price_status"], "scope_required")
        self.assertFalse(payload["notification_sent"])
        self.assertFalse(payload["execution_started"])
        replay = self.client.post(
            f"/api/mini/jobs/{job_id}/service-requests",
            json={
                "kind": "video_call",
                "owner_reviewed": True,
                "note": "Discuss the booking integration.",
                "contact": {"method": "email", "value": "owner@example.test"},
            },
            headers=headers,
        )
        self.assertEqual(replay.status_code, 200)
        self.assertTrue(replay.get_json()["replayed"])

        audit = self.client.get(f"/api/mini/jobs/{job_id}/audit", headers=self.owner_headers(created))
        audit_text = json.dumps(audit.get_json())
        self.assertNotIn("Discuss the booking integration", audit_text)
        self.assertNotIn(created["claim_token"], audit_text)

    def test_service_contact_reaches_only_the_attested_redacted_operator_queue(self):
        created = self.create_job(
            body={"problem": "Help my private clinic reduce appointment no-shows."}
        )
        job_id = created["job"]["id"]
        response = self.client.post(
            f"/api/mini/jobs/{job_id}/service-requests",
            json={
                "kind": "video_call",
                "owner_reviewed": True,
                "note": "Talk through the next integration step.",
                "contact": {"method": "phone", "value": "  +61 400 000 000  "},
            },
            headers=self.owner_headers(created, **{"Idempotency-Key": "private-contact"}),
        )
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        service = response.get_json()["request"]
        self.assertEqual(service["status"], "saved_for_review")
        self.assertEqual(service["contact"], {"method": "phone", "value": "+61 400 000 000"})
        self.assertFalse(service["notification_sent"])
        self.assertFalse(service["execution_started"])

        options = self.client.get(
            f"/api/mini/jobs/{job_id}/service-options", headers=self.owner_headers(created)
        ).get_json()
        self.assertEqual(options["status"], "available")
        self.assertTrue(options["contact"]["required"])
        self.assertEqual(options["contact"]["methods"], ["email", "phone", "whatsapp", "other"])
        self.assertEqual(options["price_status"], "scope_required")

        original = os.environ.pop("FRANK_BASIC_AUTH_HASH", None)
        try:
            unavailable = self.client.get("/api/operator/mini/service-requests")
            self.assertEqual(unavailable.status_code, 503)
            os.environ["FRANK_BASIC_AUTH_HASH"] = "test-operator-attestation"
            self.assertEqual(
                self.client.get("/api/operator/mini/service-requests").status_code, 401
            )
            self.assertEqual(
                self.client.get(
                    "/api/operator/mini/service-requests",
                    headers={"X-Frank-Operator-Attestation": "forged"},
                ).status_code,
                403,
            )
            queue = self.client.get(
                "/api/operator/mini/service-requests",
                headers={"X-Frank-Operator-Attestation": "test-operator-attestation"},
            )
            self.assertEqual(queue.status_code, 200, queue.get_data(as_text=True))
            queued = queue.get_json()["requests"]
            self.assertEqual(len(queued), 1)
            self.assertEqual(queued[0]["project"]["id"], "project:mini-frank")
            self.assertEqual(queued[0]["job"]["id"], job_id)
            self.assertEqual(queued[0]["request"]["contact"], service["contact"])
            queue_text = json.dumps(queue.get_json()).lower()
            self.assertNotIn(created["claim_token"].lower(), queue_text)
            self.assertNotIn("account_id", queue_text)
            self.assertNotIn("attachments", queue_text)
            self.assertNotIn("conversation", queue_text)
            self.assertNotIn("appointment no-shows", queue_text)

            detail = self.client.get(
                f"/api/operator/mini/service-requests/{service['id']}",
                headers={"X-Frank-Operator-Attestation": "test-operator-attestation"},
            )
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(
                detail.get_json()["service_request"]["request"]["id"], service["id"]
            )
        finally:
            if original is None:
                os.environ.pop("FRANK_BASIC_AUTH_HASH", None)
            else:
                os.environ["FRANK_BASIC_AUTH_HASH"] = original

    def test_service_note_boundary_is_2000_characters(self):
        created = self.create_job()
        job_id = created["job"]["id"]
        accepted = self.client.post(
            f"/api/mini/jobs/{job_id}/service-requests",
            json={
                "kind": "custom_project",
                "owner_reviewed": True,
                "note": "x" * 2000,
                "contact": {"method": "phone", "value": "+61 400 000 001"},
            },
            headers=self.owner_headers(created, **{"Idempotency-Key": "note-at-limit"}),
        )
        self.assertEqual(accepted.status_code, 201, accepted.get_data(as_text=True))
        rejected = self.client.post(
            f"/api/mini/jobs/{job_id}/service-requests",
            json={
                "kind": "custom_project",
                "owner_reviewed": True,
                "note": "x" * 2001,
                "contact": {"method": "phone", "value": "+61 400 000 001"},
            },
            headers=self.owner_headers(created, **{"Idempotency-Key": "note-over-limit"}),
        )
        self.assertEqual(rejected.status_code, 400)

    def test_leaving_link_mode_never_reactivates_an_old_bearer(self):
        created = self.create_job()
        job = self.mark_ready(created)
        job_id = job["id"]
        first = self.client.post(
            f"/api/mini/jobs/{job_id}/shares",
            json={"base_version": 1, "scope": "result", "role": "viewer"},
            headers=self.owner_headers(created),
        ).get_json()["share"]
        self.assertEqual(self.client.get(f"/api/mini/shares/{first['token']}").status_code, 200)
        published = self.client.patch(
            f"/api/mini/jobs/{job_id}/sharing",
            json={"base_version": 2, "mode": "published", "scope": "result", "role": "viewer"},
            headers=self.owner_headers(created),
        )
        self.assertEqual(published.status_code, 200)
        self.assertEqual(self.client.get(f"/api/mini/shares/{first['token']}").status_code, 404)
        published_read = self.client.get(f"/api/mini/published/{job_id}")
        self.assertEqual(published_read.status_code, 200)
        published_text = json.dumps(published_read.get_json())
        self.assertNotIn("account_id", published_text)
        self.assertNotIn("claim_token", published_text)
        self.assertNotIn("requester_hash", published_text)
        published_artifact_url = (
            published_read.get_json()["shared"]["result"]["artifacts"][0]["url"]
        )
        self.assertTrue(published_artifact_url.startswith("/mini-frank/published-artifacts/"))
        self.assertNotIn("preview.frank.fail/mini/", published_text)
        self.assertEqual(self.client.get(published_artifact_url, buffered=True).status_code, 200)
        restricted = self.client.patch(
            f"/api/mini/jobs/{job_id}/sharing",
            json={"base_version": 3, "mode": "restricted", "scope": "result", "role": "viewer"},
            headers=self.owner_headers(created),
        )
        self.assertEqual(restricted.status_code, 200)
        self.assertEqual(self.client.get(published_artifact_url).status_code, 404)
        stale_reactivation = self.client.patch(
            f"/api/mini/jobs/{job_id}/sharing",
            json={"base_version": 4, "mode": "link", "scope": "result", "role": "viewer"},
            headers=self.owner_headers(created),
        )
        self.assertEqual(stale_reactivation.status_code, 400)
        replacement = self.client.post(
            f"/api/mini/jobs/{job_id}/shares",
            json={"base_version": 4, "scope": "result", "role": "viewer"},
            headers=self.owner_headers(created),
        )
        self.assertEqual(replacement.status_code, 201)
        self.assertEqual(self.client.get(f"/api/mini/shares/{first['token']}").status_code, 404)

    def test_product_commands_are_idempotent_without_storing_bearer_tokens(self):
        created = self.create_job()
        job = self.mark_ready(created)
        job_id = job["id"]
        headers = self.owner_headers(created, **{"Idempotency-Key": "share-create-once"})
        body = {"base_version": 1, "scope": "project", "role": "commenter"}

        first_response = self.client.post(
            f"/api/mini/jobs/{job_id}/shares", json=body, headers=headers
        )
        self.assertEqual(first_response.status_code, 201, first_response.get_data(as_text=True))
        replay_response = self.client.post(
            f"/api/mini/jobs/{job_id}/shares", json=body, headers=headers
        )
        self.assertEqual(replay_response.status_code, 200, replay_response.get_data(as_text=True))
        first = first_response.get_json()
        replay = replay_response.get_json()
        self.assertEqual(replay["share"]["id"], first["share"]["id"])
        self.assertEqual(replay["share"]["token"], first["share"]["token"])

        changed = self.client.post(
            f"/api/mini/jobs/{job_id}/shares",
            json={**body, "role": "viewer"},
            headers=headers,
        )
        self.assertEqual(changed.status_code, 409)

        stored = json.loads((self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8"))[job_id]
        self.assertNotIn(first["share"]["token"], json.dumps(stored))
        created_events = [item for item in stored["audit"] if item["event"] == "share.created"]
        self.assertEqual(len(created_events), 1)

        comment_headers = {"Idempotency-Key": "comment-once"}
        comment_body = {"base_version": 0, "text": "Please shorten the opening."}
        comment_path = f"/api/mini/shares/{first['share']['token']}/comments"
        comment = self.client.post(comment_path, json=comment_body, headers=comment_headers)
        self.assertEqual(comment.status_code, 201, comment.get_data(as_text=True))
        comment_replay = self.client.post(comment_path, json=comment_body, headers=comment_headers)
        self.assertEqual(comment_replay.status_code, 200, comment_replay.get_data(as_text=True))
        self.assertEqual(comment_replay.get_json(), comment.get_json())

        comments = self.client.get(comment_path).get_json()["comments"]
        self.assertEqual(len(comments), 1)

    def test_shared_comments_are_link_scoped_rate_limited_and_never_evict_history(self):
        created = self.create_job()
        job = self.mark_ready(created)
        job_id = job["id"]
        project_share = self.client.post(
            f"/api/mini/jobs/{job_id}/shares",
            json={"base_version": 1, "scope": "project", "role": "commenter"},
            headers=self.owner_headers(created),
        ).get_json()["share"]
        project_path = f"/api/mini/shares/{project_share['token']}/comments"
        first = self.client.post(
            project_path,
            json={"base_version": 0, "text": "This discussion belongs to the whole project."},
            headers={"Idempotency-Key": "project-comment-one", "X-Real-IP": "198.51.100.90"},
        )
        self.assertEqual(first.status_code, 201, first.get_data(as_text=True))
        replay = self.client.post(
            project_path,
            json={"base_version": 0, "text": "This discussion belongs to the whole project."},
            headers={"Idempotency-Key": "project-comment-one", "X-Real-IP": "198.51.100.90"},
        )
        self.assertEqual(replay.status_code, 200)
        second = self.client.post(
            project_path,
            json={"base_version": 1, "text": "A second project-only comment."},
            headers={"Idempotency-Key": "project-comment-two", "X-Real-IP": "198.51.100.90"},
        )
        self.assertEqual(second.status_code, 201)
        limited = self.client.post(
            project_path,
            json={"base_version": 2, "text": "This exceeds the rolling link/network allowance."},
            headers={"Idempotency-Key": "project-comment-three", "X-Real-IP": "198.51.100.90"},
        )
        self.assertEqual(limited.status_code, 429)
        self.assertIn("Retry-After", limited.headers)

        revoked = self.client.post(
            f"/api/mini/jobs/{job_id}/shares/{project_share['id']}/revoke",
            json={"base_version": 2},
            headers=self.owner_headers(created),
        )
        self.assertEqual(revoked.status_code, 200)
        result_share = self.client.post(
            f"/api/mini/jobs/{job_id}/shares",
            json={"base_version": 3, "scope": "result", "role": "commenter"},
            headers=self.owner_headers(created),
        ).get_json()["share"]
        result_path = f"/api/mini/shares/{result_share['token']}/comments"
        result_comments = self.client.get(result_path).get_json()
        self.assertEqual(result_comments["version"], 2)
        self.assertEqual(result_comments["comments"], [])
        self.assertNotIn("job_id", result_comments)

        # Fill the bounded store with owner-visible history. A shared writer is
        # rejected and no earlier owner or collaborator comment is truncated.
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        existing = list(jobs[job_id]["comments"])
        existing.extend({
            "id": f"owner-{index}", "text": f"Owner history {index}",
            "kind": "comment", "author": "owner", "created_at": index,
        } for index in range(98))
        jobs[job_id]["comments"] = existing
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        full = self.client.post(
            result_path,
            json={"base_version": 2, "text": "Do not evict the owner history."},
            headers={"Idempotency-Key": "capacity-comment", "X-Real-IP": "198.51.100.91"},
        )
        self.assertEqual(full.status_code, 507)
        owner_comments = self.client.get(
            f"/api/mini/jobs/{job_id}/comments", headers=self.owner_headers(created)
        ).get_json()["comments"]
        self.assertEqual(len(owner_comments), 100)
        self.assertEqual(owner_comments[0]["text"], "This discussion belongs to the whole project.")

    def test_template_scope_is_rejected_until_a_real_template_projection_exists(self):
        created = self.create_job()
        job = self.mark_ready(created)
        rejected = self.client.post(
            f"/api/mini/jobs/{job['id']}/shares",
            json={"base_version": 1, "scope": "template", "role": "viewer"},
            headers=self.owner_headers(created),
        )
        self.assertEqual(rejected.status_code, 400)

    def test_shared_comment_capacity_reserves_space_for_the_owner(self):
        created = self.create_job()
        job = self.mark_ready(created)
        job_id = job["id"]
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        jobs[job_id]["comments"] = [{
            "id": f"shared-{index}", "text": f"Shared history {index}",
            "kind": "comment", "author": "commenter", "created_at": index,
            "share_id": f"historical-{index // 25}", "share_scope": "project",
            "share_generation": 1, "revision": 1,
        } for index in range(50)]
        jobs[job_id]["comment_version"] = 50
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")

        owner = self.client.post(
            f"/api/mini/jobs/{job_id}/comments",
            json={"base_version": 50, "text": "The owner still has reserved comment space."},
            headers=self.owner_headers(created),
        )
        self.assertEqual(owner.status_code, 201, owner.get_data(as_text=True))
        owner_read = self.client.get(
            f"/api/mini/jobs/{job_id}/comments", headers=self.owner_headers(created)
        ).get_json()["comments"]
        self.assertEqual(len(owner_read), 51)
        self.assertEqual(owner_read[-1]["author"], "owner")

    def test_tip_intent_is_fixed_and_replay_safe(self):
        headers = {"Idempotency-Key": "tip-once"}
        first = self.client.post("/api/mini/tips/intents", json={}, headers=headers)
        replay = self.client.post("/api/mini/tips/intents", json={}, headers=headers)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 201)
        self.assertEqual(first.get_json()["intent"]["id"], replay.get_json()["intent"]["id"])
        rejected_amount = self.client.post(
            "/api/mini/tips/intents", json={"amount": 25}, headers=headers
        )
        self.assertEqual(rejected_amount.status_code, 400)


if __name__ == "__main__":
    unittest.main()
