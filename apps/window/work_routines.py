"""Frank work routines: typed scheduled operations over Hermes cron jobs.

Session-4-owned routines module. Routines are real Hermes cron jobs under
``/api/cron/jobs``; nothing here schedules, fires, or stores job state. Create
is inert-first and two-phase: phase one POSTs the job with a provably
non-firing far-future ``once`` schedule and local/no delivery; phase two
applies typed allowlisted fields plus the real schedule through
``PUT {updates:{...}}`` and re-reads the entire job before it becomes
eligible. A failed phase two rolls the inert phase-one job back.
"""
from __future__ import annotations

import ipaddress
import re
import time
import uuid
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import work_cron
from work_service import (
    ConflictError, MutationUncertain, NotFoundError, OperationLedger, ProjectScopeError,
    UnavailableError, WorkError, require_id, require_plain_text,
)

NAME_LIMIT = 120
PROMPT_LIMIT = 8000
MAX_SKILLS = 16

# Typed allowlist for the phase-two PUT. A raw browser ``updates`` object is
# never accepted; each field here is validated server-side before it is sent.
ALLOWED_UPDATES = {
    "schedule", "skills", "model", "provider", "base_url", "deliver",
    "context_from", "enabled_toolsets", "workdir", "monitor_script",
    "monitor_url", "prompt", "name",
}
_DELIVER_LOCAL = "local"
CONTINUITY_CONTEXT = ["self"]


class RoutineService:
    def __init__(self, *, cron: work_cron.CronClient, project_loader: Callable[[], list[dict]],
                 resolver: Callable[[str], dict], leases, ledger: OperationLedger,
                 scripts_root: str | Path = ""):
        self._cron = cron
        self._projects = project_loader
        self._resolver = resolver
        self._leases = leases
        self._ledger = ledger
        self._scripts_root = Path(scripts_root).resolve() if scripts_root else None

    # -- scope ---------------------------------------------------------------

    def project(self, project_id: str) -> dict:
        pid = require_id(project_id, "project id", re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$"))
        project = next((item for item in (self._projects() or []) if str(item.get("id")) == pid), None)
        if not project:
            raise ProjectScopeError("unknown project", status=404)
        if project.get("disabled") or project.get("quarantined"):
            raise ProjectScopeError("project is not enabled for work", status=403)
        workspace_id = str(project.get("workspace_id") or "")
        if not workspace_id:
            raise ProjectScopeError("project workspace binding is not migrated yet", status=409)
        return project

    def _workspace_path(self, project: dict) -> str:
        try:
            resolver = getattr(self._resolver, "resolve", self._resolver)
            resolved = resolver(str(project["workspace_id"]))
        except Exception as error:
            raise UnavailableError(f"workspace resolver unavailable: {str(error)[:160]}") from None
        path = str((resolved or {}).get("workspace_path") or "")
        if not path:
            raise UnavailableError("workspace resolver returned no canonical path")
        return path

    def _owned_job(self, project: dict, job_id: str) -> dict:
        jid = require_id(job_id, "routine id", re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$"))
        try:
            job = self._cron.get_job(jid)
        except work_cron.CronClientUnavailable as error:
            raise UnavailableError(str(error)) from None
        except work_cron.CronClientError as error:
            if error.status == 404:
                raise NotFoundError("routine not found") from None
            raise UnavailableError(str(error)) from None
        if not isinstance(job, dict) or not job:
            raise NotFoundError("routine not found")
        job_workdir = str(job.get("workdir") or "")
        canonical = self._workspace_path(project)
        if job_workdir != canonical:
            raise ProjectScopeError("routine belongs to another project", status=403, code="wrong_project")
        return job

    # -- validation ----------------------------------------------------------

    @staticmethod
    def validate_monitor_url(url: object) -> str:
        text = str(url or "").strip()[:500]
        if not text:
            return ""
        parsed = urlparse(text)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise WorkError("monitor URL must be an https URL without credentials", status=400)
        host = parsed.hostname or ""
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if "." not in host and host != "localhost":
                raise WorkError("monitor URL host is not a public hostname", status=400) from None
            return text
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise WorkError("monitor URL must not target a private address", status=400)
        return text

    def validate_script(self, script: object) -> str:
        text = str(script or "").strip()[:500]
        if not text:
            return ""
        if self._scripts_root is None:
            raise UnavailableError("approved Hermes scripts root is not configured")
        candidate = Path(text)
        if not candidate.is_absolute():
            candidate = self._scripts_root / candidate
        try:
            resolved = candidate.resolve()
            resolved.relative_to(self._scripts_root)
        except (ValueError, OSError) as error:
            raise WorkError("script must live beneath the approved Hermes scripts root", status=400) from error
        if not resolved.is_file():
            raise WorkError("script does not exist beneath the approved Hermes scripts root", status=400)
        return str(resolved)

    @staticmethod
    def validate_continuity(continuity: object) -> list[str] | None:
        if continuity is None:
            return None
        if bool(continuity) is True:
            return list(CONTINUITY_CONTEXT)
        return []

    def _validate_delivery(self, deliver: object) -> str:
        text = str(deliver or "").strip()
        if not text or text == _DELIVER_LOCAL:
            return _DELIVER_LOCAL
        try:
            targets = self._cron.delivery_targets()
        except work_cron.CronClientUnavailable as error:
            raise UnavailableError(str(error)) from None
        except work_cron.CronClientError as error:
            raise UnavailableError(str(error)) from None
        known = {str(target.get("id") or target.get("name") or "") for target in targets}
        if text not in known:
            raise WorkError("delivery destination is not a configured Hermes target", status=400)
        return text

    @staticmethod
    def validate_toolsets(toolsets: object) -> list[str] | None:
        if toolsets is None:
            return None
        if not isinstance(toolsets, list) or len(toolsets) > 24:
            raise WorkError("enabled toolsets must be a short list", status=400)
        return [str(item).strip()[:80] for item in toolsets if str(item).strip()]

    # -- create (two-phase) --------------------------------------------------

    def preview(self, project_id: str, *, schedule: object) -> dict:
        project = self.project(project_id)
        try:
            parsed = work_cron.validate_schedule(str(schedule or ""))
            upcoming = work_cron.next_executions(str(schedule or ""), count=3)
        except ValueError as error:
            raise WorkError(str(error), status=400) from error
        return {"project_id": str(project["id"]), "schedule": parsed,
                "timezone": str(work_cron.display_timezone()), "next_executions": upcoming}

    def create_routine(self, project_id: str, *, name: object, prompt: object = "",
                       script: object = "", schedule: object, skills: object = None,
                       model: object = None, provider: object = None,
                       continuity: object = None, deliver: object = None,
                       enabled_toolsets: object = None, monitor_url: object = None,
                       operation_id: object) -> dict:
        project = self.project(project_id)
        op_id = require_id(operation_id, "operation id",
                           re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$"))
        if self._ledger.status(op_id) in {"applied", "uncertain"}:
            raise ConflictError("this operation id was already used; reconcile first",
                                code="duplicate_operation")
        clean_name = require_plain_text(name, "name", NAME_LIMIT, required=True)
        clean_prompt = str(prompt or "").strip()[:PROMPT_LIMIT]
        clean_script = self.validate_script(script)
        if not clean_prompt and not clean_script:
            raise WorkError("a routine needs a prompt or a validated script", status=400)
        try:
            parsed_schedule = work_cron.validate_schedule(str(schedule or ""))
        except ValueError as error:
            raise WorkError(str(error), status=400) from error
        clean_skills = [require_id(item, "skill id",
                                   re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$"))
                        for item in (skills or [])][:MAX_SKILLS]
        clean_deliver = self._validate_delivery(deliver)
        clean_toolsets = self.validate_toolsets(enabled_toolsets)
        clean_monitor = self.validate_monitor_url(monitor_url)
        continuity_context = self.validate_continuity(continuity)
        workdir = self._workspace_path(project)

        # --- Phase one: inert, local, provably non-firing --------------------
        self._ledger.begin(op_id, "routine.create", {"project_id": str(project["id"]), "name": clean_name})
        try:
            created = self._cron.create_job({
                "name": clean_name,
                "prompt": clean_prompt,
                "script": clean_script or None,
                "schedule": work_cron.INERT_SCHEDULE,
                "deliver": _DELIVER_LOCAL,
                "workdir": workdir,
            })
        except work_cron.CronClientUnavailable as error:
            self._ledger.uncertain(op_id, str(error)[:160])
            raise MutationUncertain(f"routine create is uncertain: {str(error)[:140]}", op_id) from None
        except work_cron.CronClientError as error:
            self._ledger.conflict(op_id, str(error)[:160])
            raise WorkError(f"Hermes rejected the routine: {str(error)[:160]}", status=502) from None
        job_id = str(created.get("id") or "") if isinstance(created, dict) else ""
        if not job_id:
            self._ledger.uncertain(op_id, "create response lacked a job id")
            raise MutationUncertain("routine create is uncertain: no job id", op_id)
        try:
            inert = self._cron.get_job(job_id)
            if not isinstance(inert, dict):
                raise work_cron.CronClientError("inert job re-read failed")
            next_run = inert.get("next_run_at")
            if not next_run or not str(next_run).startswith("2099"):
                raise work_cron.CronClientError("phase-one job is not provably inert")
            if str(inert.get("deliver") or "") != _DELIVER_LOCAL:
                raise work_cron.CronClientError("phase-one job is not local/no-delivery")
        except work_cron.CronClientError as error:
            self._rollback(job_id)
            self._ledger.conflict(op_id, f"phase-one verification failed: {str(error)[:140]}")
            raise WorkError(f"routine phase one failed verification: {str(error)[:160]}", status=502) from None

        # --- Phase two: typed allowlisted fields plus the real schedule ------
        updates: dict = {"schedule": str(schedule).strip()}
        if clean_prompt:
            updates["prompt"] = clean_prompt
        if clean_skills:
            updates["skills"] = clean_skills
        if model:
            updates["model"] = require_plain_text(model, "model", 120)
        if provider:
            updates["provider"] = require_plain_text(provider, "provider", 120)
        if clean_deliver:
            updates["deliver"] = clean_deliver
        if continuity_context is not None:
            updates["context_from"] = continuity_context
        if clean_toolsets:
            updates["enabled_toolsets"] = clean_toolsets
        if clean_monitor:
            updates["monitor_url"] = clean_monitor
        try:
            self._cron.update_job(job_id, updates)
            final = self._cron.get_job(job_id)
        except work_cron.CronClientUnavailable as error:
            self._rollback(job_id)
            self._ledger.uncertain(op_id, str(error)[:160])
            raise MutationUncertain(f"routine phase two is uncertain: {str(error)[:140]}", op_id) from None
        except work_cron.CronClientError as error:
            self._rollback(job_id)
            self._ledger.conflict(op_id, f"phase two rejected: {str(error)[:140]}")
            raise WorkError(f"routine activation failed and the inert job was rolled back: {str(error)[:160]}",
                            status=502) from None
        try:
            self._verify_final(final, parsed_schedule, clean_deliver, continuity_context)
        except WorkError:
            self._rollback(job_id)
            self._ledger.conflict(op_id, "phase-two re-read failed validation")
            raise
        self._ledger.applied(op_id, {"job_id": job_id})
        return self.project_routine(final, project)

    def _verify_final(self, job: dict, parsed_schedule: dict, deliver: str,
                      continuity: list[str] | None) -> None:
        if not isinstance(job, dict) or not job:
            raise WorkError("routine re-read after activation returned nothing", status=502)
        schedule = job.get("schedule") or {}
        if str(schedule.get("kind") or "") != parsed_schedule["kind"]:
            raise WorkError("activated routine schedule kind does not match the request", status=502)
        if parsed_schedule["kind"] == "cron" and str(schedule.get("expr") or "") != parsed_schedule["expr"]:
            raise WorkError("activated routine schedule expression does not match the request", status=502)
        if parsed_schedule["kind"] == "interval" and int(schedule.get("minutes") or 0) != parsed_schedule["minutes"]:
            raise WorkError("activated routine interval does not match the request", status=502)
        if deliver and str(job.get("deliver") or "") != deliver:
            raise WorkError("activated routine delivery does not match the request", status=502)
        if continuity is not None:
            if [str(item) for item in (job.get("context_from") or [])] != continuity:
                raise WorkError("activated routine continuity does not match the request", status=502)
        if not job.get("next_run_at") or str(job.get("next_run_at")).startswith("2099"):
            raise WorkError("activated routine still carries the inert schedule", status=502)
        if job.get("paused_at"):
            raise WorkError("activated routine is unexpectedly paused", status=502)

    def _rollback(self, job_id: str) -> None:
        try:
            self._cron.delete_job(job_id)
        except Exception:
            pass  # rollback best-effort; the inert job cannot fire regardless

    # -- read / manage -------------------------------------------------------

    def project_routine(self, job: dict, project: dict) -> dict:
        schedule = job.get("schedule") or {}
        return {
            "id": str(job.get("id") or ""),
            "project_id": str(project["id"]),
            "name": str(job.get("name") or ""),
            "schedule_display": str(job.get("schedule_display") or schedule.get("display") or ""),
            "schedule_kind": str(schedule.get("kind") or ""),
            "timezone": str(work_cron.display_timezone()),
            "deliver": str(job.get("deliver") or ""),
            "continuity": [str(item) for item in (job.get("context_from") or [])] == CONTINUITY_CONTEXT,
            "skills": [str(item) for item in (job.get("skills") or [])],
            "model": str(job.get("model") or ""),
            "provider": str(job.get("provider") or ""),
            "monitor_url": str(job.get("monitor_url") or ""),
            "enabled": bool(job.get("enabled")) and not job.get("paused_at"),
            "state": str(job.get("state") or ""),
            "paused": bool(job.get("paused_at")),
            "created_at": job.get("created_at"),
            "next_run_at": job.get("next_run_at"),
            "last_run_at": job.get("last_run_at"),
            "last_status": job.get("last_status"),
            "last_error": str(job.get("last_error") or "")[:300],
            "failure_streak": int(job.get("failure_streak") or 0),
        }

    def list_routines(self, project_id: str) -> dict:
        project = self.project(project_id)
        canonical = self._workspace_path(project)
        try:
            jobs = self._cron.list_jobs()
        except work_cron.CronClientUnavailable as error:
            raise UnavailableError(str(error)) from None
        except work_cron.CronClientError as error:
            raise UnavailableError(str(error)) from None
        mine = [job for job in jobs if str(job.get("workdir") or "") == canonical]
        routines = [self.project_routine(job, project) for job in mine]
        return {"routines": routines, "generated_at": int(time.time())}

    def get_routine(self, project_id: str, job_id: str) -> dict:
        project = self.project(project_id)
        job = self._owned_job(project, job_id)
        routine = self.project_routine(job, project)
        try:
            history = self._cron.job_runs(str(job["id"]))
        except (work_cron.CronClientUnavailable, work_cron.CronClientError) as error:
            routine["history_unavailable"] = str(error)[:160]
            history = []
        routine["history"] = [
            {key: item.get(key) for key in ("id", "started_at", "finished_at", "status", "error")}
            for item in history[-20:] if isinstance(item, dict)
        ]
        return routine

    def _require_gateway(self) -> None:
        try:
            health = self._cron.gateway_health()
        except work_cron.CronClientUnavailable as error:
            raise UnavailableError(f"gateway health unavailable: {str(error)[:160]}") from None
        if not health.get("ok"):
            raise UnavailableError("the Hermes gateway daemon that fires schedules is not healthy")

    def _lease_or_fail(self, project: dict) -> str:
        if self._leases is None:
            raise UnavailableError("workspace lease service is not configured")
        op_id = f"lease-{uuid.uuid4().hex}"
        try:
            result = self._leases.acquire(str(project["workspace_id"]), op_id, 300)
        except Exception as error:
            raise UnavailableError(f"workspace lease unavailable: {str(error)[:160]}") from None
        if not result.get("granted"):
            raise ConflictError("the project workspace is busy; run-now stays queued", code="workspace_busy")
        return op_id

    def run_now(self, project_id: str, job_id: str, operation_id: object) -> dict:
        project = self.project(project_id)
        job = self._owned_job(project, job_id)
        op_id = require_id(operation_id, "operation id",
                           re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$"))
        prior = self._ledger.status(op_id)
        if prior == "applied":
            raise ConflictError("this operation id was already used; reconcile first",
                                code="duplicate_operation")
        if prior == "uncertain":
            raise MutationUncertain(
                "a prior run-now attempt is uncertain; reconcile against run history before retrying",
                op_id)
        self._require_gateway()
        self._ledger.begin(op_id, "routine.run_now", {"job_id": str(job["id"])})
        lease_op = self._lease_or_fail(project)
        try:
            try:
                result = self._cron.trigger_job(str(job["id"]))
            except work_cron.CronClientUnavailable as error:
                # A lost response is uncertain: it is reconciled against run
                # history, never blindly triggered again.
                self._ledger.uncertain(op_id, str(error)[:160])
                raise MutationUncertain(f"run-now is uncertain: {str(error)[:140]}", op_id) from None
            except work_cron.CronClientError as error:
                self._ledger.conflict(op_id, str(error)[:160])
                raise WorkError(f"Hermes rejected run-now: {str(error)[:160]}", status=502) from None
        finally:
            try:
                self._leases.release(str(project["workspace_id"]), lease_op)
            except Exception:
                pass
        self._ledger.applied(op_id, {"job_id": str(job["id"])})
        run_id = str((result or {}).get("run_id") or (result or {}).get("id") or "")
        return {"operation_id": op_id, "job_id": str(job["id"]), "run_id": run_id,
                "status": "triggered" if run_id else "triggered_unconfirmed"}

    def pause(self, project_id: str, job_id: str, operation_id: object = None) -> dict:
        project = self.project(project_id)
        job = self._owned_job(project, job_id)
        try:
            self._cron.pause_job(str(job["id"]))
            refreshed = self._cron.get_job(str(job["id"]))
        except (work_cron.CronClientUnavailable, work_cron.CronClientError) as error:
            raise UnavailableError(str(error)) from None
        if not (isinstance(refreshed, dict) and (refreshed.get("paused_at") or refreshed.get("state") == "paused")):
            raise WorkError("Hermes did not confirm the pause", status=502)
        return self.project_routine(refreshed, project)

    def resume(self, project_id: str, job_id: str, operation_id: object = None) -> dict:
        project = self.project(project_id)
        job = self._owned_job(project, job_id)
        try:
            self._cron.resume_job(str(job["id"]))
            refreshed = self._cron.get_job(str(job["id"]))
        except (work_cron.CronClientUnavailable, work_cron.CronClientError) as error:
            raise UnavailableError(str(error)) from None
        if not isinstance(refreshed, dict) or refreshed.get("paused_at") or refreshed.get("state") == "paused":
            raise WorkError("Hermes did not confirm the resume", status=502)
        return self.project_routine(refreshed, project)

    def update_routine(self, project_id: str, job_id: str, *, schedule: object = None,
                       prompt: object = None, name: object = None, skills: object = None,
                       model: object = None, provider: object = None,
                       continuity: object = None, deliver: object = None,
                       enabled_toolsets: object = None, monitor_url: object = None) -> dict:
        project = self.project(project_id)
        job = self._owned_job(project, job_id)
        updates: dict = {}
        if schedule is not None:
            try:
                parsed = work_cron.validate_schedule(str(schedule))
            except ValueError as error:
                raise WorkError(str(error), status=400) from error
            updates["schedule"] = str(schedule).strip()
            upcoming = work_cron.next_executions(str(schedule))
        else:
            parsed = None
            upcoming = None
        if prompt is not None:
            updates["prompt"] = require_plain_text(prompt, "prompt", PROMPT_LIMIT, required=True)
        if name is not None:
            updates["name"] = require_plain_text(name, "name", NAME_LIMIT, required=True)
        if skills is not None:
            updates["skills"] = [require_id(item, "skill id",
                                            re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$"))
                                 for item in (skills or [])][:MAX_SKILLS]
        if model is not None:
            updates["model"] = require_plain_text(model, "model", 120)
        if provider is not None:
            updates["provider"] = require_plain_text(provider, "provider", 120)
        if deliver is not None:
            updates["deliver"] = self._validate_delivery(deliver)
        if continuity is not None:
            updates["context_from"] = self.validate_continuity(continuity)
        if enabled_toolsets is not None:
            updates["enabled_toolsets"] = self.validate_toolsets(enabled_toolsets)
        if monitor_url is not None:
            clean = self.validate_monitor_url(monitor_url)
            if clean:
                updates["monitor_url"] = clean
        if not updates:
            raise WorkError("no permitted routine changes were supplied", status=400)
        # Re-validate the merged schedule and preview it before anything is sent.
        if parsed is None:
            existing = job.get("schedule") or {}
            if existing.get("kind") == "cron":
                work_cron.validate_cron_expression(str(existing.get("expr") or ""))
        try:
            self._cron.update_job(str(job["id"]), updates)
            refreshed = self._cron.get_job(str(job["id"]))
        except (work_cron.CronClientUnavailable, work_cron.CronClientError) as error:
            raise UnavailableError(str(error)) from None
        if isinstance(parsed, dict):
            self._verify_final(refreshed, parsed, str(updates.get("deliver") or job.get("deliver") or ""),
                               updates.get("context_from") if "context_from" in updates else None)
        return {"routine": self.project_routine(refreshed, project),
                "next_executions": upcoming or []}

    def delete_routine(self, project_id: str, job_id: str, *, confirm: object) -> dict:
        """Delete requires explicit confirmation and never touches project
        files or prior task artifacts — only the Hermes cron job row."""
        project = self.project(project_id)
        job = self._owned_job(project, job_id)
        if str(confirm or "") != str(job.get("id") or ""):
            raise WorkError("deletion requires the exact routine id as confirmation", status=400)
        try:
            self._cron.delete_job(str(job["id"]))
        except work_cron.CronClientUnavailable as error:
            raise UnavailableError(str(error)) from None
        except work_cron.CronClientError as error:
            raise WorkError(f"Hermes rejected the deletion: {str(error)[:160]}", status=502) from None
        return {"deleted": str(job["id"])}

    def gateway_health(self) -> dict:
        try:
            return self._cron.gateway_health()
        except work_cron.CronClientUnavailable as error:
            return {"ok": False, "reason": str(error)[:160]}
