"""Owner workspace read projections: the real readers behind the owner overview.

Before this module there was **no owner read model at all**. Every number the
owner workspace needs had to be built, and two of the shipped widgets
(``work-status``, ``recent-receipts``) were hard-coded zeroes while a third
(``analytics-summary``) was structurally incapable of returning a metric.

This module adds three read-only projections over services that already own
their data:

======================  ==========================================================
Widget                  Source it actually reads
======================  ==========================================================
``owner-support``       Frappe Helpdesk ``HD Ticket``, filtered by the ticket's own
                        native ``status_category`` and its assignment rule.
``owner-crm-leads``     Frappe CRM ``CRM Lead``, counted by the source record's own
                        ``creation`` time, never by a mirror or sync time.
``owner-notifications`` ntfy publish activity for the single owner topic.
``owner-attention``     The merged owner queue over the two Frappe projections,
                        gathered with :func:`owner_workspace.collect_attention`.
======================  ==========================================================

Rules this module is built to keep
----------------------------------

* **Nothing is written.** The only non-``GET`` request is Frappe's own session
  ``login``/``logout``; no record is created, updated or deleted, no campaign is
  activated and no message is sent.
* **Missing data is not zero.** Every reading is built with
  :func:`owner_workspace.reading`, so a source that cannot be read carries no
  value at all. A consumer cannot render it as ``0``.
* **A failing source is isolated.** Each widget catches its own failure and
  returns a snapshot describing it; ``home_providers.render`` additionally
  quarantines a provider that raises. One dead source degrades one card.
* **Bounded work.** Every request has a timeout, a page bound and a byte bound.
  Results are cached with a TTL, refreshed by at most one thread at a time, and
  backed off exponentially after a failure. A render never fans out to every
  provider, and nothing here polls.
* **No secrets, no bodies.** Credentials are read from a ``0600`` file at a
  named path, never logged, never placed in a payload. Only identifiers,
  statuses, timestamps and short titles cross into a projection.
* **Typed drill-downs only.** Every item links with
  :func:`owner_workspace.owner_section_link`; no arbitrary URL is ever emitted.

Credential and reachability story
---------------------------------

The Frappe projections use the **existing native owner session** for
``owner@blockwise.sale``, whose username and password already live at
``/srv/frank/secrets/owner-crm-login.env`` (mode ``0600``) and are already used
by ``infra/owner_crm/bin/support-reply-acceptance.py``. No API key is created
and no record is written to read them.

The ntfy projection uses the **purpose-built read-only** ntfy user ``owner``,
which the ntfy ACL grants read access to exactly one topic. Its password already
lives at ``/srv/frank/secrets/owner-notifications/owner-notifications.env``.

Both the credentials **and** the network path have to be wired for the running
``frank-window`` container, which today mounts neither secret file and is not
attached to any owner service network. Until that integration lands, each
projection returns ``unavailable`` with the precise missing item in ``detail``
rather than a fabricated number. The exact configuration needed is in the
integration request that accompanies this change.
"""

from __future__ import annotations

import base64
import http.cookiejar
import ipaddress
import json
import os
import re
import stat
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import home_providers
import owner_workspace as ow

# --------------------------------------------------------------------------- #
# Sources and configuration
# --------------------------------------------------------------------------- #

SOURCE_HELPDESK = "frappe_helpdesk"
SOURCE_CRM = "frappe_crm"
SOURCE_NTFY = "ntfy"

CRM_BASE_URL_ENV = "OWNER_CRM_BASE_URL"
CRM_SITE_ENV = "OWNER_CRM_SITE"
CRM_SECRET_FILE_ENV = "OWNER_CRM_SECRET_FILE"
CRM_OWNER_USER_ENV = "OWNER_CRM_OWNER_USER"
CRM_WINDOW_ENV = "OWNER_CRM_LEAD_WINDOW"
NTFY_BASE_URL_ENV = "OWNER_NTFY_BASE_URL"
NTFY_SECRET_FILE_ENV = "OWNER_NTFY_SECRET_FILE"
NTFY_TOPIC_ENV = "OWNER_NTFY_TOPIC"
NTFY_WINDOW_ENV = "OWNER_NTFY_WINDOW"
CACHE_TTL_ENV = "OWNER_PROJECTION_TTL_SECONDS"

DEFAULT_CRM_BASE_URL = "http://127.0.0.1:18081"
DEFAULT_CRM_SITE = "owner.crm.internal"
DEFAULT_CRM_SECRET_FILE = "/srv/frank/secrets/owner-crm-login.env"
DEFAULT_CRM_OWNER_USER = "owner@blockwise.sale"
DEFAULT_NTFY_BASE_URL = "http://127.0.0.1:18104"
DEFAULT_NTFY_SECRET_FILE = "/srv/frank/secrets/owner-notifications/owner-notifications.env"
DEFAULT_NTFY_TOPIC = "owner-notifications"

# Frappe evaluates this window with its own clock in the site's timezone, which
# is why the boundary is never computed in Frank. See ``_load_new_leads``.
DEFAULT_CRM_LEAD_WINDOW = "last 7 days"
SUPPORTED_CRM_LEAD_WINDOWS = (
    "last 7 days",
    "last 14 days",
    "last 30 days",
    "last 90 days",
)
DEFAULT_NTFY_WINDOW = "24h"

# Bounds. Every one of these exists so a render cannot become unbounded work.
DEFAULT_TIMEOUT_SECONDS = 4.0
MIN_TIMEOUT_SECONDS = 1.0
MAX_TIMEOUT_SECONDS = 15.0
DEFAULT_CACHE_TTL_SECONDS = 60.0
MIN_CACHE_TTL_SECONDS = 15.0
MAX_CACHE_TTL_SECONDS = 900.0
BACKOFF_BASE_SECONDS = 30.0
BACKOFF_CAP_SECONDS = 600.0
MAX_RESPONSE_BYTES = 512 * 1024
MAX_ATTENTION_ITEMS = 5
MAX_LIST_BOUND = 200
# A count metric cites the records behind it, but the payload stays small: the
# actionable items are carried separately and the count itself is exact.
MAX_SOURCE_IDS = 25
MAX_NTFY_NOTIFICATIONS = 500
CRM_LEAD_LIST_FIELDS = ("name", "creation", "status", "lead_name")
HD_TICKET_LIST_FIELDS = ("name", "subject", "status", "status_category", "_assign", "creation", "opening_date")

# The owner user is interpolated into a Frappe ``like`` filter, where ``_`` and
# ``%`` are wildcards. Refusing those characters is what keeps the assignment
# filter exact instead of quietly over-matching a different agent.
SAFE_OWNER_USER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.@+-]{0,127}$")
SAFE_TOPIC = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
SAFE_SERVICE_HOST = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
SAFE_SECRET_KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")


class OwnerSourceUnavailable(RuntimeError):
    """A source could not be read.

    The message is owner-facing and safe to place in ``detail``: it names the
    missing configuration or the failure class and never contains a credential,
    a response body or a customer record.
    """


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or not value.strip() else value.strip()


def _env_float(name: str, default: float, low: float, high: float) -> float:
    raw = os.environ.get(name, "")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    if value != value or value in (float("inf"), float("-inf")):
        return default
    return min(max(value, low), high)


def _timeout_seconds() -> float:
    # One shared timeout: callers may bound it through the existing env file.
    return _env_float("OWNER_PROJECTION_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)


def _cache_ttl_seconds() -> float:
    return _env_float(CACHE_TTL_ENV, DEFAULT_CACHE_TTL_SECONDS, MIN_CACHE_TTL_SECONDS, MAX_CACHE_TTL_SECONDS)


def _iso(epoch: int | float | None) -> str:
    if not epoch:
        return ""
    return datetime.fromtimestamp(float(epoch), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _short(text: Any, limit: int = 80) -> str:
    """A bounded single-line label. Never used for a message body."""
    value = " ".join(str(text or "").split())
    return value[:limit]


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #


def _private_endpoint(raw: str, *, source: str) -> str:
    """Accept only a private loopback/RFC1918 literal or a single-label service name.

    This is the allowlist that stops the projection being turned into a proxy for
    an arbitrary user-supplied URL: a public DNS name, an embedded credential, a
    path or a query is refused before any request is built.
    """
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme not in {"http", "https"}:
        raise OwnerSourceUnavailable(f"{source} base URL must be http or https")
    if not parsed.netloc or parsed.username or parsed.password:
        raise OwnerSourceUnavailable(f"{source} base URL must not carry credentials")
    if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise OwnerSourceUnavailable(f"{source} base URL must be a bare origin")
    host = parsed.hostname or ""
    if not SAFE_SERVICE_HOST.fullmatch(host) and host != "localhost":
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            raise OwnerSourceUnavailable(
                f"{source} base URL host must be a private address literal or a single-label service name"
            ) from None
        if not (address.is_loopback or address.is_private or address.is_link_local):
            raise OwnerSourceUnavailable(f"{source} base URL host is not a private address")
    port = parsed.port
    if port is not None and not 1 <= port <= 65535:
        raise OwnerSourceUnavailable(f"{source} base URL port is invalid")
    return f"{parsed.scheme}://{parsed.netloc}"


def _read_secret_file(path: Path, keys: tuple[str, ...], *, source: str) -> dict[str, str]:
    """Read named keys from an owner secret file.

    The file must be a regular file, must not be a symlink, and must not be
    readable by group or other. No value is ever logged or returned in a payload.
    """
    try:
        info = path.lstat()
    except OSError as exc:
        raise OwnerSourceUnavailable(f"{source} secret file is not present at {path}") from exc
    if not stat.S_ISREG(info.st_mode) or path.is_symlink():
        raise OwnerSourceUnavailable(f"{source} secret file at {path} must be a regular file")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise OwnerSourceUnavailable(f"{source} secret file at {path} must not be group or world readable")
    if info.st_uid not in (0, os.geteuid()):
        raise OwnerSourceUnavailable(f"{source} secret file at {path} must be owned by root or the reader")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise OwnerSourceUnavailable(f"{source} secret file at {path} is unreadable") from exc
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, value = stripped.partition("=")
        if not separator or not SAFE_SECRET_KEY.fullmatch(key):
            raise OwnerSourceUnavailable(f"{source} secret file at {path} has invalid syntax")
        values[key] = value
    missing = [key for key in keys if not values.get(key)]
    if missing:
        raise OwnerSourceUnavailable(
            f"{source} secret file at {path} is missing {', '.join(missing)}"
        )
    return {key: values[key] for key in keys}


def crm_credentials(*, path: Path | None = None) -> tuple[str, str]:
    """Return ``(username, password)`` for the native owner CRM session."""
    secret_path = path or Path(_env(CRM_SECRET_FILE_ENV, DEFAULT_CRM_SECRET_FILE))
    values = _read_secret_file(
        secret_path, ("OWNER_CRM_USERNAME", "OWNER_CRM_PASSWORD"), source="owner CRM session"
    )
    username = values["OWNER_CRM_USERNAME"]
    expected = _env(CRM_OWNER_USER_ENV, DEFAULT_CRM_OWNER_USER)
    if username != expected:
        raise OwnerSourceUnavailable(
            f"the owner CRM session secret names a different identity than {CRM_OWNER_USER_ENV}"
        )
    return username, values["OWNER_CRM_PASSWORD"]


def ntfy_credentials(*, path: Path | None = None) -> str:
    """Return the read-only ntfy password for the owner topic."""
    secret_path = path or Path(_env(NTFY_SECRET_FILE_ENV, DEFAULT_NTFY_SECRET_FILE))
    values = _read_secret_file(secret_path, ("NTFY_OWNER_PASSWORD",), source="owner notifications")
    return values["NTFY_OWNER_PASSWORD"]


def crm_owner_user() -> str:
    user = _env(CRM_OWNER_USER_ENV, DEFAULT_CRM_OWNER_USER)
    if not SAFE_OWNER_USER.fullmatch(user):
        raise OwnerSourceUnavailable(
            f"{CRM_OWNER_USER_ENV} must be a plain account name so the assignment filter stays exact"
        )
    return user


def crm_lead_window() -> str:
    window = _env(CRM_WINDOW_ENV, DEFAULT_CRM_LEAD_WINDOW)
    if window not in SUPPORTED_CRM_LEAD_WINDOWS:
        raise OwnerSourceUnavailable(
            f"{CRM_WINDOW_ENV} must be one of: {', '.join(SUPPORTED_CRM_LEAD_WINDOWS)}"
        )
    return window


# --------------------------------------------------------------------------- #
# Bounded read-only HTTP
# --------------------------------------------------------------------------- #


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):  # noqa: A002 - urllib signature
        raise OwnerSourceUnavailable("source redirect rejected")


class _Unauthorized(OwnerSourceUnavailable):
    """A session expired or was refused; the caller may re-authenticate once."""


def _build_opener(cookies: http.cookiejar.CookieJar):
    return urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPCookieProcessor(cookies)).open


class _BoundedHttp:
    """A response reader with a byte cap, a timeout and no redirect following."""

    def __init__(
        self,
        *,
        opener: Callable[..., Any] | None = None,
        cookies: http.cookiejar.CookieJar | None = None,
        timeout: float | None = None,
    ) -> None:
        self.timeout = timeout if timeout is not None else _timeout_seconds()
        self._opener = opener if opener is not None else _build_opener(cookies or http.cookiejar.CookieJar())

    def open(self, request: urllib.request.Request, *, limit: int = MAX_RESPONSE_BYTES) -> bytes:
        try:
            with self._opener(request, timeout=self.timeout) as response:  # type: ignore[misc]
                status = int(getattr(response, "status", response.getcode()))
                raw = response.read(limit + 1)
        except OwnerSourceUnavailable:
            raise
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise _Unauthorized(f"source refused the read (HTTP {exc.code})") from None
            if 300 <= exc.code < 400:
                raise OwnerSourceUnavailable("source redirect rejected") from None
            raise OwnerSourceUnavailable(f"source returned HTTP {exc.code}") from None
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            raise OwnerSourceUnavailable(f"source is unreachable ({type(exc).__name__})") from exc
        if 300 <= status < 400:
            raise OwnerSourceUnavailable("source redirect rejected")
        if len(raw) > limit:
            raise OwnerSourceUnavailable("source response exceeded the read bound")
        return raw

    @staticmethod
    def json(raw: bytes) -> Any:
        try:
            return json.loads(raw.decode("utf-8") or "null")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise OwnerSourceUnavailable("source returned invalid JSON") from exc


class FrappeReadClient:
    """Minimal read-only Frappe client for the owner CRM site.

    Modelled on ``infra/owner_crm_setup/setup_adapter.py``: fixed loopback
    target, in-memory cookie jar, redirects refused, response size bounded. The
    only non-``GET`` call it can make is Frappe's own session login.
    """

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        site: str | None = None,
        credentials: Callable[[], tuple[str, str]] | None = None,
        transport: _BoundedHttp | None = None,
    ) -> None:
        raw_endpoint = endpoint or _env(CRM_BASE_URL_ENV, DEFAULT_CRM_BASE_URL)
        self.endpoint = _private_endpoint(raw_endpoint, source=SOURCE_CRM)
        self.site = site or _env(CRM_SITE_ENV, DEFAULT_CRM_SITE)
        self._credentials = credentials or crm_credentials
        self.cookies = http.cookiejar.CookieJar()
        # ``transport`` is injectable so a test can prove the query shape without
        # a live service; production always builds the real bounded transport.
        self._http = transport or _BoundedHttp(cookies=self.cookies)
        self._lock = threading.RLock()
        self._session_open = False

    def close(self) -> None:
        with self._lock:
            self.cookies.clear()
            self._session_open = False

    def _request(self, method: str, path: str, *, form: dict[str, str] | None = None) -> bytes:
        if not path.startswith("/") or "://" in path:
            raise OwnerSourceUnavailable("invalid Frappe API path")
        headers = {
            "Accept": "application/json",
            "Host": self.site,
            "X-Frappe-Site-Name": self.site,
        }
        data: bytes | None = None
        if form is not None:
            data = urllib.parse.urlencode(form).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        request = urllib.request.Request(self.endpoint + path, data=data, headers=headers, method=method)
        return self._http.open(request)

    def _login(self) -> None:
        username, password = self._credentials()
        self._request("POST", "/api/method/login", form={"usr": username, "pwd": password})
        self._session_open = True

    def get_json(self, path: str) -> Any:
        """Read one Frappe path, re-authenticating at most once per call."""
        with self._lock:
            if not self._session_open:
                self._login()
            try:
                raw = self._request("GET", path)
            except _Unauthorized:
                self._session_open = False
                self._login()
                raw = self._request("GET", path)
        payload = self._http.json(raw)
        if not isinstance(payload, dict):
            raise OwnerSourceUnavailable("Frappe returned an invalid response")
        exception = payload.get("exception")
        if exception:
            first_line = str(exception).splitlines()[0]
            raise OwnerSourceUnavailable(f"Frappe refused the read: {_short(first_line, 140)}")
        return payload

    # -- bounded query helpers ------------------------------------------------

    def list_records(
        self,
        doctype: str,
        *,
        fields: tuple[str, ...],
        filters: list[list[str]],
        or_filters: list[list[str]] | None = None,
        order_by: str = "",
        limit: int = MAX_LIST_BOUND,
    ) -> list[dict[str, Any]]:
        query = {
            "fields": json.dumps(list(fields), separators=(",", ":")),
            "filters": json.dumps(filters, separators=(",", ":")),
            "limit_page_length": str(limit),
        }
        if or_filters:
            query["or_filters"] = json.dumps(or_filters, separators=(",", ":"))
        if order_by:
            query["order_by"] = order_by
        path = "/api/resource/" + urllib.parse.quote(doctype, safe="") + "?" + urllib.parse.urlencode(query)
        payload = self.get_json(path)
        rows = payload.get("data")
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise OwnerSourceUnavailable(f"Frappe returned invalid {doctype} rows")
        if len(rows) > limit:
            raise OwnerSourceUnavailable(f"Frappe exceeded the bounded {doctype} page size")
        return rows

    def count_records(
        self,
        doctype: str,
        *,
        filters: list[list[str]],
        or_filters: list[list[str]] | None = None,
    ) -> int:
        query = {"doctype": doctype, "filters": json.dumps(filters, separators=(",", ":"))}
        if or_filters:
            query["or_filters"] = json.dumps(or_filters, separators=(",", ":"))
        payload = self.get_json("/api/method/frappe.client.get_count?" + urllib.parse.urlencode(query))
        message = payload.get("message")
        if isinstance(message, bool) or not isinstance(message, int) or message < 0:
            raise OwnerSourceUnavailable(f"Frappe returned an invalid {doctype} count")
        return message


# --------------------------------------------------------------------------- #
# Cached read model: TTL, single-flight, backoff, stale-on-error
# --------------------------------------------------------------------------- #


@dataclass
class _Entry:
    key: str
    model: dict[str, Any]
    observed_at: int
    stored_at: float
    failures: int = 0
    retry_after: float = 0.0


class ProjectionCache:
    """A small keyed cache of read models.

    * a fresh entry is returned without touching the source;
    * only the thread that wins the lock performs a refresh, so concurrent
      renders collapse into one request instead of a stampede;
    * after a failure the source is not retried until an exponentially growing
      backoff expires, and until then the last good model is served **marked
      stale** with its original observation time rather than being re-dated;
    * a model that has never been read successfully is not invented.
    """

    def __init__(
        self,
        *,
        max_entries: int = 8,
        ttl_seconds: Callable[[], float] = _cache_ttl_seconds,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
        backoff_base: float = BACKOFF_BASE_SECONDS,
        backoff_cap: float = BACKOFF_CAP_SECONDS,
    ) -> None:
        self._max_entries = max(1, int(max_entries))
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._wall_clock = wall_clock
        self._backoff_base = backoff_base
        self._backoff_cap = backoff_cap
        self._lock = threading.RLock()
        self._entries: dict[str, _Entry] = {}
        self.last_error = ""

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self.last_error = ""

    def _forget_oldest(self) -> None:
        if len(self._entries) < self._max_entries:
            return
        oldest = min(self._entries.items(), key=lambda item: item[1].stored_at)[0]
        self._entries.pop(oldest, None)

    def read(
        self,
        key: str,
        loader: Callable[[], dict[str, Any]],
    ) -> tuple[dict[str, Any], int, bool]:
        """Return ``(model, observed_at, stale)``.

        Raises the loader's error only when no earlier successful model exists
        for this key, so a first-ever failure is reported rather than hidden.
        """
        with self._lock:
            now = self._clock()
            entry = self._entries.get(key)
            if entry is not None:
                if now - entry.stored_at < self._ttl_seconds():
                    return entry.model, entry.observed_at, False
                if now < entry.retry_after:
                    return entry.model, entry.observed_at, True
            try:
                model = loader()
            except Exception as exc:  # noqa: BLE001 - reported as an unavailable reading
                if entry is None:
                    raise
                entry.failures += 1
                entry.retry_after = now + min(
                    self._backoff_base * (2 ** (entry.failures - 1)), self._backoff_cap
                )
                self.last_error = f"{type(exc).__name__}: {_short(exc, 140)}"
                return entry.model, entry.observed_at, True
            observed_at = int(self._wall_clock())
            self._forget_oldest()
            self._entries[key] = _Entry(key=key, model=model, observed_at=observed_at, stored_at=now)
            self.last_error = ""
            return model, observed_at, False


_FRAPPE_CACHE = ProjectionCache()
_NTFY_CACHE = ProjectionCache()
_frappe_client: FrappeReadClient | None = None
_frappe_client_lock = threading.RLock()


def _shared_frappe_client() -> FrappeReadClient:
    """One reused session for both Frappe projections, so a render logs in once."""
    global _frappe_client
    with _frappe_client_lock:
        if _frappe_client is None:
            _frappe_client = FrappeReadClient()
        return _frappe_client


def _reset_caches(client: FrappeReadClient | None = None) -> None:
    """Test and operations hook: forget every cached model and the shared session."""
    global _frappe_client
    with _frappe_client_lock:
        if _frappe_client is not None and _frappe_client is not client:
            _frappe_client.close()
        _frappe_client = client
    for cache in (_FRAPPE_CACHE, _NTFY_CACHE):
        cache.clear()


# --------------------------------------------------------------------------- #
# Projection 1 — Helpdesk tickets awaiting the owner
# --------------------------------------------------------------------------- #

# The native Helpdesk status *category*, owned by the Helpdesk app, not a Frank
# invention: a ticket whose category is ``Open`` has not yet had its first agent
# reply, so the owner's team owes the next action on it. ``Paused`` means the
# customer owes the reply and ``Resolved`` means nobody does.
HELPDESK_OPEN_CATEGORY = "Open"


def _owner_assignment_clause(owner_user: str) -> list[list[str]]:
    """The native assignment rule, applied by Frappe, not by Frank.

    A ticket is the owner's responsibility when it is explicitly assigned to the
    owner's account, or when it is in no agent's queue at all (the shared inbox
    the owner works). A ticket explicitly assigned to another agent is that
    agent's work and is deliberately excluded.
    """
    return [["_assign", "is", "not set"], ["_assign", "like", f"%{owner_user}%"]]


def _assigned_to(assign_value: Any) -> list[str]:
    if not isinstance(assign_value, str) or not assign_value.strip():
        return []
    try:
        parsed = json.loads(assign_value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if isinstance(item, str) and item]


def _load_helpdesk_model(*, owner_user: str) -> dict[str, Any]:
    """Read the awaiting-owner ticket set. One list request, plus one count when needed."""
    client = _shared_frappe_client()
    filters = [
        ["status_category", "=", HELPDESK_OPEN_CATEGORY],
        ["docstatus", "=", 0],
        ["is_merged", "=", 0],
    ]
    assignment = _owner_assignment_clause(owner_user)
    rows = client.list_records(
        "HD Ticket",
        fields=HD_TICKET_LIST_FIELDS,
        filters=filters,
        or_filters=assignment,
        order_by="creation asc",
        limit=MAX_LIST_BOUND,
    )
    # A full page cannot be distinguished from a longer result set, so the exact
    # total then comes from the source's own count instead of from the page.
    truncated = len(rows) >= MAX_LIST_BOUND
    if truncated:
        total = client.count_records("HD Ticket", filters=filters, or_filters=assignment)
    open_category_total = client.count_records("HD Ticket", filters=filters)

    tickets = []
    for row in rows:
        name = str(row.get("name") or "")
        if not name:
            continue
        assigned = _assigned_to(row.get("_assign"))
        assigned_to_owner = owner_user in assigned
        # Frappe applies the assignment rule, and the row is checked again here so
        # the number and the listed items can never contradict each other: a
        # ticket explicitly owned by a different agent is another agent's work.
        if assigned and not assigned_to_owner:
            continue
        tickets.append(
            {
                "id": name,
                "subject": _short(row.get("subject"), 80),
                "status": _short(row.get("status"), 40),
                "status_category": _short(row.get("status_category"), 40),
                "created_at": _short(row.get("creation"), 40),
                "opening_date": _short(row.get("opening_date"), 20),
                "assignees": assigned[:3],
                "assigned_to_owner": assigned_to_owner,
                "unassigned": not assigned,
            }
        )
    if not truncated:
        total = len(tickets)
    return {
        "tickets": tickets,
        "total": total,
        "open_category_total": open_category_total,
        "truncated": truncated,
        "owner_user": owner_user,
    }


def _helpdesk_readings(model: dict[str, Any], observed_at: int, stale: bool, owner_user: str) -> dict[str, Any]:
    tickets = model["tickets"]
    total = int(model["total"])
    open_total = int(model["open_category_total"])
    elsewhere = max(open_total - total, 0)
    status = "attention" if total else "empty"
    detail = (
        f"{total} of {open_total} HD Tickets in the native Open status category are assigned to "
        f"{owner_user} or unassigned. {elsewhere} "
        f"{'is' if elsewhere == 1 else 'are'} explicitly assigned to another agent and "
        f"{'is' if elsewhere == 1 else 'are'} not counted. Tickets whose category is Paused wait on the customer."
    )
    if stale:
        status = "stale"
        detail = f"Cached Helpdesk reading, not refreshed. {detail}"
    if model["truncated"]:
        detail = f"{detail} The item list is bounded to the oldest {len(tickets)} tickets."

    items = [
        ow.attention_item(
            item_id=f"{SOURCE_HELPDESK}:{ticket['id']}",
            label=ticket["subject"] or ticket["id"],
            source=SOURCE_HELPDESK,
            detail=(
                f"{ticket['status']} · opened {ticket['opening_date'] or ticket['created_at']} · "
                + ("assigned to you" if ticket["assigned_to_owner"] else "unassigned")
            ),
            link=ow.owner_section_link("Open in support", "support"),
            observed_at=observed_at,
        )
        for ticket in tickets[:MAX_ATTENTION_ITEMS]
    ]
    return {
        "tickets_awaiting_owner": ow.reading(
            status=status,
            value=total,
            source=SOURCE_HELPDESK,
            source_ids=[f"{SOURCE_HELPDESK}:{ticket['id']}" for ticket in tickets[:MAX_SOURCE_IDS]],
            observed_at=observed_at,
            detail=detail,
        ),
        "tickets_awaiting_owner_items": ow.reading(
            status="attention" if items else ("stale" if stale else "empty"),
            value=items,
            source=SOURCE_HELPDESK,
            source_ids=[item["id"] for item in items],
            observed_at=observed_at,
            detail=f"The {len(items)} longest-waiting ticket(s), oldest first. Subjects are summaries, not message bodies.",
        ),
    }


def support_snapshot(*, now: int | None = None) -> dict[str, Any]:
    """Owner support card: Helpdesk tickets awaiting the owner, and nothing else."""
    moment = int(now if now is not None else time.time())
    link = ow.owner_section_link("Open support", "support")
    try:
        owner_user = crm_owner_user()
    except OwnerSourceUnavailable as exc:
        return ow.owner_snapshot(
            summary="Helpdesk is not configured.",
            readings={"tickets_awaiting_owner": ow.unconfigured(SOURCE_HELPDESK, str(exc))},
            links=[link],
            now=moment,
        )
    try:
        model, observed_at, stale = _FRAPPE_CACHE.read(
            f"helpdesk-awaiting-owner:{owner_user}",
            lambda: _load_helpdesk_model(owner_user=owner_user),
        )
    except OwnerSourceUnavailable as exc:
        return ow.owner_snapshot(
            summary="Helpdesk is unavailable.",
            readings={"tickets_awaiting_owner": ow.unconfigured(SOURCE_HELPDESK, str(exc))},
            links=[link],
            now=moment,
        )
    except Exception as exc:  # noqa: BLE001 - degrade this card, never the page
        return ow.owner_snapshot(
            summary="Helpdesk is unavailable.",
            readings={
                "tickets_awaiting_owner": ow.unconfigured(
                    SOURCE_HELPDESK, f"Helpdesk read failed ({type(exc).__name__})"
                )
            },
            links=[link],
            now=moment,
        )

    readings = _helpdesk_readings(model, observed_at, stale, owner_user)
    total = int(model["total"])
    summary = (
        f"{total} ticket{'s' if total != 1 else ''} awaiting the owner"
        + (" (cached)" if stale else "")
        + f", observed {_iso(observed_at)}."
    )
    snapshot = ow.owner_snapshot(summary=summary, readings=readings, links=[link], now=moment)
    _attach_standard_view(
        snapshot,
        metrics=[("tickets_awaiting_owner", "Awaiting you", "")],
        row_reading="tickets_awaiting_owner_items",
    )
    return snapshot


# --------------------------------------------------------------------------- #
# Projection 2 — CRM new leads
# --------------------------------------------------------------------------- #


def _load_new_leads(*, window: str) -> dict[str, Any]:
    """Count CRM leads by the **source record's own creation time**.

    Frappe evaluates the ``timespan`` filter with its own clock in the site's
    configured timezone, so this boundary is never computed or guessed in Frank.
    Lead intake mirror keys (``custom_blockwise_source_key``) and ``modified``
    are deliberately not used: a lead mirrored today was not necessarily created
    today, and the metric definition says so.
    """
    client = _shared_frappe_client()
    filters = [["creation", "timespan", window], ["docstatus", "=", 0]]
    rows = client.list_records(
        "CRM Lead",
        fields=CRM_LEAD_LIST_FIELDS,
        filters=filters,
        order_by="creation desc",
        limit=MAX_LIST_BOUND,
    )
    truncated = len(rows) >= MAX_LIST_BOUND
    if truncated:
        total = client.count_records("CRM Lead", filters=filters)
    else:
        total = len(rows)
    leads = []
    for row in rows:
        name = str(row.get("name") or "")
        if not name:
            continue
        leads.append(
            {
                "id": name,
                "label": _short(row.get("lead_name") or name, 80),
                "status": _short(row.get("status"), 40),
                "created_at": _short(row.get("creation"), 40),
            }
        )
    return {
        "leads": leads,
        "total": total,
        "truncated": truncated,
        "window": window,
        "oldest_observed_creation": leads[-1]["created_at"] if leads else "",
    }


def _open_lead_statuses() -> dict[str, Any]:
    """The CRM lead statuses whose **native type** is ``Open``.

    Read from ``CRM Lead Status`` rather than hard-coded, so a status added or
    retyped in CRM changes this projection without a Frank release.
    """
    client = _shared_frappe_client()
    rows = client.list_records(
        "CRM Lead Status",
        fields=("name", "type"),
        filters=[],
        order_by="name asc",
        limit=MAX_LIST_BOUND,
    )
    open_statuses = []
    for row in rows:
        name = str(row.get("name") or "")
        if name and str(row.get("type") or "").lower() == "open":
            open_statuses.append(name)
    if not open_statuses:
        raise OwnerSourceUnavailable("CRM Lead Status defines no status of native type Open")
    return {"open_statuses": open_statuses}


def _load_awaiting_first_contact(*, statuses: list[str]) -> dict[str, Any]:
    client = _shared_frappe_client()
    filters = [["status", "in", statuses], ["docstatus", "=", 0]]
    total = client.count_records("CRM Lead", filters=filters)
    return {"total": total, "statuses": list(statuses)}


def crm_snapshot(*, now: int | None = None) -> dict[str, Any]:
    """Owner CRM card: leads created in the native window, plus untouched leads."""
    moment = int(now if now is not None else time.time())
    link = ow.owner_section_link("Open CRM", "crm")
    readings: dict[str, Any] = {}
    try:
        window = crm_lead_window()
    except OwnerSourceUnavailable as exc:
        return ow.owner_snapshot(
            summary="CRM is not configured.",
            readings={"crm_new_leads": ow.unconfigured(SOURCE_CRM, str(exc))},
            links=[link],
            now=moment,
        )

    leads_stale = False
    try:
        lead_model, lead_observed_at, leads_stale = _FRAPPE_CACHE.read(
            f"crm-new-leads:{window}",
            lambda: _load_new_leads(window=window),
        )
    except OwnerSourceUnavailable as exc:
        lead_model, lead_observed_at = None, moment
        readings["crm_new_leads"] = ow.unconfigured(SOURCE_CRM, str(exc))
    except Exception as exc:  # noqa: BLE001 - degrade this card, never the page
        lead_model, lead_observed_at = None, moment
        readings["crm_new_leads"] = ow.unconfigured(
            SOURCE_CRM, f"CRM lead read failed ({type(exc).__name__})"
        )

    if lead_model is not None:
        total = int(lead_model["total"])
        status = "stale" if leads_stale else ("ready" if total else "empty")
        detail = (
            f"{total} CRM Lead record{'s' if total != 1 else ''} created in Frappe's native "
            f"'{window}' window, counted by the source record's own creation time. "
            "Mirror keys and modified time are not used."
        )
        if leads_stale:
            detail = f"Cached CRM reading, not refreshed. {detail}"
        if lead_model["truncated"]:
            detail = f"{detail} The item list is bounded to the newest {len(lead_model['leads'])} leads."
        if lead_model["oldest_observed_creation"]:
            detail = f"{detail} Oldest lead counted was created {lead_model['oldest_observed_creation']}."
        readings["crm_new_leads"] = ow.reading(
            status=status,
            value=total,
            source=SOURCE_CRM,
            source_ids=[f"{SOURCE_CRM}:{lead['id']}" for lead in lead_model["leads"][:MAX_SOURCE_IDS]],
            observed_at=lead_observed_at,
            detail=detail,
        )
        items = [
            ow.attention_item(
                item_id=f"{SOURCE_CRM}:{lead['id']}",
                label=lead["label"] or lead["id"],
                source=SOURCE_CRM,
                detail=f"{lead['status']} · created {lead['created_at']}",
                link=link,
                observed_at=lead_observed_at,
            )
            for lead in lead_model["leads"][:MAX_ATTENTION_ITEMS]
        ]
        readings["crm_new_lead_items"] = ow.reading(
            status="ready" if items else ("stale" if leads_stale else "empty"),
            value=items,
            source=SOURCE_CRM,
            source_ids=[item["id"] for item in items],
            observed_at=lead_observed_at,
            detail=(
                f"The newest {len(items)} lead(s). Only the record identifier, its display name, "
                "status and creation time are carried; no contact details or notes."
            ),
        )

    # The second reading has its own failure boundary: a status taxonomy that
    # cannot be read degrades this one number without touching the count above.
    try:
        status_model, status_observed_at, status_stale = _FRAPPE_CACHE.read(
            "crm-lead-statuses", _open_lead_statuses
        )
        contact_model, contact_observed_at, contact_stale = _FRAPPE_CACHE.read(
            f"crm-awaiting-first-contact:{','.join(status_model['open_statuses'])}",
            lambda: _load_awaiting_first_contact(statuses=status_model["open_statuses"]),
        )
        total = int(contact_model["total"])
        names = ", ".join(contact_model["statuses"])
        stale = status_stale or contact_stale
        if stale and total:
            contact_status = "stale"
        elif total:
            contact_status = "attention"
        else:
            contact_status = "empty"
        readings["crm_leads_awaiting_first_contact"] = ow.reading(
            status=contact_status,
            value=total,
            source=SOURCE_CRM,
            observed_at=min(status_observed_at, contact_observed_at),
            detail=(
                f"{total} CRM Lead record{'s' if total != 1 else ''} sit at a status whose native type "
                f"is Open ({names}) and have had no first contact."
                + (" This reading is cached, not refreshed." if stale else "")
            ),
        )
    except OwnerSourceUnavailable as exc:
        readings["crm_leads_awaiting_first_contact"] = ow.unconfigured(SOURCE_CRM, str(exc))
    except Exception as exc:  # noqa: BLE001 - degrade one number, never the card
        readings["crm_leads_awaiting_first_contact"] = ow.unconfigured(
            SOURCE_CRM, f"CRM lead-status read failed ({type(exc).__name__})"
        )

    primary = readings.get("crm_new_leads", {})
    if primary.get("status") in {"ready", "stale", "empty", "attention"}:
        summary = (
            f"{primary['value']} new lead{'s' if primary['value'] != 1 else ''} in the "
            f"'{window}' window"
            + (" (cached)" if leads_stale else "")
            + f", observed {_iso(lead_observed_at)}."
        )
    else:
        summary = "CRM leads are unavailable."
    snapshot = ow.owner_snapshot(summary=summary, readings=readings, links=[link], now=moment)
    _attach_standard_view(
        snapshot,
        metrics=[
            ("crm_new_leads", "New leads", ""),
            ("crm_leads_awaiting_first_contact", "No first contact", ""),
        ],
        row_reading="crm_new_lead_items",
    )
    return snapshot


# --------------------------------------------------------------------------- #
# Projection 3 — ntfy owner notification activity
# --------------------------------------------------------------------------- #


def _ntfy_transport() -> _BoundedHttp:
    """Build the ntfy transport. A seam, so a test proves the parse without a live server."""
    return _BoundedHttp()


def _load_ntfy_model(*, topic: str, window: str, password: str) -> dict[str, Any]:
    """Read publish activity for the one owner topic.

    Only ``time`` and ``title`` are read from a notification. The ``message``
    body is never parsed into the model, because the overview is not a second
    inbox. This reports **publish** activity: it is not evidence that a device
    received anything.
    """
    endpoint = _private_endpoint(_env(NTFY_BASE_URL_ENV, DEFAULT_NTFY_BASE_URL), source=SOURCE_NTFY)
    http = _ntfy_transport()
    token = base64.b64encode(f"owner:{password}".encode("utf-8")).decode("ascii")
    headers = {"Accept": "application/x-ndjson", "Authorization": f"Basic {token}"}

    health_request = urllib.request.Request(endpoint + "/v1/health", headers={"Accept": "application/json"})
    health = http.json(http.open(health_request, limit=4096))
    if not isinstance(health, dict) or health.get("healthy") is not True:
        raise OwnerSourceUnavailable("ntfy reports an unhealthy server")

    poll = f"/{urllib.parse.quote(topic, safe='')}/json?" + urllib.parse.urlencode(
        {"poll": "1", "since": window}
    )
    raw = http.open(urllib.request.Request(endpoint + poll, headers=headers))
    notifications: list[dict[str, Any]] = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            raise OwnerSourceUnavailable("ntfy returned a notification that is not valid JSON") from None
        if not isinstance(event, dict) or event.get("event") != "message":
            continue
        moment = event.get("time")
        if isinstance(moment, bool) or not isinstance(moment, int):
            continue
        notifications.append(
            {
                "id": _short(event.get("id"), 40),
                "time": moment,
                "title": _short(event.get("title"), 80),
            }
        )
        if len(notifications) > MAX_NTFY_NOTIFICATIONS:
            raise OwnerSourceUnavailable(
                f"ntfy returned more than {MAX_NTFY_NOTIFICATIONS} notifications in '{window}'; "
                "a partial count is not reported"
            )
    return {"notifications": notifications, "topic": topic, "window": window}


def notifications_snapshot(*, now: int | None = None) -> dict[str, Any]:
    """Owner notifications card: ntfy publish activity, not delivery proof."""
    moment = int(now if now is not None else time.time())
    link = ow.owner_section_link("Open notifications", "notifications")
    topic = _env(NTFY_TOPIC_ENV, DEFAULT_NTFY_TOPIC)
    window = _env(NTFY_WINDOW_ENV, DEFAULT_NTFY_WINDOW)
    if not SAFE_TOPIC.fullmatch(topic):
        return ow.owner_snapshot(
            summary="Notifications are not configured.",
            readings={
                "notification_activity": ow.unconfigured(
                    SOURCE_NTFY, f"{NTFY_TOPIC_ENV} must be a plain ntfy topic name"
                )
            },
            links=[link],
            now=moment,
        )
    try:
        password = ntfy_credentials()
        model, observed_at, stale = _NTFY_CACHE.read(
            f"ntfy:{topic}:{window}",
            lambda: _load_ntfy_model(topic=topic, window=window, password=password),
        )
    except OwnerSourceUnavailable as exc:
        return ow.owner_snapshot(
            summary="Notification activity is unavailable.",
            readings={"notification_activity": ow.unconfigured(SOURCE_NTFY, str(exc))},
            links=[link],
            now=moment,
        )
    except Exception as exc:  # noqa: BLE001 - degrade this card, never the page
        return ow.owner_snapshot(
            summary="Notification activity is unavailable.",
            readings={
                "notification_activity": ow.unconfigured(
                    SOURCE_NTFY, f"ntfy read failed ({type(exc).__name__})"
                )
            },
            links=[link],
            now=moment,
        )

    notifications = model["notifications"]
    total = len(notifications)
    newest = notifications[-1] if notifications else None
    detail = (
        f"{total} message{'s' if total != 1 else ''} published by Frank services to the "
        f"'{topic}' topic in the last {window}. This is publish activity only: it is not proof "
        "that any device received a notification, and no message body is read."
    )
    if newest:
        detail = f"{detail} Newest was published {_iso(newest['time'])}."
    readings = {
        "notification_activity": ow.reading(
            status="stale" if stale else ("ready" if total else "empty"),
            value=total,
            source=SOURCE_NTFY,
            source_ids=[f"{SOURCE_NTFY}:{item['id']}" for item in notifications if item["id"]],
            observed_at=observed_at,
            detail=detail,
        )
    }
    if newest:
        readings["notification_titles"] = ow.reading(
            status="ready",
            value=[
                {
                    "id": f"{SOURCE_NTFY}:{item['id']}",
                    "label": item["title"] or "Notification",
                    "source": SOURCE_NTFY,
                    "detail": _iso(item["time"]),
                    "link": link,
                    "observed_at": observed_at,
                }
                for item in notifications[-MAX_ATTENTION_ITEMS:]
            ],
            source=SOURCE_NTFY,
            observed_at=observed_at,
            detail="Titles of the most recent notifications. Bodies are never read.",
        )
    summary = (
        f"{total} owner notification{'s' if total != 1 else ''} published in the last {window}"
        + (" (cached)" if stale else "")
        + f", observed {_iso(observed_at)}."
    )
    snapshot = ow.owner_snapshot(summary=summary, readings=readings, links=[link], now=moment)
    _attach_standard_view(
        snapshot,
        metrics=[("notification_activity", "Published", "")],
        row_reading="notification_titles",
    )
    return snapshot


# --------------------------------------------------------------------------- #
# Projection 4 — the merged owner attention queue
# --------------------------------------------------------------------------- #


def _attention_items_from(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Collect the attention items a projection already produced."""
    items: list[dict[str, Any]] = []
    for reading in (snapshot.get("data") or {}).get("readings", {}).values():
        value = reading.get("value")
        if isinstance(value, list):
            items.extend(item for item in value if isinstance(item, dict) and item.get("id"))
    return items


def _attention_loader(source: str, builder: Callable[[], dict[str, Any]]) -> Callable[[], list[dict[str, Any]]]:
    """Adapt one owner projection to :func:`owner_workspace.collect_attention`.

    A projection degrades to an empty snapshot when its source is down. The
    merged queue must not read that as "nothing to do", so a projection with no
    readable source raises instead, and ``collect_attention`` then reports that
    source as unavailable while still returning every other source's items.
    """

    def load() -> list[dict[str, Any]]:
        snapshot = builder()
        readings = (snapshot.get("data") or {}).get("readings", {})
        readable = [
            item
            for item in readings.values()
            if isinstance(item, dict) and item.get("status") in {"ready", "attention", "empty", "stale"}
        ]
        if not readable:
            reason = next(
                (str(item.get("detail")) for item in readings.values() if isinstance(item, dict) and item.get("detail")),
                "no readable reading",
            )
            raise OwnerSourceUnavailable(f"{source} could not be read: {_short(reason, 140)}")
        return _attention_items_from(snapshot)

    return load


def attention_snapshot(*, now: int | None = None) -> dict[str, Any]:
    """The owner's single queue, gathered without letting one source break it."""
    moment = int(now if now is not None else time.time())
    gathered = ow.collect_attention(
        {
            SOURCE_HELPDESK: _attention_loader(SOURCE_HELPDESK, lambda: support_snapshot(now=moment)),
            SOURCE_CRM: _attention_loader(SOURCE_CRM, lambda: crm_snapshot(now=moment)),
        }
    )
    items = gathered["items"]
    unavailable = gathered["unavailable_sources"]
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, Any]] = []
    for item in items:
        identity = (str(item.get("source") or ""), str(item.get("id") or ""))
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(item)

    readings: dict[str, Any] = {}
    if unique:
        readings["owner_attention"] = ow.reading(
            status="attention",
            value=unique[: MAX_ATTENTION_ITEMS * 2],
            source="owner_attention",
            source_ids=[item["id"] for item in unique],
            observed_at=moment,
            detail=(
                f"{len(unique)} item(s) from {len({item.get('source') for item in unique})} source(s). "
                "Each item links to the owning application through a typed owner section."
            ),
        )
    elif unavailable:
        readings["owner_attention"] = ow.unconfigured(
            "owner_attention",
            "No source could be read: "
            + "; ".join(f"{item['source']} ({item['detail']})" for item in unavailable),
        )
    else:
        readings["owner_attention"] = ow.reading(
            status="empty",
            value=[],
            source="owner_attention",
            observed_at=moment,
            detail="No ticket or lead currently needs the owner.",
        )
    for item in unavailable:
        readings[f"unavailable_{item['source']}"] = ow.unconfigured(item["source"], item["detail"])

    summary = (
        f"{len(unique)} item{'s' if len(unique) != 1 else ''} need the owner."
        if unique
        else "Nothing needs the owner from the connected sources."
    )
    snapshot = ow.owner_snapshot(
        summary=summary,
        readings=readings,
        links=[
            ow.owner_section_link("Support", "support"),
            ow.owner_section_link("CRM", "crm"),
        ],
        now=moment,
    )
    _attach_standard_view(snapshot, metrics=[("owner_attention", "Need you", "")], row_reading="owner_attention")
    return snapshot


# --------------------------------------------------------------------------- #
# Existing Home renderer vocabulary
# --------------------------------------------------------------------------- #


def _attach_standard_view(
    snapshot: dict[str, Any],
    *,
    metrics: list[tuple[str, str, str]],
    row_reading: str,
) -> None:
    """Also publish the values in the ``metrics``/``rows`` shape the Home renderer already draws.

    ``data.readings`` stays the frozen owner contract and the source of truth.
    ``web/js/homes.js`` already renders ``data.metrics`` and ``data.rows`` for
    every other card, so the same honest values are mirrored into that existing
    vocabulary instead of adding a second renderer. Only readings that actually
    carry a value contribute: an unavailable source adds no metric and no row,
    so a failure can never be drawn as a real zero.
    """
    readings = snapshot.get("data", {}).get("readings", {})
    published = []
    for name, label, unit in metrics:
        item = readings.get(name)
        if not isinstance(item, dict) or item.get("value") is None:
            continue
        if isinstance(item["value"], (list, dict)):
            continue
        published.append({"label": label, "value": item["value"], "unit": unit})
    if published:
        snapshot["data"]["metrics"] = published
    rows = []
    item = readings.get(row_reading)
    if isinstance(item, dict) and isinstance(item.get("value"), list):
        for entry in item["value"]:
            if not isinstance(entry, dict):
                continue
            rows.append(
                {
                    "name": _short(entry.get("label") or entry.get("id"), 80),
                    "detail": _short(entry.get("detail"), 80),
                }
            )
    if rows:
        snapshot["data"]["rows"] = rows


# --------------------------------------------------------------------------- #
# Home registration
# --------------------------------------------------------------------------- #


@home_providers.register("owner-support")
def owner_support_provider(ctx: home_providers.ProviderContext) -> dict:
    return support_snapshot(now=ctx.now)


@home_providers.register("owner-crm-leads")
def owner_crm_leads_provider(ctx: home_providers.ProviderContext) -> dict:
    return crm_snapshot(now=ctx.now)


@home_providers.register("owner-notifications")
def owner_notifications_provider(ctx: home_providers.ProviderContext) -> dict:
    return notifications_snapshot(now=ctx.now)


@home_providers.register("owner-attention")
def owner_attention_provider(ctx: home_providers.ProviderContext) -> dict:
    return attention_snapshot(now=ctx.now)


#: Widget catalogue records for the coordinator to append to
#: ``home_platform.BUILTIN_WIDGETS``. Each is scoped to the Blockwise owner
#: project so it can only ever appear on the owner's own home.
OWNER_WIDGET_MANIFESTS: list[dict[str, Any]] = [
    {
        "id": "owner-support", "version": "1.0.0", "title": "Tickets awaiting you",
        "description": "Helpdesk tickets in the native Open category assigned to you or unassigned.",
        "surfaces": ["project"], "entity_scope": {"kind": "project", "id": ow.OWNER_PROJECT_ID},
        "default_size": "medium", "allowed_sizes": ["small", "medium", "wide"],
        "provider": "frank.owner", "freshness": "poll",
        "accepts_connection": False, "multiple": False,
    },
    {
        "id": "owner-crm-leads", "version": "1.0.0", "title": "New leads",
        "description": "CRM leads created in the source window, plus leads with no first contact.",
        "surfaces": ["project"], "entity_scope": {"kind": "project", "id": ow.OWNER_PROJECT_ID},
        "default_size": "medium", "allowed_sizes": ["small", "medium", "wide"],
        "provider": "frank.owner", "freshness": "poll",
        "accepts_connection": False, "multiple": False,
    },
    {
        "id": "owner-attention", "version": "1.0.0", "title": "Needs you",
        "description": "One owner queue merged from the connected owner sources.",
        "surfaces": ["project"], "entity_scope": {"kind": "project", "id": ow.OWNER_PROJECT_ID},
        "default_size": "medium", "allowed_sizes": ["small", "medium", "wide"],
        "provider": "frank.owner", "freshness": "poll",
        "accepts_connection": False, "multiple": False,
    },
    {
        "id": "owner-notifications", "version": "1.0.0", "title": "Notifications",
        "description": "Publish activity on the owner notification topic. Not delivery proof.",
        "surfaces": ["project"], "entity_scope": {"kind": "project", "id": ow.OWNER_PROJECT_ID},
        "default_size": "small", "allowed_sizes": ["small", "medium", "wide"],
        "provider": "frank.owner", "freshness": "poll",
        "accepts_connection": False, "multiple": False,
    },
]
