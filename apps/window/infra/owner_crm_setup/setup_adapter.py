"""Idempotent native Frappe Custom Field setup for the owner CRM.

The adapter deliberately has a very small surface: it authenticates a short-lived
Administrator session, reads and creates only Custom Field records, and never
imports CRM records or changes mail configuration. Writes require `--apply`;
the default CLI mode is a read-only dry run.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import http.cookiejar
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any, Callable, Mapping
import urllib.error
import urllib.parse
import urllib.request


MANIFEST_SCHEMA = "schema://frank.owner-crm-setup-manifest/v1"
DEFAULT_ENDPOINT = "http://127.0.0.1:18081"
DEFAULT_SITE = "owner.crm.internal"
DEFAULT_SECRET_FILE = Path("/srv/frank/secrets/owner-crm.env")
DEFAULT_MANIFEST_FILE = Path(__file__).with_name("manifest.json")
ADMIN_USER = "Administrator"
MAX_RESPONSE_BYTES = 1024 * 1024
RECORD_PAGE_LENGTH = 100
MAX_PREFLIGHT_RECORDS = 10_000
_SAFE_FIELDNAME = re.compile(r"^custom_[a-z][a-z0-9_]{0,58}$")
_SAFE_NAME = re.compile(r"^(?:CRM Lead|Contact)-custom_[a-z][a-z0-9_]{0,58}$")
_FIELD_TYPES = {"Data", "Datetime", "Long Text", "Select"}
_SOURCE_IDENTITY_FIELDS = frozenset({
    ("CRM Lead", "custom_blockwise_prospect_source_uuid"),
    ("Contact", "custom_blockwise_profile_uuid"),
    ("Contact", "custom_blockwise_workspace_uuid"),
})
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
_FIELD_KEYS = {
    "name",
    "doctype",
    "dt",
    "fieldname",
    "label",
    "fieldtype",
    "options",
    "default",
    "unique",
    "read_only",
    "description",
}
_COMPARE_KEYS = (
    "name",
    "dt",
    "fieldname",
    "label",
    "fieldtype",
    "options",
    "default",
    "unique",
    "read_only",
    "description",
)
_COMPARE_KEYS_WITHOUT_UNIQUE = tuple(key for key in _COMPARE_KEYS if key != "unique")


class SetupError(RuntimeError):
    """A safe, user-facing setup failure without response bodies or secrets."""


@dataclass(frozen=True)
class PlanItem:
    action: str
    field: Mapping[str, Any]
    existing_name: str | None = None


def _text(value: Any, label: str, *, required: bool = True) -> str:
    if not isinstance(value, str) or (required and not value.strip()):
        raise SetupError(f"invalid manifest {label}")
    return value


def _is_flag(value: Any) -> bool:
    return isinstance(value, bool) or (isinstance(value, int) and value in (0, 1))


def _canonical_field(field: Mapping[str, Any]) -> dict[str, Any]:
    """Return the closed Custom Field shape used for comparisons and writes."""
    result: dict[str, Any] = {
        "name": field["name"],
        "doctype": "Custom Field",
        "dt": field["dt"],
        "fieldname": field["fieldname"],
        "label": field["label"],
        "fieldtype": field["fieldtype"],
        "read_only": int(bool(field["read_only"])),
        "unique": int(bool(field["unique"])),
        "description": field["description"],
    }
    for key in ("options", "default"):
        if key in field:
            result[key] = field[key]
    return result


def validate_manifest(manifest: Mapping[str, Any]) -> tuple[dict[str, Any], ...]:
    """Validate the setup contract and return closed, canonical field definitions."""
    if not isinstance(manifest, Mapping):
        raise SetupError("manifest must be an object")
    if set(manifest) != {"$schema", "version", "site", "endpoint", "fields"}:
        raise SetupError("manifest has unsupported keys")
    if manifest["$schema"] != MANIFEST_SCHEMA or manifest["version"] != 1:
        raise SetupError("unsupported owner CRM setup manifest")
    if manifest["site"] != DEFAULT_SITE or manifest["endpoint"] != DEFAULT_ENDPOINT:
        raise SetupError("owner CRM endpoint or site is not the fixed loopback target")
    fields = manifest["fields"]
    if not isinstance(fields, list) or not fields:
        raise SetupError("manifest fields must be a non-empty list")

    result: list[dict[str, Any]] = []
    names: set[str] = set()
    identities: set[tuple[str, str]] = set()
    for field in fields:
        if not isinstance(field, Mapping) or not set(field).issubset(_FIELD_KEYS):
            raise SetupError("manifest contains an unsupported field definition")
        required = ("name", "doctype", "dt", "fieldname", "label", "fieldtype", "unique", "read_only", "description")
        if any(key not in field for key in required):
            raise SetupError("manifest field is missing required metadata")
        name = _text(field["name"], "field name")
        dt = _text(field["dt"], "doctype")
        fieldname = _text(field["fieldname"], "fieldname")
        if dt not in {"CRM Lead", "Contact"} or not _SAFE_FIELDNAME.fullmatch(fieldname):
            raise SetupError(f"invalid manifest field identity: {name}")
        if not _SAFE_NAME.fullmatch(name) or name != f"{dt}-{fieldname}":
            raise SetupError(f"manifest field name is not deterministic: {name}")
        if name in names or (dt, fieldname) in identities:
            raise SetupError(f"manifest contains duplicate field: {name}")
        if field["doctype"] != "Custom Field" or field["fieldtype"] not in _FIELD_TYPES:
            raise SetupError(f"invalid Custom Field definition: {name}")
        if not _is_flag(field["read_only"]):
            raise SetupError(f"invalid read_only flag: {name}")
        if not _is_flag(field["unique"]):
            raise SetupError(f"invalid unique flag: {name}")
        if (dt, fieldname) in _SOURCE_IDENTITY_FIELDS and not field["unique"]:
            raise SetupError(f"source identity field must be unique: {name}")
        if (dt, fieldname) not in _SOURCE_IDENTITY_FIELDS and field["unique"]:
            raise SetupError(f"only source identity fields may be unique: {name}")
        label = _text(field["label"], f"{name}.label")
        description = _text(field["description"], f"{name}.description")
        if chr(10) in label or chr(13) in label or chr(10) in description or chr(13) in description:
            raise SetupError(f"invalid line break in field metadata: {name}")
        if "options" in field and not isinstance(field["options"], str):
            raise SetupError(f"invalid options: {name}")
        if "default" in field and not isinstance(field["default"], str):
            raise SetupError(f"invalid default: {name}")
        if field["fieldtype"] == "Select":
            options = field.get("options", "")
            if not options or field.get("default") not in options.splitlines():
                raise SetupError(f"Select field must have a listed default: {name}")
        elif "options" in field or "default" in field:
            raise SetupError(f"only Select fields may define options/default: {name}")
        canonical = _canonical_field(field)
        names.add(name)
        identities.add((dt, fieldname))
        result.append(canonical)
    return tuple(result)


def load_manifest(path: Path = DEFAULT_MANIFEST_FILE) -> tuple[dict[str, Any], ...]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SetupError("unable to read owner CRM setup manifest") from exc
    return validate_manifest(manifest)


def load_credentials(
    path: Path = DEFAULT_SECRET_FILE, *, enforce_permissions: bool = True
) -> tuple[str, str]:
    """Load only the Administrator password from the external bootstrap secret."""
    try:
        info = path.lstat()
    except OSError as exc:
        raise SetupError("owner CRM secret file is unavailable") from exc
    if not stat.S_ISREG(info.st_mode) or path.is_symlink():
        raise SetupError("owner CRM secret file must be a regular file")
    if enforce_permissions and stat.S_IMODE(info.st_mode) != 0o600:
        raise SetupError("owner CRM secret file has unsafe permissions")
    if enforce_permissions and info.st_uid != 0:
        raise SetupError("owner CRM secret file must be root-owned")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        raise SetupError("owner CRM secret file is unreadable") from exc
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, value = stripped.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise SetupError("owner CRM secret file has invalid syntax")
        values[key] = value
    password = values.get("OWNER_CRM_ADMIN_PASSWORD", "")
    if not password or chr(10) in password or chr(13) in password:
        raise SetupError("owner CRM Administrator password is missing")
    return ADMIN_USER, password


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        raise SetupError("Frappe redirect rejected")


class FrappeRestClient:
    """Minimal loopback Frappe client with an in-memory cookie jar."""

    def __init__(
        self,
        *,
        endpoint: str = DEFAULT_ENDPOINT,
        site: str = DEFAULT_SITE,
        opener: Callable[..., Any] | None = None,
        timeout: float = 10.0,
    ) -> None:
        if endpoint != DEFAULT_ENDPOINT or site != DEFAULT_SITE:
            raise SetupError("Frappe target is not the fixed owner CRM loopback site")
        self.endpoint = endpoint
        self.site = site
        self.timeout = timeout
        self.cookies = http.cookiejar.CookieJar()
        if opener is None:
            self._opener = urllib.request.build_opener(
                _NoRedirect(), urllib.request.HTTPCookieProcessor(self.cookies)
            ).open
        else:
            self._opener = opener if callable(opener) else opener.open

    def close(self) -> None:
        self.cookies.clear()

    def _request(
        self, method: str, path: str, *, body: Mapping[str, Any] | None = None, form: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        if not path.startswith("/") or "://" in path:
            raise SetupError("invalid Frappe API path")
        data: bytes | None = None
        headers = {
            "Accept": "application/json",
            "Host": self.site,
            "X-Frappe-Site-Name": self.site,
        }
        if method != "GET" and path != "/api/method/login":
            csrf_token = next(
                (cookie.value for cookie in self.cookies if cookie.name == "csrf_token"),
                "",
            )
            if csrf_token:
                headers["X-Frappe-CSRF-Token"] = csrf_token
        if form is not None:
            data = urllib.parse.urlencode(form).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.endpoint + path, data=data, headers=headers, method=method)
        try:
            with self._opener(request, timeout=self.timeout) as response:
                status = int(getattr(response, "status", response.getcode()))
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except SetupError:
            raise
        except urllib.error.HTTPError as exc:
            if 300 <= exc.code < 400:
                raise SetupError("Frappe redirect rejected") from None
            if exc.code in {401, 403}:
                raise SetupError("Frappe Administrator authentication failed") from None
            if exc.code == 409:
                raise SetupError("Frappe rejected a conflicting Custom Field") from None
            raise SetupError(f"Frappe request failed ({exc.code})") from None
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            raise SetupError("Frappe loopback endpoint is unavailable") from exc
        if 300 <= status < 400:
            raise SetupError("Frappe redirect rejected")
        if len(raw) > MAX_RESPONSE_BYTES:
            raise SetupError("Frappe response is too large")
        try:
            decoded = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SetupError("Frappe returned invalid JSON") from exc
        if not isinstance(decoded, dict):
            raise SetupError("Frappe returned an invalid response")
        return decoded

    def login(self, username: str, password: str) -> None:
        if username != ADMIN_USER or not password:
            raise SetupError("only the Administrator bootstrap session is supported")
        self._request("POST", "/api/method/login", form={"usr": username, "pwd": password})

    def logout(self) -> None:
        self._request("POST", "/api/method/logout")

    def get_doctype(self, dt: str) -> None:
        if dt not in {"CRM Lead", "Contact"}:
            raise SetupError("unsupported owner CRM DocType")
        result = self._request("GET", "/api/resource/DocType/" + urllib.parse.quote(dt, safe=""))
        data = result.get("data")
        if not isinstance(data, dict) or data.get("name") != dt:
            raise SetupError(f"required Frappe DocType is unavailable: {dt}")

    def list_custom_field(self, dt: str, fieldname: str) -> list[dict[str, Any]]:
        filters = json.dumps([["dt", "=", dt], ["fieldname", "=", fieldname]], separators=(",", ":"))
        fields = json.dumps(list(_COMPARE_KEYS), separators=(",", ":"))
        query = urllib.parse.urlencode(
            {"filters": filters, "fields": fields, "limit_page_length": "20"}
        )
        result = self._request("GET", "/api/resource/Custom%20Field?" + query)
        data = result.get("data")
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
            raise SetupError("Frappe returned invalid Custom Field data")
        return data

    def iter_field_values(self, dt: str, fieldname: str):
        """Yield one optional identity value at a time with a hard page bound."""
        if dt not in {"CRM Lead", "Contact"} or not _SAFE_FIELDNAME.fullmatch(fieldname):
            raise SetupError("unsupported owner CRM identity field")
        fields = json.dumps([fieldname], separators=(",", ":"))
        offset = 0
        total = 0
        while True:
            query = urllib.parse.urlencode({
                "fields": fields,
                "limit_page_length": str(RECORD_PAGE_LENGTH),
                "limit_start": str(offset),
                "order_by": "name asc",
            })
            result = self._request(
                "GET",
                "/api/resource/" + urllib.parse.quote(dt, safe="") + "?" + query,
            )
            data = result.get("data")
            if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
                raise SetupError("Frappe returned invalid owner CRM data")
            if len(data) > RECORD_PAGE_LENGTH:
                raise SetupError("Frappe exceeded the bounded owner CRM page size")
            total += len(data)
            if total > MAX_PREFLIGHT_RECORDS:
                raise SetupError("owner CRM identity preflight exceeds its bounded record limit")
            for item in data:
                if fieldname not in item:
                    raise SetupError("Frappe returned an owner CRM row without the identity field")
                yield item[fieldname]
            if len(data) < RECORD_PAGE_LENGTH:
                return
            offset += len(data)

    def create_custom_field(self, field: Mapping[str, Any]) -> dict[str, Any]:
        result = self._request("POST", "/api/resource/Custom%20Field", body=dict(field))
        data = result.get("data")
        if not isinstance(data, dict):
            raise SetupError("Frappe returned invalid created Custom Field data")
        return data

    def update_custom_field_unique(self, field: Mapping[str, Any]) -> dict[str, Any]:
        name = field.get("name")
        identity = (field.get("dt"), field.get("fieldname"))
        if not isinstance(name, str) or identity not in _SOURCE_IDENTITY_FIELDS:
            raise SetupError("invalid owner CRM source identity field")
        result = self._request(
            "PUT",
            "/api/resource/Custom%20Field/" + urllib.parse.quote(name, safe=""),
            body={"unique": 1},
        )
        data = result.get("data")
        if not isinstance(data, dict) or data.get("name") != name:
            raise SetupError("Frappe returned an invalid updated Custom Field")
        try:
            updated_unique = _normalise_flag(data.get("unique"))
        except ValueError:
            raise SetupError("Frappe returned an invalid updated Custom Field") from None
        if updated_unique != 1 or not _compatible(data, field):
            raise SetupError("Frappe returned an incompatible updated Custom Field")
        return data


def _normalise_flag(value: Any, *, missing: int | None = None) -> int:
    if value is None and missing is not None:
        return missing
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int) and value in (0, 1):
        return value
    if isinstance(value, str) and value in {"0", "1"}:
        return int(value)
    raise ValueError("invalid flag")


def _compatible(
    existing: Mapping[str, Any],
    desired: Mapping[str, Any],
    *,
    include_unique: bool = True,
) -> bool:
    keys = _COMPARE_KEYS if include_unique else _COMPARE_KEYS_WITHOUT_UNIQUE
    for key in keys:
        expected = desired.get(key, "")
        actual = existing.get(key, "")
        if key in {"read_only", "unique"}:
            try:
                actual = _normalise_flag(actual, missing=0)
                expected = _normalise_flag(expected)
            except ValueError:
                return False
        elif actual is None:
            actual = ""
        if str(actual) != str(expected):
            return False
    return True


def _preflight_source_values(client: FrappeRestClient, field: Mapping[str, Any]) -> None:
    seen: set[str] = set()
    for value in client.iter_field_values(field["dt"], field["fieldname"]):
        if value is None or value == "":
            continue
        if not isinstance(value, str) or not _UUID.fullmatch(value):
            raise SetupError(f"invalid source identity values: {field['name']}")
        identity = value.lower()
        if identity in seen:
            raise SetupError(f"duplicate source identity values: {field['name']}")
        seen.add(identity)


def plan_setup(
    client: FrappeRestClient, fields: tuple[dict[str, Any], ...]
) -> tuple[PlanItem, ...]:
    """Preflight definitions and source values before returning any write plan."""
    plan: list[PlanItem] = []
    existing_by_identity: dict[tuple[str, str], Mapping[str, Any]] = {}
    for dt in sorted({field["dt"] for field in fields}):
        client.get_doctype(dt)
    for desired in fields:
        existing = client.list_custom_field(desired["dt"], desired["fieldname"])
        if len(existing) > 1:
            raise SetupError(f"duplicate existing Custom Fields for {desired['name']}")
        if not existing:
            plan.append(PlanItem("create", desired))
            continue
        record = existing[0]
        if record.get("name") != desired["name"]:
            raise SetupError(f"incompatible existing Custom Field: {desired['name']}")
        try:
            existing_unique = _normalise_flag(record.get("unique"), missing=0)
        except ValueError:
            raise SetupError(f"incompatible existing Custom Field: {desired['name']}") from None
        identity = (desired["dt"], desired["fieldname"])
        existing_by_identity[identity] = record
        if _compatible(record, desired):
            plan.append(PlanItem("unchanged", desired, desired["name"]))
        elif (
            desired["unique"] == 1
            and existing_unique == 0
            and _compatible(record, desired, include_unique=False)
        ):
            plan.append(PlanItem("upgrade_unique", desired, desired["name"]))
        else:
            raise SetupError(f"incompatible existing Custom Field: {desired['name']}")
    for desired in fields:
        identity = (desired["dt"], desired["fieldname"])
        if identity in _SOURCE_IDENTITY_FIELDS and identity in existing_by_identity:
            _preflight_source_values(client, desired)
    return tuple(plan)


def run_setup(
    *,
    apply: bool = False,
    manifest_path: Path = DEFAULT_MANIFEST_FILE,
    secret_path: Path = DEFAULT_SECRET_FILE,
    client: FrappeRestClient | None = None,
) -> tuple[PlanItem, ...]:
    fields = load_manifest(manifest_path)
    owned_client = client is None
    logged_in = False
    if client is None:
        username, password = load_credentials(secret_path)
        client = FrappeRestClient()
        try:
            client.login(username, password)
            logged_in = True
        except Exception:
            client.close()
            raise
    try:
        plan = plan_setup(client, fields)
        if apply:
            for item in plan:
                if item.action == "create":
                    client.create_custom_field(item.field)
                elif item.action == "upgrade_unique":
                    client.update_custom_field_unique(item.field)
        return plan
    finally:
        if owned_client:
            try:
                if logged_in:
                    client.logout()
            finally:
                client.close()


def _cli() -> int:
    parser = argparse.ArgumentParser(description="Configure native owner CRM Custom Fields")
    parser.add_argument("--apply", action="store_true", help="create missing fields; default is read-only dry-run")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_FILE)
    args = parser.parse_args()
    try:
        plan = run_setup(apply=args.apply, manifest_path=args.manifest)
    except SetupError as exc:
        print(f"owner CRM setup failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "status": "applied" if args.apply else "dry_run",
        "site": DEFAULT_SITE,
        "endpoint": DEFAULT_ENDPOINT,
        "fields": [{"name": item.field["name"], "action": item.action} for item in plan],
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
