"""Typed Hermes cron client and schedule validation for Frank work routines.

Owns the only Frank-side HTTP access to the Hermes v0.21 cron routes under
``/api/cron/jobs`` (rich serve surface, session-token auth injected
server-side; the token never reaches the browser). Schedule expressions are
validated server-side and next executions are computed locally so Frank can
preview a routine before it is created or updated. No scheduler lives here:
Hermes's supervised gateway daemon is the only thing that fires jobs.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from calendar import monthrange
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

CRON_JOBS_PATH = "/api/cron/jobs"
DELIVERY_TARGETS_PATH = "/api/cron/delivery-targets"
SERVE_STATUS_PATH = "/api/status"
HTTP_TIMEOUT_SECONDS = 15.0
MAX_JOBS = 200
MAX_RUNS = 50
MAX_BODY_BYTES = 512 * 1024

# Inert phase-one schedule: a real "once" far-future timestamp. It is a valid
# upstream schedule that cannot fire (year 2099), so no execution or delivery
# can occur between the phase-one POST and the phase-two PUT.
INERT_SCHEDULE = "2099-12-31T00:00:00+00:00"
INERT_DELIVERY = "local"

TRIGGER_SUFFIX = "/trigger"
PAUSE_SUFFIX = "/pause"
RESUME_SUFFIX = "/resume"

_DISPLAY_TZ = ZoneInfo("Australia/Perth")

_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
           "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_DAYS = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}

# minute, hour, day-of-month, month, day-of-week bounds and name tables.
_FIELD_SPECS = (
    (0, 59, {}),
    (0, 23, {}),
    (1, 31, {}),
    (1, 12, _MONTHS),
    (0, 6, _DAYS),
)


class CronClientError(RuntimeError):
    """Raised for validation failures and non-recoverable Hermes responses."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class CronClientUnavailable(CronClientError):
    """Raised when Hermes cannot be reached. Callers fail closed."""


def display_timezone() -> ZoneInfo:
    """The user's configured default display timezone."""
    return _DISPLAY_TZ


def _expand_field(field: str, low: int, high: int, names: dict[str, int]) -> set[int]:
    """Expand one cron field into its value set, or raise ValueError."""
    values: set[int] = set()
    for part in str(field).split(","):
        step = 1
        body = part
        if "/" in part:
            body, _, step_text = part.partition("/")
            if not step_text.isdigit() or int(step_text) < 1:
                raise ValueError(f"cron step is invalid: {part}")
            step = int(step_text)
        if body == "*":
            start, end = low, high
        elif "-" in body:
            left, _, right = body.partition("-")
            start = _field_value(left, low, high, names)
            end = _field_value(right, low, high, names)
            if start > end:
                raise ValueError(f"cron range is reversed: {part}")
        else:
            start = end = _field_value(body, low, high, names)
        values.update(range(start, end + 1, step))
    return values


def _field_value(body: str, low: int, high: int, names: dict[str, int]) -> int:
    value = names.get(str(body).lower())
    if value is None:
        if not body.isdigit():
            raise ValueError(f"cron value is invalid: {body}")
        value = int(body)
    if not low <= value <= high:
        raise ValueError(f"cron value {value} is outside {low}-{high}")
    return value


def validate_cron_expression(expr: str) -> dict:
    """Validate a five-field cron expression; return its parsed shape."""
    parts = str(expr).split()
    if len(parts) != 5:
        raise ValueError("a cron schedule needs exactly five fields (minute hour day month weekday)")
    if any(not re.fullmatch(r"[A-Za-z\d*\-,/]+", part) for part in parts):
        raise ValueError("a cron schedule allows only digits, letters, *, '-', ',', '/'")
    for (low, high, names), field in zip(_FIELD_SPECS, parts):
        _expand_field(field, low, high, names)
    return {"kind": "cron", "expr": expr}


def validate_schedule(schedule: str) -> dict:
    """Validate one Frank-allowed schedule string (strict allowlist).

    Accepted forms: a five-field cron expression, ``every <minutes>m``
    (interval), or an ISO-8601 timestamp with an explicit offset (once).
    Natural-language phrases are rejected: Frank only previews schedules it
    can compute itself.
    """
    text = str(schedule or "").strip()
    if not text:
        raise ValueError("a schedule is required")
    parts = text.split()
    if len(parts) == 5 and all(re.fullmatch(r"[A-Za-z\d*\-,/]+", part) for part in parts):
        return validate_cron_expression(text)
    lowered = text.lower()
    if lowered.startswith("every"):
        rest = text[5:].strip().lower()
        if rest.endswith("m") and rest[:-1].isdigit():
            minutes = int(rest[:-1])
            if not 5 <= minutes <= 60 * 24 * 7:
                raise ValueError("interval schedules run between every 5 minutes and every 7 days")
            return {"kind": "interval", "minutes": minutes, "display": f"every {minutes}m"}
        raise ValueError("use 'every <minutes>m', a cron expression, or an ISO timestamp")
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("use 'every <minutes>m', a cron expression, or an ISO timestamp") from error
    if moment.tzinfo is None:
        raise ValueError("an ISO schedule must carry an explicit UTC offset")
    if moment <= datetime.now(timezone.utc):
        raise ValueError("a one-time schedule must be in the future")
    return {"kind": "once", "run_at": moment.isoformat(), "display": text}


def _cron_next_occurrences(expr: str, count: int, tz: ZoneInfo) -> list[datetime]:
    minute_f, hour_f, dom_f, month_f, dow_f = expr.split()
    minutes = _expand_field(minute_f, 0, 59, {})
    hours = _expand_field(hour_f, 0, 23, {})
    months = _expand_field(month_f, 1, 12, _MONTHS)
    dows = _expand_field(dow_f, 0, 6, _DAYS)
    dom_star = dom_f == "*"
    doms = None if dom_star else _expand_field(dom_f, 1, 31, {})
    now = datetime.now(tz).replace(second=0, microsecond=0)
    results: list[datetime] = []
    candidate = now + timedelta(minutes=1)
    limit = now + timedelta(days=370)
    while len(results) < count and candidate <= limit:
        if candidate.month not in months:
            candidate = (candidate.replace(day=1, hour=0, minute=0)
                         + timedelta(days=32)).replace(day=1)
            continue
        dom_ok = doms is None or candidate.day in doms
        dow_ok = (candidate.weekday() + 1) % 7 in dows
        # Standard cron: a restricted DOM and DOW are OR-ed, not AND-ed.
        day_ok = dom_ok and dow_ok if dom_star else (dom_ok or dow_ok)
        if not day_ok:
            candidate = candidate.replace(hour=0, minute=0) + timedelta(days=1)
            continue
        if candidate.hour not in hours:
            candidate = candidate.replace(minute=0) + timedelta(hours=1)
            continue
        if candidate.minute not in minutes:
            candidate = candidate + timedelta(minutes=1)
            continue
        results.append(candidate)
        candidate = candidate + timedelta(minutes=1)
    return results


def _interval_next_occurrences(minutes: int, count: int, tz: ZoneInfo) -> list[datetime]:
    now = datetime.now(tz).replace(second=0, microsecond=0)
    aligned = now.replace(minute=0) + timedelta(minutes=((now.minute // minutes) + 1) * minutes)
    return [aligned + timedelta(minutes=minutes * index) for index in range(count)]


def next_executions(schedule: str, count: int = 3, tz: ZoneInfo | None = None) -> list[dict]:
    """Compute the next executions for a validated schedule, in ``tz``."""
    parsed = validate_schedule(schedule)
    zone = tz or display_timezone()
    if parsed["kind"] == "cron":
        moments = _cron_next_occurrences(parsed["expr"], count, zone)
    elif parsed["kind"] == "interval":
        moments = _interval_next_occurrences(parsed["minutes"], count, zone)
    else:
        moments = [datetime.fromisoformat(parsed["run_at"]).astimezone(zone)][:count]
    return [{"at": moment.isoformat(), "epoch": int(moment.timestamp())} for moment in moments]


class CronClient:
    """Bounded typed HTTP client for the Hermes cron routes."""

    def __init__(self, base_url: str, token_provider: Callable[[], str] | str, *,
                 timeout: float = HTTP_TIMEOUT_SECONDS, opener=None):
        self.base_url = str(base_url or "").rstrip("/")
        self._token_provider = token_provider
        self._timeout = timeout
        self._opener = opener or urllib.request.urlopen

    def _request(self, method: str, path: str, payload: dict | None = None) -> Any:
        if not self.base_url:
            raise CronClientUnavailable("Hermes cron surface is not configured")
        token = self._token_provider() if callable(self._token_provider) else self._token_provider
        if not token:
            raise CronClientUnavailable("Hermes cron surface is not authenticated")
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={
                "Accept": "application/json",
                "X-Hermes-Session-Token": str(token),
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        try:
            with self._opener(request, timeout=self._timeout) as response:
                body = response.read(MAX_BODY_BYTES + 1)
                if len(body) > MAX_BODY_BYTES:
                    raise CronClientError("Hermes cron response exceeds the bound")
                return json.loads(body.decode("utf-8") or "null")
        except urllib.error.HTTPError as error:
            detail = error.read(2048).decode("utf-8", errors="replace")
            raise CronClientError(
                f"Hermes cron returned HTTP {error.code}: {detail[:200]}",
                status=error.code,
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise CronClientUnavailable(f"Hermes cron surface unreachable: {str(error)[:160]}") from None

    def gateway_health(self) -> dict:
        """Verify the supervised gateway daemon that actually fires schedules."""
        try:
            status = self._request("GET", SERVE_STATUS_PATH)
        except CronClientError as error:
            if error.status == 404:
                return {"ok": False, "reason": "Hermes serve status route is unavailable"}
            return {"ok": False, "reason": str(error)[:160]}
        except CronClientUnavailable as error:
            return {"ok": False, "reason": str(error)[:160]}
        gateway_running = bool(status.get("gateway_running")) if isinstance(status, dict) else False
        state = str(status.get("gateway_state") or "") if isinstance(status, dict) else ""
        return {"ok": gateway_running and state in {"running", "connected"}, "state": state}

    def list_jobs(self, profile: str | None = None) -> list[dict]:
        query = f"?profile={urllib.parse.quote(profile)}" if profile else ""
        result = self._request("GET", CRON_JOBS_PATH + query)
        rows = result if isinstance(result, list) else (result or {}).get("jobs") or []
        return [row for row in rows if isinstance(row, dict)][:MAX_JOBS]

    def delivery_targets(self) -> list[dict]:
        result = self._request("GET", DELIVERY_TARGETS_PATH)
        rows = result if isinstance(result, list) else (result or {}).get("targets") or []
        return [row for row in rows if isinstance(row, dict)][:50]

    def get_job(self, job_id: str) -> dict | None:
        return self._request("GET", f"{CRON_JOBS_PATH}/{job_id}")

    def job_runs(self, job_id: str, limit: int = MAX_RUNS) -> list[dict]:
        result = self._request(
            "GET", f"{CRON_JOBS_PATH}/{job_id}/runs?limit={min(int(limit), MAX_RUNS)}")
        rows = result if isinstance(result, list) else (result or {}).get("runs") or []
        return [row for row in rows if isinstance(row, dict)][:MAX_RUNS]

    def create_job(self, payload: dict) -> dict:
        return self._request("POST", CRON_JOBS_PATH, payload)

    def update_job(self, job_id: str, updates: dict) -> dict:
        return self._request("PUT", f"{CRON_JOBS_PATH}/{job_id}", {"updates": updates})

    def pause_job(self, job_id: str) -> dict:
        return self._request("POST", f"{CRON_JOBS_PATH}/{job_id}{PAUSE_SUFFIX}")

    def resume_job(self, job_id: str) -> dict:
        return self._request("POST", f"{CRON_JOBS_PATH}/{job_id}{RESUME_SUFFIX}")

    def trigger_job(self, job_id: str) -> dict:
        return self._request("POST", f"{CRON_JOBS_PATH}/{job_id}{TRIGGER_SUFFIX}")

    def delete_job(self, job_id: str) -> Any:
        return self._request("DELETE", f"{CRON_JOBS_PATH}/{job_id}")
