"""Idempotently configure native Frappe Webhooks for private owner alerts."""
from __future__ import annotations
import argparse, base64, json, stat, sys, urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

INFRA_ROOT = Path(__file__).resolve().parents[1]
if str(INFRA_ROOT) not in sys.path:
    sys.path.insert(0, str(INFRA_ROOT))
from owner_crm_setup import setup_adapter as crm

DEFAULT_MANIFEST = Path(__file__).with_name("manifest.json")
NTFY_SECRET = Path("/srv/frank/secrets/owner-notifications/owner-notifications.env")
REPLY_SECRET = Path("/srv/hermes/secrets/owner-mail-events.env")
TOPIC = "owner-notifications"
URL = "http://frank-owner-ntfy/"
REPLY_URL = "http://172.16.1.1:18085/api/owner-mail-events/reply"
REPLY_HOOK = "owner-incoming-email-reply-stop"
REPLY_SECRET_MARKER = "owner-mail-reply-secret"
REPLY_FIELDS = (
    ("event_id", "name"),
    ("sender", "sender"),
    ("recipients", "recipients"),
    ("cc", "cc"),
    ("bcc", "bcc"),
    ("communication_medium", "communication_medium"),
    ("sent_or_received", "sent_or_received"),
    ("in_reply_to", "in_reply_to"),
    ("uid", "uid"),
    ("email_account", "email_account"),
    ("communication_date", "communication_date"),
    ("message_id", "message_id"),
)
ALLOWED_DOCTYPES = {"CRM Task", "HD Ticket", "CRM Lead", "Communication"}
REQUIRED_DOCTYPES = ("CRM Task", "HD Ticket", "CRM Lead", "Communication")
INCOMING_EMAIL_CONDITION = "doc.communication_medium == \"Email\" and doc.sent_or_received == \"Received\""

class NotificationError(crm.SetupError):
    pass

@dataclass(frozen=True)
class PlanItem:
    action: str
    name: str

def _load_env_value(path: Path, key: str) -> str:
    try: info = path.lstat()
    except OSError as exc: raise NotificationError("notification secret is unavailable") from exc
    if not stat.S_ISREG(info.st_mode) or path.is_symlink() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != 0:
        raise NotificationError("notification secret must be root-owned regular 0600 file")
    try: lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc: raise NotificationError("notification secret is unreadable") from exc
    for line in lines:
        name, sep, value = line.partition("=")
        if name == key and sep and value and "\r" not in value and "\n" not in value:
            return value
    raise NotificationError("notification publisher credential is missing")

def load_manifest(path: Path = DEFAULT_MANIFEST) -> tuple[dict[str, Any], ...]:
    try: raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc: raise NotificationError("unable to read webhook manifest") from exc
    if not isinstance(raw, dict) or set(raw) != {"$schema", "version", "site", "endpoint", "topic", "webhooks"}:
        raise NotificationError("invalid webhook manifest")
    if raw["$schema"] != "schema://frank.owner-crm-notifications/v1" or raw["version"] != 1 or raw["site"] != crm.DEFAULT_SITE or raw["endpoint"] != crm.DEFAULT_ENDPOINT or raw["topic"] != TOPIC:
        raise NotificationError("webhook manifest target is not fixed owner infrastructure")
    hooks = raw["webhooks"]
    if not isinstance(hooks, list) or len(hooks) != 5: raise NotificationError("webhook manifest must define exactly five hooks")
    names: set[str] = set(); result = []
    for hook in hooks:
        if not isinstance(hook, dict) or set(hook) != {"name","webhook_doctype","webhook_docevent","condition","enabled","request_url","request_method","request_structure","timeout","background_jobs_queue","webhook_json","webhook_headers","webhook_data","enable_security","webhook_secret"}:
            raise NotificationError("webhook manifest has unsupported fields")
        if not isinstance(hook["name"], str) or not hook["name"].startswith("owner-") or hook["name"] in names: raise NotificationError("webhook name is invalid or duplicate")
        if hook["webhook_doctype"] not in ALLOWED_DOCTYPES or hook["webhook_docevent"] != "after_insert" or hook["enabled"] != 1: raise NotificationError("webhook event is not an allowed owner notification")
        condition = hook["condition"]
        if condition is not None and not isinstance(condition, str): raise NotificationError("webhook condition is invalid")
        if hook["webhook_doctype"] == "Communication" and condition != INCOMING_EMAIL_CONDITION: raise NotificationError("Communication webhook must match incoming email only")
        if hook["webhook_doctype"] != "Communication" and condition is not None: raise NotificationError("non-email webhook cannot have a condition")
        is_reply = hook["name"] == REPLY_HOOK
        expected_url = REPLY_URL if is_reply else URL
        expected_structure = "" if is_reply else "JSON"
        if hook["request_url"] != expected_url or hook["request_method"] != "POST" or hook["request_structure"] != expected_structure or hook["timeout"] != 5 or hook["background_jobs_queue"] != "short": raise NotificationError("webhook delivery target is unsafe")
        expected_headers = ([{"key":"Content-Type","value":"application/json"}] if is_reply else [{"key":"Authorization","value":"publisher-basic"},{"key":"Content-Type","value":"application/json"}])
        if hook["webhook_headers"] != expected_headers: raise NotificationError("webhook authentication contract is invalid")
        if is_reply:
            expected_data = [{"key": key, "fieldname": field} for key, field in REPLY_FIELDS]
            if hook["webhook_doctype"] != "Communication" or hook["webhook_data"] != expected_data or hook["webhook_json"] is not None: raise NotificationError("reply webhook data contract is invalid")
            if hook["enable_security"] != 1 or hook["webhook_secret"] != REPLY_SECRET_MARKER: raise NotificationError("reply webhook security is invalid")
        else:
            if hook["webhook_data"] != [] or hook["enable_security"] != 0 or hook["webhook_secret"] is not None: raise NotificationError("notification webhook security contract is invalid")
            try: payload = json.loads(hook["webhook_json"])
            except (TypeError, json.JSONDecodeError) as exc: raise NotificationError("webhook payload is invalid") from exc
            if set(payload) != {"topic","title","message","tags"} or payload["topic"] != TOPIC or not all(isinstance(payload[k], str) and payload[k] for k in ("title","message")) or not isinstance(payload["tags"], list): raise NotificationError("webhook payload is unsafe")
            rendered = hook["webhook_json"].lower()
            if any(word in rendered for word in ("doc.", "contact", "customer", "description", "subject", "sender", "recipient", "body", "{{", "}}")): raise NotificationError("webhook payload may contain private record data")
        names.add(hook["name"]); result.append(dict(hook))
    return tuple(result)

class Client(crm.FrappeRestClient):
    def get_required_doctype(self, doctype: str) -> None:
        if doctype not in ALLOWED_DOCTYPES: raise NotificationError("unsupported webhook DocType")
        result = self._request("GET", "/api/resource/DocType/" + urllib.parse.quote(doctype, safe=""))
        if not isinstance(result.get("data"), dict) or result["data"].get("name") != doctype: raise NotificationError("required Frappe DocType is unavailable")
    def list_named(self, name: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"filters": json.dumps([["name","=",name]], separators=(",",":")), "fields": json.dumps(["name"], separators=(",",":")), "limit_page_length":"2"})
        data = self._request("GET", "/api/resource/Webhook?" + query).get("data")
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data): raise NotificationError("Frappe returned invalid Webhook list")
        return data
    def get_webhook(self, name: str) -> dict[str, Any]:
        data = self._request("GET", "/api/resource/Webhook/" + urllib.parse.quote(name, safe="")).get("data")
        if not isinstance(data, dict): raise NotificationError("Frappe returned invalid Webhook")
        return data
    def create_webhook(self, hook: Mapping[str, Any]) -> None:
        data = self._request("POST", "/api/resource/Webhook", body=dict(hook)).get("data")
        if not isinstance(data, dict) or data.get("name") != hook["name"]: raise NotificationError("Frappe did not create the requested Webhook")
    def update_webhook(self, hook: Mapping[str, Any]) -> None:
        data = self._request("PUT", "/api/resource/Webhook/" + urllib.parse.quote(str(hook["name"]), safe=""), body=dict(hook)).get("data")
        if not isinstance(data, dict) or data.get("name") != hook["name"]: raise NotificationError("Frappe did not update the requested Webhook")

def payload_for_doctype(doctype: str) -> dict[str, Any]:
    payloads = {
        "CRM Task": {"topic": TOPIC, "title": "Owner CRM task created", "message": "A new owner CRM task requires review.", "tags": ["clipboard"]},
        "HD Ticket": {"topic": TOPIC, "title": "Owner support ticket created", "message": "A new owner support ticket requires review.", "tags": ["ticket"]},
        "CRM Lead": {"topic": TOPIC, "title": "Owner CRM lead created", "message": "A new owner CRM lead requires review.", "tags": ["lead"]},
        "Communication": {"topic": TOPIC, "title": "Owner inbound email received", "message": "A new inbound email requires review.", "tags": ["email"]},
    }
    try:
        return dict(payloads[doctype])
    except KeyError as exc:
        raise NotificationError("unsupported webhook payload DocType") from exc


def _payload_json(doctype: str) -> str:
    return json.dumps(payload_for_doctype(doctype), separators=(",", ":"))


def _desired(hook: Mapping[str, Any], password: str, reply_secret: str) -> dict[str, Any]:
    result = dict(hook)
    if hook["name"] == REPLY_HOOK:
        result["webhook_secret"] = reply_secret
    else:
        value = base64.b64encode(("publisher:" + password).encode("utf-8")).decode("ascii")
        result["webhook_json"] = _payload_json(str(hook["webhook_doctype"]))
        result["webhook_headers"] = [{"key":"Authorization", "value":"Basic " + value}, {"key":"Content-Type", "value":"application/json"}]
    return result

def _compatible(actual: Mapping[str, Any], desired: Mapping[str, Any]) -> bool:
    # Frappe omits an unset condition on reads but accepts null on writes.
    if (actual.get("condition") or None) != (desired.get("condition") or None):
        return False
    for key in ("name","webhook_doctype","webhook_docevent","enabled","request_url","request_method","request_structure","timeout","background_jobs_queue","webhook_json","enable_security"):
        if str(actual.get(key, "")) != str(desired[key]): return False
    headers = actual.get("webhook_headers")
    data = actual.get("webhook_data") or []
    return isinstance(headers, list) and [{"key": item.get("key"), "value": item.get("value")} for item in headers] == desired["webhook_headers"] and [{"key": item.get("key"), "fieldname": item.get("fieldname")} for item in data] == desired["webhook_data"]

def run_setup(*, apply: bool = False, manifest_path: Path = DEFAULT_MANIFEST, client: Client | None = None) -> tuple[PlanItem, ...]:
    hooks = load_manifest(manifest_path); password = _load_env_value(NTFY_SECRET, "NTFY_PUBLISHER_PASSWORD"); reply_secret = _load_env_value(REPLY_SECRET, "OWNER_MAIL_REPLY_SECRET")
    if len(reply_secret) < 32: raise NotificationError("reply webhook secret is too short")
    owned = client is None; logged = False
    if client is None:
        username, admin_password = crm.load_credentials(); client = Client(); client.login(username, admin_password); logged = True
    try:
        for doctype in REQUIRED_DOCTYPES: client.get_required_doctype(doctype)
        desired = [_desired(hook, password, reply_secret) for hook in hooks]; plan: list[PlanItem] = []
        for hook in desired:
            found = client.list_named(hook["name"])
            if len(found) > 1: raise NotificationError("duplicate native Webhooks found")
            if not found: plan.append(PlanItem("create", hook["name"])); continue
            actual = client.get_webhook(hook["name"])
            if _compatible(actual, hook): plan.append(PlanItem("unchanged", hook["name"])); continue
            if actual.get("webhook_doctype") != hook["webhook_doctype"] or actual.get("webhook_docevent") != "after_insert": raise NotificationError("existing native Webhook is incompatible")
            plan.append(PlanItem("update", hook["name"]))
        if apply:
            for hook, item in zip(desired, plan):
                if item.action == "create": client.create_webhook(hook)
                elif item.action == "update": client.update_webhook(hook)
        return tuple(plan)
    finally:
        if owned:
            try:
                if logged: client.logout()
            finally: client.close()

def main() -> int:
    parser = argparse.ArgumentParser(description="Configure private native Frappe Webhooks")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try: plan = run_setup(apply=args.apply)
    except crm.SetupError as exc:
        print(f"owner CRM notification setup failed: {exc}", file=sys.stderr); return 1
    print(json.dumps({"status":"applied" if args.apply else "dry_run", "webhooks":[{"name":x.name,"action":x.action} for x in plan]}, separators=(",",":")))
    return 0
if __name__ == "__main__": raise SystemExit(main())
