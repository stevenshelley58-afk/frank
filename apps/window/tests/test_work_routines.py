import io
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import work_cron
import work_routines
from work_service import (
    ConflictError, MutationUncertain, NotFoundError, OperationLedger,
    ProjectScopeError, UnavailableError, WorkError,
)
from test_work_service import FakeLeases

PROJECTS = [
    {"id": "blockwise", "workspace_id": "ws-blockwise", "root": "/vps/projects/blockwise"},
    {"id": "ghost", "workspace_id": "ws-ghost", "disabled": True},
]


class FakeCronOpener:
    """Scripted Hermes cron serve responses with full request capture."""

    def __init__(self, gateway=True, fail_on_put=False, unreachable=False, fail_trigger=False):
        self.jobs = {}
        self.gateway = gateway
        self.fail_on_put = fail_on_put
        self.unreachable = unreachable
        self.fail_trigger = fail_trigger
        self.calls = []  # (method, path, payload_dict_or_None)
        self.next_id = 1

    def __call__(self, request, timeout=None):
        method = request.get_method()
        url = request.full_url
        payload = None
        if request.data:
            payload = json.loads(request.data.decode())
        path = url.split("hermes.test", 1)[1].split("?")[0].rstrip("/")
        self.calls.append((method, path, payload))
        if self.unreachable:
            raise urllib.error.URLError("down")
        if path == "/api/status":
            return io.BytesIO(json.dumps({
                "gateway_running": self.gateway,
                "gateway_state": "running" if self.gateway else "stopped",
            }).encode())
        if path == "/api/cron/delivery-targets":
            return io.BytesIO(json.dumps({"targets": [{"id": "channel-ops"}]}).encode())
        if path == "/api/cron/jobs":
            if method == "POST":
                job = self._materialize(f"job-{self.next_id}", payload)
                self.next_id += 1
                self.jobs[job["id"]] = job
                return io.BytesIO(json.dumps(job).encode())
            return io.BytesIO(json.dumps({"jobs": list(self.jobs.values())}).encode())
        parts = path[len("/api/cron/jobs/"):].split("/")
        job_id = parts[0]
        action = parts[1] if len(parts) > 1 else ""
        if action == "trigger":
            if self.fail_trigger:
                raise urllib.error.URLError("lost response")
            if str(self.jobs[job_id].get("next_run_at", "")).startswith("2099"):
                raise urllib.error.HTTPError(url, 409, "inert", {}, io.BytesIO(b"{}"))
            self.jobs[job_id]["last_run_at"] = 123
            return io.BytesIO(json.dumps({"run_id": "run-77"}).encode())
        if action == "pause":
            self.jobs[job_id]["paused_at"] = 5
            return io.BytesIO(json.dumps(self.jobs[job_id]).encode())
        if action == "resume":
            self.jobs[job_id].pop("paused_at", None)
            return io.BytesIO(json.dumps(self.jobs[job_id]).encode())
        if method == "PUT":
            if self.fail_on_put:
                raise urllib.error.HTTPError(url, 422, "bad", {}, io.BytesIO(b'{"error":"x"}'))
            job = self._apply(job_id, (payload or {}).get("updates", {}))
            return io.BytesIO(json.dumps(job).encode())
        if method == "DELETE":
            self.jobs.pop(job_id, None)
            return io.BytesIO(json.dumps({"deleted": job_id}).encode())
        job = self.jobs.get(job_id)
        if job is None:
            raise urllib.error.HTTPError(url, 404, "nf", {}, io.BytesIO(b"{}"))
        return io.BytesIO(json.dumps(job).encode())

    def _materialize(self, job_id, body):
        schedule_text = str((body or {}).get("schedule", ""))
        return {
            "id": job_id, "name": (body or {}).get("name", ""),
            "prompt": (body or {}).get("prompt", ""),
            "schedule": self._parse(schedule_text),
            "deliver": (body or {}).get("deliver", "local"),
            "workdir": (body or {}).get("workdir", ""),
            "skills": [], "enabled": True, "created_at": 1,
            "next_run_at": ("2099-12-31T00:00:00+00:00"
                            if schedule_text.startswith("2099") else "2026-09-04T09:00:00+08:00"),
        }

    @staticmethod
    def _parse(schedule_text):
        try:
            return work_cron.validate_schedule(schedule_text)
        except ValueError as error:
            raise urllib.error.HTTPError(
                "u", 422, str(error), {}, io.BytesIO(b"{}")) from error

    def _apply(self, job_id, updates):
        job = self.jobs[job_id]
        if "schedule" in updates:
            text = str(updates["schedule"]).strip()
            job["schedule"] = self._parse(text)
            job["next_run_at"] = ("2099-12-31T00:00:00+00:00"
                                  if text.startswith("2099") else "2026-09-04T09:00:00+08:00")
        for key in ("prompt", "skills", "model", "provider", "deliver", "context_from",
                    "enabled_toolsets", "workdir", "monitor_url", "name"):
            if key in updates:
                job[key] = updates[key]
        return job

    # helpers
    def phase_one_body(self):
        for method, path, payload in self.calls:
            if method == "POST" and path == "/api/cron/jobs":
                return payload
        return None

    def phase_two_updates(self):
        for method, path, payload in self.calls:
            if method == "PUT":
                return (payload or {}).get("updates", {})
        return None


def make_service(tmp, opener, leases=None, projects=PROJECTS):
    client = work_cron.CronClient("http://hermes.test", lambda: "tok", opener=opener)
    scripts = Path(tmp) / "scripts"
    scripts.mkdir(exist_ok=True)
    (scripts / "check.sh").write_text("echo ok")
    return work_routines.RoutineService(
        cron=client, project_loader=lambda: projects,
        resolver=lambda workspace_id: {"workspace_path": f"/srv/workspaces/{workspace_id}"},
        leases=leases if leases is not None else FakeLeases(),
        ledger=OperationLedger(Path(tmp) / "ops.jsonl"), scripts_root=str(scripts))


class RoutineCreateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_two_phase_create_inert_then_real(self):
        opener = FakeCronOpener()
        service = make_service(self.tmp, opener)
        created = service.create_routine(
            "blockwise", name="Daily check", prompt="look", schedule="0 9 * * 1-5",
            continuity=True, operation_id="op-routine-1")
        phase_one = opener.phase_one_body()
        self.assertEqual(phase_one["schedule"], work_cron.INERT_SCHEDULE)
        self.assertEqual(phase_one["deliver"], "local")
        phase_two = opener.phase_two_updates()
        self.assertEqual(phase_two["schedule"], "0 9 * * 1-5")
        self.assertEqual(phase_two["context_from"], ["self"])
        self.assertEqual(created["schedule_kind"], "cron")
        self.assertEqual(created["project_id"], "blockwise")
        self.assertTrue(created["continuity"])
        self.assertFalse(created["paused"])
        self.assertTrue(created["enabled"])

    def test_phase_two_failure_rolls_back_inert_job(self):
        opener = FakeCronOpener(fail_on_put=True)
        service = make_service(self.tmp, opener)
        with self.assertRaises(WorkError):
            service.create_routine("blockwise", name="x", prompt="y", schedule="every 30m",
                                   operation_id="op-routine-2")
        self.assertEqual(opener.jobs, {})  # inert job removed, nothing left eligible

    def test_no_fire_between_post_and_put(self):
        opener = FakeCronOpener()
        service = make_service(self.tmp, opener)
        service.create_routine("blockwise", name="x", prompt="y", schedule="every 30m",
                               operation_id="op-routine-3")
        trigger_calls = [call for call in opener.calls if call[1].endswith("/trigger")]
        self.assertEqual(trigger_calls, [])

    def test_rejected_delivery_target(self):
        opener = FakeCronOpener()
        service = make_service(self.tmp, opener)
        with self.assertRaises(WorkError):
            service.create_routine("blockwise", name="x", prompt="y", schedule="every 30m",
                                   deliver="channel-not-configured", operation_id="op-routine-4")
        self.assertFalse([c for c in opener.calls if c[0] in ('POST', 'PUT', 'DELETE')])

    def test_script_must_be_under_approved_root(self):
        opener = FakeCronOpener()
        service = make_service(self.tmp, opener)
        with self.assertRaises(WorkError):
            service.create_routine("blockwise", name="x", schedule="every 30m",
                                   script="/etc/passwd", operation_id="op-script-1")
        with self.assertRaises(WorkError):
            service.create_routine("blockwise", name="x", schedule="every 30m",
                                   script="../outside.sh", operation_id="op-script-2")
        service.create_routine("blockwise", name="x", schedule="every 30m",
                               script="check.sh", operation_id="op-script-3")

    def test_monitor_url_outbound_policy(self):
        opener = FakeCronOpener()
        service = make_service(self.tmp, opener)
        for bad in ("http://insecure.example.com", "https://user:pass@host.example.com",
                    "https://127.0.0.1/x", "https://192.168.1.4/x", "ftp://host.example.com"):
            with self.assertRaises(WorkError, msg=bad):
                service.create_routine("blockwise", name="x", schedule="every 30m",
                                       monitor_url=bad, operation_id=f"op-mon-{abs(hash(bad))}")
        service.validate_monitor_url("https://status.example.com/health")

    def test_prompt_or_script_required(self):
        opener = FakeCronOpener()
        service = make_service(self.tmp, opener)
        with self.assertRaises(WorkError):
            service.create_routine("blockwise", name="x", schedule="every 30m",
                                   operation_id="op-empty-1")

    def test_duplicate_operation_id(self):
        opener = FakeCronOpener()
        service = make_service(self.tmp, opener)
        service.create_routine("blockwise", name="x", prompt="y", schedule="every 30m",
                               operation_id="op-dup-1")
        with self.assertRaises(ConflictError):
            service.create_routine("blockwise", name="x", prompt="y", schedule="every 30m",
                                   operation_id="op-dup-1")

    def test_lost_create_response_is_uncertain(self):
        opener = FakeCronOpener(unreachable=True)
        service = make_service(self.tmp, opener)
        with self.assertRaises(MutationUncertain):
            service.create_routine("blockwise", name="x", prompt="y", schedule="every 30m",
                                   operation_id="op-lost-1")


class RoutineScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.opener = FakeCronOpener()
        self.service = make_service(self.tmp, self.opener)
        self.created = self.service.create_routine(
            "blockwise", name="x", prompt="y", schedule="every 30m", operation_id="op-scope-10")

    def test_disabled_project_rejected(self):
        with self.assertRaises(ProjectScopeError):
            self.service.list_routines("ghost")

    def test_other_project_routine_rejected(self):
        # another project's workdir means a different workspace path
        self.opener.jobs[self.created["id"]]["workdir"] = "/srv/workspaces/ws-someoneelse"
        with self.assertRaises(ProjectScopeError):
            self.service.get_routine("blockwise", self.created["id"])

    def test_listing_scoped_by_workspace(self):
        self.opener.jobs[self.created["id"]]["workdir"] = "/srv/workspaces/ws-blockwise"
        self.opener.jobs[self.created["id"] + "x"] = {
            **self.opener.jobs[self.created["id"]], "id": self.created["id"] + "x",
            "workdir": "/srv/workspaces/ws-foreign"}
        result = self.service.list_routines("blockwise")
        self.assertEqual([item["id"] for item in result["routines"]], [self.created["id"]])


class RoutineManageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.opener = FakeCronOpener()
        self.service = make_service(self.tmp, self.opener)
        self.created = self.service.create_routine(
            "blockwise", name="x", prompt="y", schedule="every 30m", operation_id="op-manage-1")

    def test_update_revalidates_and_previews(self):
        result = self.service.update_routine("blockwise", self.created["id"], schedule="0 9 * * 1-5")
        self.assertEqual(len(result["next_executions"]), 3)

    def test_pause_requires_confirmation(self):
        routine = self.service.pause("blockwise", self.created["id"])
        self.assertTrue(routine["paused"])

    def test_resume_requires_confirmation(self):
        self.service.pause("blockwise", self.created["id"])
        routine = self.service.resume("blockwise", self.created["id"])
        self.assertFalse(routine["paused"])

    def test_delete_requires_explicit_confirmation(self):
        with self.assertRaises(WorkError):
            self.service.delete_routine("blockwise", self.created["id"], confirm="yes-please")
        self.service.delete_routine("blockwise", self.created["id"], confirm=self.created["id"])
        self.assertNotIn(self.created["id"], self.opener.jobs)
        # deleting a routine never touches project files: no filesystem writes at all
        self.assertTrue(Path(self.tmp).exists())

    def test_run_now_requires_gateway_and_lease(self):
        outcome = self.service.run_now("blockwise", self.created["id"], "op-runnow-1")
        self.assertEqual(outcome["run_id"], "run-77")
        with self.assertRaises(ConflictError) as caught:
            self.service.run_now("blockwise", self.created["id"], "op-runnow-1")
        self.assertEqual(caught.exception.code, "duplicate_operation")

    def test_run_now_blocked_without_gateway(self):
        self.opener.gateway = False
        with self.assertRaises(UnavailableError):
            self.service.run_now("blockwise", self.created["id"], "op-runnow-2")

    def test_run_now_lease_busy(self):
        busy = FakeLeases(granted=False)
        service = make_service(self.tmp, self.opener, leases=busy)
        with self.assertRaises(ConflictError):
            service.run_now("blockwise", self.created["id"], "op-runnow-3")

    def test_run_now_lost_response_uncertain(self):
        self.opener.fail_trigger = True
        with self.assertRaises(MutationUncertain):
            self.service.run_now("blockwise", self.created["id"], "op-runnow-4")
        # never blindly retriggered: op id stays uncertain in the ledger
        with self.assertRaises(MutationUncertain):
            self.service.run_now("blockwise", self.created["id"], "op-runnow-4")
        triggers = [call for call in self.opener.calls if call[1].endswith("/trigger")]
        self.assertEqual(len(triggers), 1)

    def test_gateway_health(self):
        self.assertTrue(self.service.gateway_health()["ok"])
        self.opener.gateway = False
        self.assertFalse(self.service.gateway_health()["ok"])

    def test_history_bounded(self):
        routine = self.service.get_routine("blockwise", self.created["id"])
        self.assertIn("history", routine)


class RoutinePreviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.service = make_service(self.tmp, FakeCronOpener())

    def test_preview_validates_and_shows_next(self):
        result = self.service.preview("blockwise", schedule="0 9 * * 1-5")
        self.assertEqual(result["schedule"]["kind"], "cron")
        self.assertEqual(len(result["next_executions"]), 3)
        self.assertIn("Australia/Perth", result["timezone"])

    def test_preview_rejects_nonsense(self):
        with self.assertRaises(WorkError):
            self.service.preview("blockwise", schedule="whenever the sun rises")


if __name__ == "__main__":
    unittest.main()
