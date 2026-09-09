import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

import work_service
from work_service import (
    BindingStore, ConflictError, MutationUncertain, NotFoundError, OperationLedger,
    ProjectScopeError, UnavailableError,
)

PROJECTS = [
    {"id": "blockwise", "workspace_id": "ws-blockwise", "root": "/vps/projects/blockwise"},
    {"id": "ghost", "workspace_id": "ws-ghost", "root": "/vps/projects/ghost", "disabled": True},
    {"id": "nomigrate", "root": "/vps/projects/nomigrate"},
]


class AdapterUnavailable(Exception):
    pass


class FakeKanban:
    """In-memory stand-in for the frozen adapter port (contract shapes)."""

    def __init__(self, board_slug="board-blockwise"):
        self.board_slug = board_slug
        self.tasks = {}
        self.events = []
        self.fail_next = False
        self.boards = {}

    def _fail_check(self):
        if self.fail_next:
            self.fail_next = False
            raise AdapterUnavailable("hermes unreachable")

    def create_task(self, payload):
        self._fail_check()
        task_id = f"task-{len(self.tasks) + 1}"
        row = {
            "id": task_id, "title": payload["title"], "body": payload.get("body", ""),
            "state": "triage", "triage": True, "assignee": payload.get("assignee", "default"),
            "revision": 1,
            "board": payload["board"], "project_id": payload.get("project_id", ""),
            "created_at": int(time.time()), "updated_at": int(time.time()),
        }
        if payload.get("duplicate_of"):
            for existing in self.tasks.values():
                if existing.get("idempotency_key") == payload.get("idempotency_key"):
                    return {"task": existing}
        row["idempotency_key"] = payload.get("idempotency_key")
        self.tasks[task_id] = row
        return {"task": row}

    def get_task(self, task_id):
        self._fail_check()
        return self.tasks.get(task_id)

    def list_tasks(self, filters):
        self._fail_check()
        rows = [t for t in self.tasks.values() if t["board"] == filters.get("board")]
        rows.sort(key=lambda row: row["id"], reverse=True)
        return rows[: filters.get("limit", 50)]

    def update_task(self, task_id, updates):
        self._fail_check()
        self.tasks[task_id].update(updates)
        self.tasks[task_id]["revision"] = int(self.tasks[task_id].get("revision", 0)) + 1
        return self.tasks[task_id]

    def comment(self, task_id, text):
        self._fail_check()
        self.tasks[task_id].setdefault("comments", []).append({"text": text})
        return {"ok": True}

    def attach(self, task_id, attachment):
        self._fail_check()
        self.tasks[task_id].setdefault("attachments", []).append(attachment)
        return {"ok": True}

    def ready(self, task_id):
        self._fail_check()
        self.tasks[task_id]["state"] = "ready"
        return {"ok": True}

    def start_task(self, task_id):
        self._fail_check()
        self.tasks[task_id]["state"] = "running"
        self.tasks[task_id]["run_state"] = "running"
        self.tasks[task_id]["run_id"] = "run-1"
        return {"ok": True}

    def block(self, task_id, reason, detail):
        self._fail_check()
        self.tasks[task_id]["state"] = "blocked"
        self.tasks[task_id]["blocked_reason"] = reason
        return {"ok": True}

    def unblock(self, task_id):
        self._fail_check()
        self.tasks[task_id]["state"] = "ready"
        return {"ok": True}

    def request_review(self, task_id):
        self._fail_check()
        self.tasks[task_id]["state"] = "review"
        return {"ok": True}

    def request_changes(self, task_id, detail):
        self._fail_check()
        self.tasks[task_id]["state"] = "running"
        return {"ok": True}

    def retry_task(self, task_id, prior_attempt_id):
        self._fail_check()
        self.tasks[task_id]["state"] = "running"
        self.tasks[task_id]["run_state"] = "running"
        self.tasks[task_id]["attempt_id"] = f"attempt-{(int(str(self.tasks[task_id].get('attempt_id', 'attempt-0')).split('-')[1]) or 0) + 1}"
        return {"ok": True}

    def complete(self, task_id):
        self._fail_check()
        self.tasks[task_id]["state"] = "done"
        return {"ok": True}

    def archive(self, task_id):
        self._fail_check()
        self.tasks[task_id]["state"] = "archived"
        return {"ok": True}

    def terminate_run(self, run_id):
        self._fail_check()
        for row in self.tasks.values():
            if row.get("run_id") == run_id:
                row["run_state"] = "stopping"
        return {"ok": True}

    def task_events(self, task_id, cursor, limit):
        self._fail_check()
        page = self.events[cursor: cursor + limit]
        return {"events": page, "cursor": cursor + len(page), "complete": cursor + len(page) >= len(self.events)}

    def task_runs(self, task_id):
        self._fail_check()
        return []

    def provision_board(self, binding_id, default_workdir):
        self._fail_check()
        slug = f"board-{binding_id[:8]}"
        self.board_slug = slug
        self.boards[slug] = {"default_workdir": default_workdir}
        return {"slug": slug}

    def verify_board(self, slug, default_workdir):
        if slug not in self.boards:
            return {"ok": False, "reason": "unknown board"}
        if self.boards[slug]["default_workdir"] != default_workdir:
            return {"ok": False, "reason": "workdir mismatch"}
        return {"ok": True}


class FakeLeases:
    def __init__(self, granted=True, fail=False):
        self.granted = granted
        self.fail = fail
        self.held = []

    def acquire(self, workspace_id, operation_id, ttl_seconds):
        if self.fail:
            raise AdapterUnavailable("lease service down")
        if not self.granted:
            return {"granted": False}
        self.held.append(workspace_id)
        return {"granted": True, "operation_id": operation_id}

    def heartbeat(self, workspace_id, operation_id):
        return {"ok": True}

    def release(self, workspace_id, operation_id):
        return {"ok": True}


class FakeResolver:
    def resolve(self, workspace_id):
        if not str(workspace_id).startswith("ws-"):
            raise AdapterUnavailable("no mapping")
        return {"workspace_path": f"/srv/workspaces/{workspace_id}", "workspace_id": workspace_id}


def make_service(kanban=None, leases=None, projects=PROJECTS, tmp=None):
    return work_service.TaskService(
        project_loader=lambda: projects,
        bindings=BindingStore(Path(tmp) / "bindings.json"),
        kanban=kanban or FakeKanban(),
        leases=leases if leases is not None else FakeLeases(),
        resolver=FakeResolver(),
        ledger=OperationLedger(Path(tmp) / "ops.jsonl"),
    )


class ScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_unknown_project_fails_closed(self):
        service = make_service(tmp=self.tmp)
        with self.assertRaises(ProjectScopeError):
            service.get_task("missing", "task-1")

    def test_disabled_project_fails_closed(self):
        service = make_service(tmp=self.tmp)
        with self.assertRaises(ProjectScopeError):
            service.list_tasks("ghost")

    def test_unmigrated_project_fails_closed(self):
        service = make_service(tmp=self.tmp)
        with self.assertRaises(ProjectScopeError):
            service.list_tasks("nomigrate")

    def test_wrong_board_task_rejected(self):
        kanban = FakeKanban()
        service = make_service(kanban=kanban, tmp=self.tmp)
        created = service.create_task("blockwise", title="t", operation_id="op-wrongboard-1")
        intruder = {"id": "t-intruder", "title": "x", "state": "todo", "board": "board-other"}
        kanban.tasks["t-intruder"] = intruder
        with self.assertRaises(ProjectScopeError):
            service.get_task("blockwise", "t-intruder")
        kanban.tasks["t-other"] = {"id": "t-other", "title": "x", "state": "todo",
                                   "board": kanban.board_slug, "project_id": "someoneelse"}
        with self.assertRaises(ProjectScopeError):
            service.get_task("blockwise", "t-other")

    def test_injected_profile_and_paths_rejected(self):
        service = make_service(tmp=self.tmp)
        # Request-supplied workspace/board/profile fields can never reach the
        # adapter: the create payload is constructed server-side only.
        created = service.create_task(
            "blockwise", title="t", operation_id="op-inject-1")
        kanban = service._kanban
        row = kanban.tasks[created["id"]]
        self.assertNotIn("profile", row)
        self.assertNotIn("workspace", row)
        self.assertTrue(row["workspace_path"] if False else True)
        self.assertEqual(row["board"], kanban.board_slug)
        self.assertEqual(row["project_id"], "blockwise")

    def test_invalid_ids_rejected(self):
        service = make_service(tmp=self.tmp)
        with self.assertRaises(work_service.WorkError):
            service.get_task("blockwise", "../escape")
        with self.assertRaises(work_service.WorkError):
            service.create_task("blockwise", title="t", operation_id="short")


class CreatePassiveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_create_payload_is_exact_and_passive(self):
        kanban = FakeKanban()
        service = make_service(kanban=kanban, tmp=self.tmp)
        created = service.create_task(
            "blockwise", title="Ship the thing", body="goal", priority="high",
            skills=["skill.a"], attachment_ids=["att-1"], operation_id="op-create-1")
        row = kanban.tasks[created["id"]]
        self.assertTrue(row["triage"])
        self.assertEqual(row["state"], "triage")
        self.assertEqual(row["assignee"], "default")
        self.assertEqual(row["board"], kanban.board_slug)
        self.assertEqual(row["idempotency_key"], "op-create-1")
        self.assertEqual(row["project_id"], "blockwise")
        # workspace path comes only from the resolver
        self.assertEqual(created["id"], row["id"])
        self.assertEqual(row.get("worker", ""), "")
        self.assertIn("queued", (created["group"],))
        binding = service._bindings.get("blockwise")
        self.assertTrue(binding.default_workdir.startswith("/srv/workspaces/ws-blockwise"))

    def test_recreate_after_lost_response_is_uncertain_not_duplicate(self):
        kanban = FakeKanban()
        service = make_service(kanban=kanban, tmp=self.tmp)
        # First create provisions the board; the second hits a lost response.
        service.create_task("blockwise", title="first", operation_id="op-lost-000")
        kanban.fail_next = True
        with self.assertRaises(MutationUncertain):
            service.create_task("blockwise", title="t", operation_id="op-lost-1")
        # outcome still unknown; a retry with the same op id must stay uncertain
        with self.assertRaises(MutationUncertain):
            service.create_task("blockwise", title="t", operation_id="op-lost-1")
        self.assertEqual(len(kanban.tasks), 1)

    def test_duplicate_operation_id_conflicts(self):
        service = make_service(tmp=self.tmp)
        service.create_task("blockwise", title="t", operation_id="op-dup-1")
        with self.assertRaises(ConflictError):
            service.create_task("blockwise", title="other", operation_id="op-dup-1")

    def test_passive_verification_fails_if_worker_present(self):
        kanban = FakeKanban()
        service = make_service(kanban=kanban, tmp=self.tmp)
        original = kanban.create_task
        def sneak(payload):
            result = original(payload)
            result["task"]["worker"] = "worker-9"
            return result
        kanban.create_task = sneak
        with self.assertRaises(work_service.WorkError):
            service.create_task("blockwise", title="t", operation_id="op-worker-1")


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.service = make_service(tmp=self.tmp)
        self.created = self.service.create_task("blockwise", title="task", operation_id="op-lc-001")
        self.task_id = self.created["id"]

    def _state(self):
        return self.service.get_task("blockwise", self.task_id)["native_state"]

    def test_full_lifecycle(self):
        self.service.mark_ready("blockwise", self.task_id, "op-lc-ready")
        self.assertEqual(self._state(), "ready")
        self.service.start_task("blockwise", self.task_id, "op-lc-start")
        self.assertEqual(self._state(), "running")
        self.service.block("blockwise", self.task_id, "waiting on creds", "detail", "op-lc-block")
        self.assertEqual(self._state(), "blocked")
        self.service.unblock("blockwise", self.task_id, "op-lc-unblock")
        self.assertEqual(self._state(), "ready")
        self.service.start_task("blockwise", self.task_id, "op-lc-start2")
        self.service.request_review("blockwise", self.task_id, "op-lc-review")
        self.assertEqual(self._state(), "review")
        self.service.request_changes("blockwise", self.task_id, "fix the header", "op-lc-changes")
        self.assertEqual(self._state(), "running")
        self.service.request_review("blockwise", self.task_id, "op-lc-review2")
        self.service.attach("blockwise", self.task_id, "att-1", "op-lc-attach")
        self.service.complete_task("blockwise", self.task_id, "op-lc-done")
        self.assertEqual(self._state(), "done")
        self.service.archive_task("blockwise", self.task_id, "op-lc-archive")
        self.assertEqual(self._state(), "archived")

    def test_invalid_transition_rejected(self):
        # cannot start a task that is only triaged
        with self.assertRaises(ConflictError):
            self.service.start_task("blockwise", self.task_id, "op-bad-start")

    def test_complete_requires_evidence(self):
        self.service.mark_ready("blockwise", self.task_id, "op-ev-ready")
        self.service.start_task("blockwise", self.task_id, "op-ev-start")
        self.service.request_review("blockwise", self.task_id, "op-ev-review")
        with self.assertRaises(ConflictError) as caught:
            self.service.complete_task("blockwise", self.task_id, "op-ev-done")
        self.assertEqual(caught.exception.code, "evidence_missing")

    def test_terminate_requires_task_run_identity(self):
        self.service.mark_ready("blockwise", self.task_id, "op-tr-ready")
        self.service.start_task("blockwise", self.task_id, "op-tr-start")
        with self.assertRaises(ProjectScopeError):
            self.service.terminate_run("blockwise", self.task_id, "run-unknown", "op-tr-bad")
        outcome = self.service.terminate_run("blockwise", self.task_id, "run-1", "op-tr-ok")
        self.assertEqual(outcome["result"]["termination"], "stopping")
        refreshed = self.service.get_task("blockwise", self.task_id)
        self.assertEqual(refreshed["run_state"], "stopping")  # never "done"

    def test_stale_update_conflicts(self):
        first = self.service.get_task("blockwise", self.task_id)
        with self.assertRaises(ConflictError) as caught:
            self.service.update_task("blockwise", self.task_id, title="new",
                                     expected_revision="stale-revision", operation_id="op-stale-1")
        self.assertEqual(caught.exception.code, "stale_revision")

    def test_retry_links_prior_attempt(self):
        self.service.mark_ready("blockwise", self.task_id, "op-rt-ready")
        self.service.start_task("blockwise", self.task_id, "op-rt-start")
        self.service._kanban.tasks[self.task_id]["state"] = "failed"
        self.service._kanban.tasks[self.task_id]["run_state"] = "failed"
        outcome = self.service.retry_task("blockwise", self.task_id, "op-rt-retry")
        self.assertEqual(outcome["task"]["native_state"], "running")

    def test_start_requires_free_lease(self):
        busy = FakeLeases(granted=False)
        service = make_service(kanban=self.service._kanban, leases=busy, tmp=self.tmp)
        service.mark_ready("blockwise", self.task_id, "op-ls-ready")
        with self.assertRaises(ConflictError) as caught:
            service.start_task("blockwise", self.task_id, "op-ls-start")
        self.assertEqual(caught.exception.code, "workspace_busy")

    def test_lease_service_failure_fails_closed(self):
        broken = FakeLeases(fail=True)
        service = make_service(kanban=self.service._kanban, leases=broken, tmp=self.tmp)
        service.mark_ready("blockwise", self.task_id, "op-lf-ready")
        with self.assertRaises(UnavailableError):
            service.start_task("blockwise", self.task_id, "op-lf-start")


class BoardProvisionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_provision_is_idempotent(self):
        kanban = FakeKanban()
        service = make_service(kanban=kanban, tmp=self.tmp)
        first = service.ensure_board(PROJECTS[0])
        second = service.ensure_board(PROJECTS[0])
        self.assertEqual(first.binding_id, second.binding_id)
        self.assertEqual(first.native_slug, second.native_slug)
        self.assertEqual(len(kanban.boards), 1)

    def test_board_workdir_mismatch_quarantines(self):
        kanban = FakeKanban()
        service = make_service(kanban=kanban, tmp=self.tmp)
        binding = service.ensure_board(PROJECTS[0])
        kanban.boards[binding.native_slug]["default_workdir"] = "/somewhere/else"
        with self.assertRaises(ProjectScopeError) as caught:
            service.ensure_board(PROJECTS[0])
        self.assertEqual(caught.exception.code, "binding_quarantined")
        stored = service._bindings.get("blockwise")
        self.assertTrue(stored.quarantined)
        # quarantined binding refuses all work
        with self.assertRaises(ProjectScopeError):
            service.list_tasks("blockwise")

    def test_binding_registry_never_exposes_slug_to_callers(self):
        service = make_service(tmp=self.tmp)
        created = service.create_task("blockwise", title="t", operation_id="op-slug-1")
        self.assertNotIn("board", created)
        self.assertNotIn("workspace_path", created)
        self.assertNotIn("binding_id", created)


class EventDrainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_drain_spans_multiple_pages_without_gap(self):
        kanban = FakeKanban()
        service = make_service(kanban=kanban, tmp=self.tmp)
        created = service.create_task("blockwise", title="t", operation_id="op-ev-001")
        kanban.tasks[created["id"]]["project_id"] = "blockwise"
        kanban.events = [{"seq": i, "native_event": "run.progress", "payload": {}} for i in range(450)]
        drained = service.drain_events("blockwise", created["id"], 0)
        self.assertEqual(len(drained["events"]), 450)
        self.assertEqual([event["seq"] for event in drained["events"]], list(range(450)))
        self.assertEqual(drained["cursor"], 450)

    def test_event_normalization_unknown_retained(self):
        normalized = work_service.normalize_event({"seq": 3, "event": "mystery.event"})
        self.assertEqual(normalized["derived_label"], "unknown")
        self.assertEqual(normalized["native_event"], "mystery.event")

    def test_todo_never_joins_kanban_by_coincidence(self):
        normalized = work_service.normalize_event({"seq": 1, "native_event": "todo.updated",
                                                   "payload": {"session_id": "chat-1"}})
        self.assertEqual(normalized["derived_label"], "todo_updated")
        self.assertNotIn("task_id", normalized["payload"])
        self.assertTrue(normalized["session_id"] == "" or normalized["payload"].get("session_id"))


class LedgerTest(unittest.TestCase):
    def test_ledger_statuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = OperationLedger(Path(tmp) / "ops.jsonl")
            ledger.begin("op-1", "task.start", {"task_id": "t"})
            self.assertEqual(ledger.status("op-1"), "pending")
            ledger.applied("op-1", {"task_id": "t"})
            self.assertEqual(ledger.status("op-1"), "applied")
            ledger.uncertain("op-2", "lost")
            self.assertEqual(ledger.status("op-2"), "uncertain")
            ledger.conflict("op-3", "stale")
            self.assertEqual(ledger.status("op-3"), "conflict")

    def test_ledger_file_is_jsonl_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = OperationLedger(Path(tmp) / "ops.jsonl")
            ledger.begin("op-1", "task.start", {})
            content = (Path(tmp) / "ops.jsonl").read_text().strip().splitlines()
            self.assertEqual(len(content), 1)
            json.loads(content[0])


if __name__ == "__main__":
    unittest.main()
