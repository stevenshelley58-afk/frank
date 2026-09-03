import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import work_api
from flask import Flask

from test_work_service import FakeKanban, FakeLeases, FakeResolver, PROJECTS

import work_service
import work_cron
import work_routines


def configure_app(tmp, kanban, leases=None):
    app = Flask(__name__)
    app.register_blueprint(work_api.api)
    scripts = Path(tmp) / "scripts"
    scripts.mkdir(exist_ok=True)
    from test_work_routines import FakeCronOpener
    client = work_cron.CronClient("http://hermes.test", lambda: "tok", opener=FakeCronOpener())
    work_api.configure(
        project_loader=lambda: [dict(p) for p in PROJECTS],
        kanban=kanban,
        resolver=FakeResolver(),
        leases=leases or FakeLeases(),
        cron_client=client,
    )
    work_api._ledger = work_service.OperationLedger(Path(tmp) / "ops.jsonl")
    work_api._bindings = work_service.BindingStore(Path(tmp) / "bindings.json")
    work_api._scripts_root = str(scripts)
    return app


class WorkApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.kanban = FakeKanban()
        self.app = configure_app(self.tmp, self.kanban)
        self.client = self.app.test_client()

    def test_read_does_not_require_origin(self):
        response = self.client.get("/api/work/tasks?project_id=blockwise")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertIn("tasks", body)

    def test_mutation_requires_origin(self):
        response = self.client.post("/api/work/tasks", data=json.dumps({"project_id": "blockwise", "title": "t"}),
                                    content_type="application/json")
        self.assertEqual(response.status_code, 403)

    def test_mutation_requires_allowlisted_origin(self):
        response = self.client.post(
            "/api/work/tasks", data=json.dumps({"project_id": "blockwise", "title": "t"}),
            content_type="application/json", headers={"Origin": "https://evil.example.com"})
        self.assertEqual(response.status_code, 403)

    def test_mutation_requires_json_content_type(self):
        response = self.client.post(
            "/api/work/tasks", data="title=t", content_type="application/x-www-form-urlencoded",
            headers={"Origin": "http://localhost:5000"})
        self.assertEqual(response.status_code, 415)

    def test_create_task_roundtrip(self):
        response = self.client.post(
            "/api/work/tasks",
            data=json.dumps({"project_id": "blockwise", "title": "Ship", "operation_id": "op-api-1"}),
            content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(response.status_code, 201)
        body = response.get_json()
        self.assertEqual(body["native_state"], "triage")
        self.assertEqual(body["group"], "queued")

    def test_create_unknown_project_scoped(self):
        response = self.client.post(
            "/api/work/tasks",
            data=json.dumps({"project_id": "nope", "title": "t", "operation_id": "op-api-2"}),
            content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(response.status_code, 404)

    def test_task_get_cross_project_fails(self):
        created = self.client.post(
            "/api/work/tasks",
            data=json.dumps({"project_id": "blockwise", "title": "t", "operation_id": "op-api-3"}),
            content_type="application/json", headers={"Origin": "http://localhost:5000"}).get_json()
        self.kanban.tasks["intruder"] = {"id": "intruder", "title": "x", "state": "todo",
                                         "board": "board-other"}
        response = self.client.get("/api/work/tasks/intruder?project_id=blockwise")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["code"], "wrong_board")

    def test_actions_happy_path(self):
        created = self.client.post(
            "/api/work/tasks",
            data=json.dumps({"project_id": "blockwise", "title": "t", "operation_id": "op-api-4"}),
            content_type="application/json", headers={"Origin": "http://localhost:5000"}).get_json()
        task_id = created["id"]
        ready = self.client.post(f"/api/work/tasks/{task_id}/actions/ready",
                                 data=json.dumps({"project_id": "blockwise", "operation_id": "op-api-5"}),
                                 content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.get_json()["task"]["native_state"], "ready")
        started = self.client.post(f"/api/work/tasks/{task_id}/actions/start",
                                   data=json.dumps({"project_id": "blockwise", "operation_id": "op-api-6"}),
                                   content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.get_json()["task"]["native_state"], "running")

    def test_action_conflict_visible(self):
        created = self.client.post(
            "/api/work/tasks",
            data=json.dumps({"project_id": "blockwise", "title": "t", "operation_id": "op-api-7"}),
            content_type="application/json", headers={"Origin": "http://localhost:5000"}).get_json()
        response = self.client.post(f"/api/work/tasks/{created['id']}/actions/start",
                                    data=json.dumps({"project_id": "blockwise", "operation_id": "op-api-8"}),
                                    content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(response.status_code, 409)

    def test_routine_preview_and_create(self):
        preview = self.client.post("/api/work/routines/preview",
                                   data=json.dumps({"project_id": "blockwise", "schedule": "0 9 * * 1-5"}),
                                   content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(len(preview.get_json()["next_executions"]), 3)
        created = self.client.post("/api/work/routines",
                                   data=json.dumps({"project_id": "blockwise", "name": "n",
                                                    "prompt": "p", "schedule": "0 9 * * 1-5",
                                                    "operation_id": "op-api-9"}),
                                   content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.get_json()["schedule_kind"], "cron")

    def test_hub_projections_shapes(self):
        for endpoint, status in (("/api/work/hub/overnight", "empty"),
                                 ("/api/work/hub/waiting", "empty"),
                                 ("/api/work/hub/running", "empty")):
            response = self.client.get(endpoint)
            self.assertEqual(response.status_code, 200, endpoint)
            body = response.get_json()
            self.assertEqual(body["schema"], "schema://frank.widget-snapshot/v1")
            self.assertEqual(body["status"], status, endpoint)
            self.assertEqual(body["source_truth"], "hermes")

    def test_acknowledge_requires_origin(self):
        response = self.client.post("/api/work/hub/acknowledge", data=json.dumps({}),
                                    content_type="application/json")
        self.assertEqual(response.status_code, 403)
        ok = self.client.post("/api/work/hub/acknowledge", data=json.dumps({}),
                              content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.assertEqual(ok.status_code, 200)
        self.assertIn("acknowledged_at", ok.get_json())

    def test_hub_waiting_populates_from_tasks(self):
        self.client.post("/api/work/tasks",
                         data=json.dumps({"project_id": "blockwise", "title": "waiting work",
                                          "operation_id": "op-api-10"}),
                         content_type="application/json", headers={"Origin": "http://localhost:5000"})
        self.kanban.tasks["task-1"]["state"] = "blocked"
        body = self.client.get("/api/work/hub/waiting").get_json()
        self.assertEqual(body["status"], "ready")
        self.assertEqual(body["data"]["count"], 1)
        self.assertEqual(body["data"]["rows"][0]["native_state"], "blocked")


if __name__ == "__main__":
    unittest.main()
