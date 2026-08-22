import json
import tempfile
import unittest
from pathlib import Path

from flask import Flask

from mini_frank import RESULT_SCHEMA, create_blueprint


class MiniFrankTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.data_root = root / "data"
        self.project_root = root / "project"
        self.runs = []
        self.sessions = []
        self.fail_next_run = False
        self.invalid_next_run = False
        self.poll_status = "started"

        def project_getter(project_id):
            return {"id": project_id, "root": project_id, "name": "Mini Frank"} if project_id == "mini-frank" else None

        def session_creator(project, **kwargs):
            session = {"id": f"session-{len(self.sessions) + 1}"}
            self.sessions.append({"project": project, "kwargs": kwargs, "session": session})
            return session

        def hermes_request(path, payload=None, **kwargs):
            if path == "/v1/runs":
                if self.fail_next_run:
                    self.fail_next_run = False
                    raise OSError("Hermes unavailable")
                if self.invalid_next_run:
                    self.invalid_next_run = False
                    return {"status": "started"}
                run = {"run_id": f"run-{len(self.runs) + 1}", "payload": payload}
                self.runs.append(run)
                return {"run_id": run["run_id"], "status": "started"}
            if path.startswith("/v1/runs/"):
                return {"run_id": path.rsplit("/", 1)[-1], "status": self.poll_status}
            raise AssertionError(f"unexpected Hermes request: {path}")

        self.project_getter = project_getter
        self.session_creator = session_creator
        self.hermes_request = hermes_request
        self.client = self.make_client()

    def make_client(self, *, priority_payment_url=""):
        app = Flask(__name__)
        app.register_blueprint(create_blueprint(
            data_root=self.data_root,
            project_view_root=self.project_root,
            project_getter=self.project_getter,
            session_creator=self.session_creator,
            hermes_request=self.hermes_request,
            rate_limit_key="test-rate-limit-key",
            priority_payment_url=priority_payment_url,
            daily_limit=3,
        ))
        app.testing = True
        return app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def create_job(self, *, email="owner@example.com", ip="203.0.113.10", **overrides):
        payload = {
            "problem": "I need customers to book appointments without calling me.",
            "email": email,
            "delivery": "free",
        }
        payload.update(overrides)
        return self.client.post("/api/mini/jobs", json=payload, headers={"X-Real-IP": ip})

    def test_create_dispatches_real_hermes_run_and_seals_claim(self):
        response = self.create_job(outcome="Five more bookings each week")
        self.assertEqual(response.status_code, 202)
        body = response.get_json()
        self.assertEqual(body["job"]["stage"], "working")
        self.assertEqual(len(self.sessions), 1)
        self.assertEqual(len(self.runs), 1)
        self.assertEqual(self.runs[0]["payload"]["session_id"], "session-1")
        self.assertIn("Five more bookings each week", self.runs[0]["payload"]["input"])
        stored = (self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8")
        self.assertNotIn(body["claim_token"], stored)
        self.assertNotIn("pin", stored.lower())

    def test_claim_link_and_email_instruction_are_deterministic_without_storing_token(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        claim_token = created["claim_token"]
        customer_link = f"https://frank.fail/mini/#project={job_id}&key={claim_token}"
        first_prompt = self.runs[0]["payload"]["input"]
        self.assertIn(f"send one concise transactional email to owner@example.com", first_prompt)
        self.assertIn(f"link only to {customer_link}", first_prompt)

        changed = self.client.post(
            f"/api/mini/jobs/{job_id}/changes",
            json={"change": "Add a choice for evening appointments.", "delivery": "free"},
            headers={"X-Mini-Claim": claim_token},
        )
        self.assertEqual(changed.status_code, 202)
        self.assertIn(f"link only to {customer_link}", self.runs[1]["payload"]["input"])
        stored = (self.data_root / "mini" / "jobs.json").read_text(encoding="utf-8")
        self.assertNotIn(claim_token, stored)
        self.assertNotIn("claim_token", stored)

    def test_claim_is_required_and_polling_does_not_fake_progress(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        self.assertEqual(self.client.get(f"/api/mini/jobs/{job_id}").status_code, 404)
        headers = {"X-Mini-Claim": created["claim_token"]}
        first = self.client.get(f"/api/mini/jobs/{job_id}", headers=headers).get_json()["job"]
        second = self.client.get(f"/api/mini/jobs/{job_id}", headers=headers).get_json()["job"]
        self.assertEqual(first["stage"], "working")
        self.assertEqual(second["stage"], "working")

    def test_verified_manifest_makes_real_artifact_ready(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        result_dir = self.project_root / "customer-projects" / job_id
        result_dir.mkdir(parents=True)
        result = {
            "schema": RESULT_SCHEMA,
            "job_id": job_id,
            "title": "Appointment booking",
            "summary": "A working booking page that collects appointment requests. It works on mobile and keeps the source downloadable.",
            "artifact_url": f"https://preview.frank.fail/mini/{job_id}/",
            "source_url": f"https://preview.frank.fail/mini/{job_id}/source.zip",
            "details_url": f"https://preview.frank.fail/mini/{job_id}/build-notes.txt",
        }
        (result_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
        response = self.client.get(
            f"/api/mini/jobs/{job_id}", headers={"X-Mini-Claim": created["claim_token"]}
        )
        job = response.get_json()["job"]
        self.assertEqual(job["stage"], "ready")
        self.assertEqual(job["result"]["artifact_url"], result["artifact_url"])

    def test_invalid_manifest_is_ignored_without_breaking_polling(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        result_dir = self.project_root / "customer-projects" / job_id
        result_dir.mkdir(parents=True)
        invalid = {
            "schema": RESULT_SCHEMA,
            "job_id": job_id,
            "title": "Appointment booking",
            "summary": "short",
            "artifact_url": f"https://preview.frank.fail/mini/{job_id}/",
            "source_url": f"https://preview.frank.fail/mini/{job_id}/source.zip",
            "details_url": f"https://preview.frank.fail/mini/{job_id}/build-notes.txt",
            "private_note": "must never be exposed",
        }
        (result_dir / "result.json").write_text(json.dumps(invalid), encoding="utf-8")
        response = self.client.get(
            f"/api/mini/jobs/{job_id}", headers={"X-Mini-Claim": created["claim_token"]}
        )
        self.assertEqual(response.status_code, 200)
        job = response.get_json()["job"]
        self.assertEqual(job["stage"], "working")
        self.assertNotIn("result", job)

    def test_change_uses_same_session_and_creates_new_run(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        response = self.client.post(
            f"/api/mini/jobs/{job_id}/changes",
            json={"change": "Also ask whether the customer needs an evening appointment.", "delivery": "free"},
            headers={"X-Mini-Claim": created["claim_token"]},
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json()["job"]["revision"], 2)
        self.assertEqual(len(self.sessions), 1)
        self.assertEqual(len(self.runs), 2)
        self.assertEqual(self.runs[1]["payload"]["session_id"], "session-1")

    def test_one_active_job_per_email_and_daily_ip_limit(self):
        self.assertEqual(self.create_job().status_code, 202)
        self.assertEqual(self.create_job().status_code, 409)
        self.assertEqual(self.create_job(email="two@example.com").status_code, 202)
        self.assertEqual(self.create_job(email="three@example.com").status_code, 202)
        limited = self.create_job(email="four@example.com")
        self.assertEqual(limited.status_code, 429)

    def test_daily_limit_counts_only_free_jobs(self):
        client = self.make_client(priority_payment_url="https://pay.example/checkout")
        for index in range(4):
            response = client.post("/api/mini/jobs", json={
                "problem": "I need customers to book appointments without calling me.",
                "email": f"priority-{index}@example.com",
                "delivery": "priority",
            }, headers={"X-Real-IP": "203.0.113.20"})
            self.assertEqual(response.status_code, 202)
        for index in range(3):
            response = client.post("/api/mini/jobs", json={
                "problem": "I need customers to book appointments without calling me.",
                "email": f"free-{index}@example.com",
                "delivery": "free",
            }, headers={"X-Real-IP": "203.0.113.20"})
            self.assertEqual(response.status_code, 202)
        limited = client.post("/api/mini/jobs", json={
            "problem": "I need customers to book appointments without calling me.",
            "email": "free-limited@example.com",
            "delivery": "free",
        }, headers={"X-Real-IP": "203.0.113.20"})
        self.assertEqual(limited.status_code, 429)

    def test_offer_endpoint_notifies_once_without_exposing_claim(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        claim_token = created["claim_token"]
        headers = {"X-Mini-Claim": claim_token}
        response = self.client.post(f"/api/mini/jobs/{job_id}/offer", headers=headers)
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.get_json()["job"]["offer_requested"])
        self.assertEqual(len(self.runs), 2)
        offer_payload = self.runs[1]["payload"]
        self.assertEqual(offer_payload["session_id"], "session-1")
        self.assertIn("Customer: owner@example.com", offer_payload["input"])
        self.assertIn(f"Project: {job_id}", offer_payload["input"])
        self.assertNotIn(claim_token, json.dumps(offer_payload))

        duplicate = self.client.post(f"/api/mini/jobs/{job_id}/offer", headers=headers)
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(len(self.runs), 2)

    def test_failed_offer_notification_can_be_retried(self):
        created = self.create_job().get_json()
        job_id = created["job"]["id"]
        headers = {"X-Mini-Claim": created["claim_token"]}
        self.fail_next_run = True
        first = self.client.post(f"/api/mini/jobs/{job_id}/offer", headers=headers)
        self.assertEqual(first.status_code, 202)
        self.assertTrue(first.get_json()["job"]["offer_requested"])
        second = self.client.post(f"/api/mini/jobs/{job_id}/offer", headers=headers)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(len(self.runs), 2)

    def test_json_requests_fail_with_json_errors(self):
        malformed = self.client.post(
            "/api/mini/jobs", data="{", content_type="application/json"
        )
        self.assertEqual(malformed.status_code, 400)
        self.assertTrue(malformed.is_json)

        created = self.create_job().get_json()
        invalid_change = self.client.post(
            f"/api/mini/jobs/{created['job']['id']}/changes",
            json=[], headers={"X-Mini-Claim": created["claim_token"]},
        )
        self.assertEqual(invalid_change.status_code, 400)
        self.assertEqual(invalid_change.get_json()["error"], "Request body must be a JSON object.")

    def test_priority_is_visible_but_fails_closed_without_checkout(self):
        config = self.client.get("/api/mini/config").get_json()
        self.assertFalse(config["priority_available"])
        response = self.create_job(delivery="priority")
        self.assertEqual(response.status_code, 503)
        self.assertIn("Choose free", response.get_json()["error"])

    def test_rejects_bad_email_and_short_problem(self):
        self.assertEqual(self.create_job(email="not-an-email").status_code, 400)
        self.assertEqual(self.create_job(problem="help").status_code, 400)


if __name__ == "__main__":
    unittest.main()
