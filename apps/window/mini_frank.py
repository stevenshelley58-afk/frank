"""Public Mini Frank transport.

Frank accepts and displays customer work. Hermes remains the sole agent,
model, tool, skill, memory, and execution owner.
"""
from __future__ import annotations

import hashlib
import hmac
import base64
import json
import re
import secrets
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Callable

from flask import Blueprint, abort, current_app, jsonify, request
from werkzeug.exceptions import HTTPException


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
ACTIVE_STAGES = {"queued", "working", "checking"}
RUNNING_STATUSES = {"queued", "started", "running", "in_progress", "stopping"}
PREVIEW_PREFIX = "https://preview.frank.fail/mini/"
RESULT_SCHEMA = "schema://frank.mini-result/v1"
RESULT_FIELDS = {
    "schema", "job_id", "title", "summary", "artifact_url", "source_url", "details_url",
}


class MiniFrankStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()

    def _load_locked(self) -> dict[str, dict]:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("Mini Frank job storage is unavailable") from error
        if not isinstance(value, dict):
            raise RuntimeError("Mini Frank job storage is invalid")
        return value

    def _save_locked(self, jobs: dict[str, dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(self.path)

    def get(self, job_id: str) -> dict | None:
        with self.lock:
            item = self._load_locked().get(job_id)
            return dict(item) if isinstance(item, dict) else None

    def create(self, job: dict, *, daily_limit: int) -> None:
        with self.lock:
            jobs = self._load_locked()
            cutoff = int(time.time()) - 86400
            if job.get("delivery") == "free":
                same_requester = sum(
                    1 for item in jobs.values()
                    if item.get("delivery") == "free"
                    and item.get("requester_hash") == job["requester_hash"]
                    and int(item.get("created_at") or 0) >= cutoff
                )
                if same_requester >= daily_limit:
                    abort(429, "You have reached today's free request limit. Try again tomorrow.")
            active_email = any(
                str(item.get("email") or "").lower() == job["email"].lower()
                and item.get("stage") in ACTIVE_STAGES
                for item in jobs.values()
            )
            if active_email:
                abort(409, "You already have a solution in progress. Open that project or wait for the email.")
            jobs[job["id"]] = job
            self._save_locked(jobs)

    def update(self, job_id: str, **changes) -> dict:
        with self.lock:
            jobs = self._load_locked()
            current = jobs.get(job_id)
            if not isinstance(current, dict):
                raise KeyError(job_id)
            current.update(changes)
            current["updated_at"] = int(time.time())
            jobs[job_id] = current
            self._save_locked(jobs)
            return dict(current)


def _clean_text(value, limit: int, *, required: bool = False) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if required and len(text) < 10:
        abort(400, "Tell us a little more about what needs solving.")
    if len(text) > limit:
        abort(400, f"Please keep this answer under {limit} characters.")
    return text


def _clean_email(value) -> str:
    email = str(value or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        abort(400, "Enter a valid email so we can send the project link.")
    return email


def _manifest_text(value, limit: int, *, minimum: int = 1) -> str | None:
    if not isinstance(value, str):
        return None
    text = re.sub(r"\s+", " ", value).strip()
    if len(text) < minimum or len(text) > limit:
        return None
    return text


def _claim_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _claim_token(job_id: str, key: bytes) -> str:
    digest = hmac.new(key, f"mini-claim:{job_id}".encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}{'•' * max(2, min(6, len(local) - len(visible)))}@{domain}"


def _checkout_url(base: str, job_id: str) -> str:
    if not base:
        return ""
    parsed = urllib.parse.urlsplit(base)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("client_reference_id", job_id))
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def _build_prompt(job: dict, change: str = "", customer_link: str = "") -> str:
    public_dir = f"/srv/frank/previews/mini/{job['id']}"
    source_dir = f"/projects/mini-frank/customer-projects/{job['id']}"
    brief = [
        f"Problem: {job['problem']}",
        f"Good outcome: {job.get('outcome') or 'Use the problem statement and make the smallest useful assumption.'}",
        f"Who uses it: {job.get('people') or 'Infer conservatively from the problem.'}",
        f"What they do now: {job.get('current_way') or 'Unknown; do not invent a claim.'}",
    ]
    if change:
        brief.append(f"Requested change: {change}")
    brief_text = "\n".join(brief)
    return f"""Use the installed /mini-frank-build bundle for this customer job.

{brief_text}

Work inside {source_dir}. Read the Mini Frank knowledge and design system first. Become specific to this customer's industry and problem before building. Search the approved repository catalogue and commercially compatible open-source solutions before creating anything from scratch. Keep internal notes and model outputs concise.

Deliver a real working artifact, usually a small app. If the full request is too large, build the most useful working clickable demo and say plainly what it proves. It must work on mobile, have the smallest real data/backend behaviour it needs, and contain no fake metrics, fake sources, fake success states, or placeholder answers. Use Impeccable for the interface and browser-test the primary action.

The customer owns the result. Keep technical detail optional. Do not expose private customer content in the public artifact unless it is required for the requested function.

Publish the runnable preview to {public_dir}/index.html and its required assets. Put a source archive at {public_dir}/source.zip and concise optional build notes at {public_dir}/build-notes.txt. The preview is hosted for 30 days, but keep the rebuildable source permanently in {source_dir}.

As the final operation, atomically write {source_dir}/result.json with exactly this public shape:
{{
  "schema": "{RESULT_SCHEMA}",
  "job_id": "{job['id']}",
  "title": "plain customer-facing title",
  "summary": "two concise sentences describing the working result",
  "artifact_url": "{PREVIEW_PREFIX}{job['id']}/",
  "source_url": "{PREVIEW_PREFIX}{job['id']}/source.zip",
  "details_url": "{PREVIEW_PREFIX}{job['id']}/build-notes.txt"
}}

Do not write result.json until the preview has passed its checks. Once it is ready, use the configured email capability to send one concise transactional email to {job['email']}. Say their working solution is ready and link only to {customer_link}. Do not add marketing copy or expose technical details. If email is temporarily unavailable, leave a concise notification note in the project for the operator."""


def create_blueprint(
    *,
    data_root: Path,
    project_view_root: Path,
    project_getter: Callable[[str], dict | None],
    session_creator: Callable[..., dict],
    hermes_request: Callable[..., dict],
    rate_limit_key: str,
    priority_payment_url: str = "",
    daily_limit: int = 3,
) -> Blueprint:
    blueprint = Blueprint("mini_frank", __name__)
    store = MiniFrankStore(data_root / "mini" / "jobs.json")
    rate_key = (rate_limit_key or secrets.token_urlsafe(32)).encode("utf-8")

    @blueprint.errorhandler(HTTPException)
    def api_error(error: HTTPException):
        return jsonify({"error": error.description or "Request failed."}), error.code

    @blueprint.errorhandler(Exception)
    def unexpected_api_error(error: Exception):
        current_app.logger.exception("Mini Frank request failed", exc_info=error)
        return jsonify({"error": "Mini Frank is temporarily unavailable. Try again shortly."}), 500

    def json_object() -> dict:
        if not request.is_json:
            abort(400, "Request body must be a JSON object.")
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            abort(400, "Request body must be a JSON object.")
        return body

    def requester_hash() -> str:
        address = str(request.headers.get("X-Real-IP") or request.remote_addr or "unknown")
        return hmac.new(rate_key, address.encode("utf-8"), hashlib.sha256).hexdigest()

    def claimed_job(job_id: str) -> dict:
        if not JOB_ID_RE.fullmatch(job_id):
            abort(404)
        job = store.get(job_id)
        token = str(request.headers.get("X-Mini-Claim") or "").strip()
        claim_hash = str((job or {}).get("claim_hash") or "")
        if not job or not token or not claim_hash or not hmac.compare_digest(claim_hash, _claim_hash(token)):
            abort(404)
        return job

    def public_job(job: dict) -> dict:
        result = job.get("result") if isinstance(job.get("result"), dict) else None
        response = {
            "id": job["id"],
            "title": (result or {}).get("title") or "Your solution",
            "problem": job["problem"],
            "stage": job["stage"],
            "delivery": job["delivery"],
            "email": _mask_email(job["email"]),
            "created_at": job["created_at"],
            "updated_at": job["updated_at"],
            "hosted_until": job["hosted_until"],
            "revision": int(job.get("revision") or 1),
            "offer_requested": bool(job.get("offer_requested_at")),
        }
        if result:
            response["result"] = result
        return response

    def load_result(job: dict) -> dict | None:
        path = project_view_root / "customer-projects" / job["id"] / "result.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if (
            not isinstance(value, dict)
            or set(value) != RESULT_FIELDS
            or value.get("schema") != RESULT_SCHEMA
            or value.get("job_id") != job["id"]
        ):
            return None
        title = _manifest_text(value.get("title"), 100)
        summary = _manifest_text(value.get("summary"), 600, minimum=10)
        if not title or not summary:
            return None
        expected_urls = {
            "artifact_url": f"{PREVIEW_PREFIX}{job['id']}/",
            "source_url": f"{PREVIEW_PREFIX}{job['id']}/source.zip",
            "details_url": f"{PREVIEW_PREFIX}{job['id']}/build-notes.txt",
        }
        if any(value.get(field) != expected for field, expected in expected_urls.items()):
            return None
        cleaned = {
            "title": title,
            "summary": summary,
            **expected_urls,
        }
        return cleaned

    def sync_job(job: dict) -> dict:
        result = load_result(job)
        if result:
            if job.get("stage") != "ready" or job.get("result") != result:
                return store.update(job["id"], stage="ready", result=result, dispatch_error="")
            return job
        run_id = str(job.get("run_id") or "")
        if not run_id:
            return job
        try:
            run = hermes_request(f"/v1/runs/{urllib.parse.quote(run_id, safe='')}", timeout=8)
        except Exception:
            return job
        if not isinstance(run, dict):
            return job
        status = str(run.get("status") or "").lower()
        if status in RUNNING_STATUSES:
            stage = "working"
        elif status == "completed":
            stage = "checking"
        elif status in {"failed", "cancelled"}:
            stage = "needs_attention"
        else:
            stage = job.get("stage") or "queued"
        return store.update(job["id"], stage=stage) if stage != job.get("stage") else job

    def ensure_session(job: dict) -> dict:
        project = project_getter("mini-frank")
        if not project:
            raise RuntimeError("Mini Frank project is unavailable")
        session_id = str(job.get("session_id") or "")
        if not session_id:
            session = session_creator(project, title=f"Mini Frank · {job['id']}")
            session_id = str((session or {}).get("id") or "")
            if not session_id:
                raise RuntimeError("Hermes did not create a session")
            job = store.update(job["id"], session_id=session_id)
        return job

    def accepted_run_id(run) -> str:
        if not isinstance(run, dict):
            raise RuntimeError("Hermes returned an invalid run response")
        run_id = str(run.get("run_id") or "").strip()
        if not run_id or len(run_id) > 200 or any(char.isspace() for char in run_id):
            raise RuntimeError("Hermes did not accept the run")
        return run_id

    def dispatch(job: dict, *, change: str = "") -> dict:
        job = ensure_session(job)
        session_id = str(job["session_id"])
        payload = {
            "input": _build_prompt(
                job,
                change,
                f"https://frank.fail/mini/#project={job['id']}&key={_claim_token(job['id'], rate_key)}",
            ),
            "session_id": session_id,
            "instructions": (
                "Hermes is the sole brain and executor. Keep customer-facing copy plain, "
                "use commercially compatible open source first, and finish the working artifact."
            ),
        }
        run = hermes_request("/v1/runs", payload, method="POST", timeout=15)
        run_id = accepted_run_id(run)
        return store.update(
            job["id"], session_id=session_id, run_id=run_id,
            stage="working", dispatch_error="",
        )

    @blueprint.get("/api/mini/config")
    def config():
        return jsonify({
            "priority_available": bool(priority_payment_url),
            "priority_amount": 5,
            "hosted_days": 30,
        })

    @blueprint.post("/api/mini/jobs")
    def create_job():
        body = json_object()
        delivery = str(body.get("delivery") or "free").strip().lower()
        if delivery not in {"free", "priority"}:
            abort(400, "Choose free or start now.")
        if delivery == "priority" and not priority_payment_url:
            abort(503, "Start-now checkout is not connected yet. Choose free and we will begin as soon as possible.")
        now = int(time.time())
        job_id = secrets.token_urlsafe(9)
        token = _claim_token(job_id, rate_key)
        job = {
            "id": job_id,
            "claim_hash": _claim_hash(token),
            "requester_hash": requester_hash(),
            "email": _clean_email(body.get("email")),
            "problem": _clean_text(body.get("problem"), 6000, required=True),
            "outcome": _clean_text(body.get("outcome"), 1000),
            "people": _clean_text(body.get("people"), 500),
            "current_way": _clean_text(body.get("current_way"), 1000),
            "delivery": delivery,
            "stage": "queued",
            "created_at": now,
            "updated_at": now,
            "hosted_until": now + 30 * 86400,
            "revision": 1,
            "run_id": "",
            "session_id": "",
            "dispatch_error": "",
            "changes": [],
        }
        store.create(job, daily_limit=max(1, daily_limit))
        try:
            job = dispatch(job)
        except Exception:
            job = store.update(job_id, stage="queued", dispatch_error="waiting_for_capacity")
        response = {"claim_token": token, "job": public_job(job)}
        if delivery == "priority":
            response["checkout_url"] = _checkout_url(priority_payment_url, job_id)
        return jsonify(response), 202

    @blueprint.get("/api/mini/jobs/<job_id>")
    def read_job(job_id: str):
        job = sync_job(claimed_job(job_id))
        return jsonify({"job": public_job(job)})

    @blueprint.post("/api/mini/jobs/<job_id>/dispatch")
    def retry_job(job_id: str):
        job = claimed_job(job_id)
        if job.get("stage") == "ready" or (job.get("run_id") and job.get("stage") != "needs_attention"):
            return jsonify({"job": public_job(job)})
        try:
            job = dispatch(job)
        except Exception:
            return jsonify({"error": "We have your request, but capacity is busy. We will keep it queued."}), 503
        return jsonify({"job": public_job(job)}), 202

    @blueprint.post("/api/mini/jobs/<job_id>/changes")
    def request_change(job_id: str):
        job = claimed_job(job_id)
        body = json_object()
        change = _clean_text(body.get("change"), 2000, required=True)
        delivery = str(body.get("delivery") or "free").strip().lower()
        if delivery not in {"free", "priority"}:
            abort(400, "Choose free or start now.")
        if delivery == "priority" and not priority_payment_url:
            abort(503, "Start-now checkout is not connected yet. Choose free for this change.")
        changes = list(job.get("changes") or [])
        changes.append({"text": change, "delivery": delivery, "created_at": int(time.time())})
        job = store.update(
            job_id, changes=changes[-20:], delivery=delivery, stage="queued",
            revision=int(job.get("revision") or 1) + 1, run_id="",
        )
        try:
            job = dispatch(job, change=change)
        except Exception:
            job = store.update(job_id, stage="queued", dispatch_error="waiting_for_capacity")
        response = {"job": public_job(job)}
        if delivery == "priority":
            response["checkout_url"] = _checkout_url(priority_payment_url, job_id)
        return jsonify(response), 202

    @blueprint.post("/api/mini/jobs/<job_id>/offer")
    def request_offer(job_id: str):
        job = claimed_job(job_id)
        if job.get("offer_run_id"):
            return jsonify({"job": public_job(job)})
        now = int(time.time())
        if not job.get("offer_requested_at"):
            job = store.update(job_id, offer_requested_at=now, offer_status="queued")
        payload = {
            "input": (
                "This customer has asked Steven for a price to deploy, integrate, or operate their Mini Frank result. "
                f"Project: {job_id}. Customer: {job['email']}. Problem: {job['problem']}. "
                "Use the configured operator notification capability to alert Steven. Keep it concise and include the "
                "Mini Frank project ID. Do not make or send a price; Steven approves every proposal manually."
            ),
            "session_id": str(job.get("session_id") or ""),
            "instructions": "Notify the operator only. Do not modify the customer artifact or create a proposal.",
        }
        try:
            job = ensure_session(job)
            payload["session_id"] = str(job["session_id"])
            run = hermes_request("/v1/runs", payload, method="POST", timeout=15)
            offer_run_id = accepted_run_id(run)
            job = store.update(job_id, offer_run_id=offer_run_id, offer_status="notifying")
        except Exception:
            job = store.update(job_id, offer_status="queued")
        return jsonify({"job": public_job(job)}), 202

    return blueprint
