"""VPS-only acceptance canary for Frank homes, widgets, and connections."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


BASE_URL = os.environ.get("FRANK_CANARY_URL", "http://127.0.0.1:8080").rstrip("/")
HERMES_AGENT_KEY = os.environ.get("HERMES_CONNECTIONS_AGENT_KEY", "").strip()


def request(path: str, *, method: str = "GET", payload: dict | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    outgoing = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Origin": BASE_URL,
            **({"Idempotency-Key": f"canary-{time.time_ns()}"} if method in {"POST", "PATCH", "DELETE"} else {}),
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(outgoing, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


def main() -> None:
    suffix = str(time.time_ns())[-10:]
    status, catalog = request("/api/widgets")
    assert status == 200 and catalog["schema"] == "schema://frank.widget-catalog/v1"
    assert len(catalog["widgets"]) >= 10

    status, created = request("/api/connections", method="POST", payload={
        "provider": "activepieces",
        "name": f"Hosted canary {suffix}",
        "scope_kind": "project",
        "scope_id": "blockwise",
        "status": "connected",
        "connection_ref": f"ap://connections/canary-{suffix}",
        "credential_ref": f"openbao://frank/connections/canary-{suffix}",
        "capabilities": ["workflow.status"],
        "notes": "Disposable hosted acceptance record.",
        "idempotency_key": f"canary-create-{suffix}",
    })
    assert status == 201
    connection = created["connection"]

    status, updated = request(f"/api/connections/{connection['id']}", method="PATCH", payload={"notes": "Hosted canary metadata update", "idempotency_key": f"canary-update-{suffix}"})
    assert status == 200 and updated["connection"]["status"] == "connected"

    status, planned = request("/api/connections/plan", method="POST", payload={
        "action": "verify", "connection_id": connection["id"],
        "expected_revision": updated["connection"]["revision"], "idempotency_key": f"canary-verify-plan-{suffix}",
    })
    assert status == 200
    plan_id = planned["plan"]["plan_id"]

    status, pending = request("/api/connections/apply", method="POST", payload={
        "plan_id": plan_id, "idempotency_key": f"canary-verify-apply-{suffix}",
    })
    assert status == 202 and pending["action"]["state"] == "waiting_for_provider"

    status, verified = request("/api/connections/agent/apply", method="POST", payload={
        "plan_id": plan_id, "idempotency_key": f"canary-hermes-apply-{suffix}",
        "provider_receipt": f"hermes://receipts/canary-verify-{suffix}", "provider_outcome": "verified",
    }, headers={"Authorization": f"Bearer {HERMES_AGENT_KEY}", "X-Hermes-Profile": "default"})
    assert status == 200 and verified["action"]["state"] == "completed"
    assert verified["connection"]["status"] == "verified"

    status, home = request("/api/homes/project/blockwise")
    assert status == 200 and home["entity"] == {
        "id": "blockwise", "kind": "project", "name": "Blockwise",
        "project": home["entity"]["project"],
    }
    instances = [
        {**instance, "config": {"connection_id": connection["id"]}}
        if instance["widget_id"] == "connections-summary" else instance
        for instance in home["instances"]
    ]
    status, saved = request("/api/homes/project/blockwise", method="PUT", payload={
        "expected_revision": home["revision"], "instances": instances,
    })
    assert status == 200 and saved["revision"] == home["revision"] + 1

    connection_instance = next(item for item in saved["instances"] if item["widget_id"] == "connections-summary")
    status, snapshot = request(
        f"/api/homes/project/blockwise/widgets/{connection_instance['instance_id']}"
    )
    assert status == 200 and snapshot["data"]["counts"]["verified"] >= 1
    assert snapshot["data"]["status_is_recorded"] is True

    status, _ = request("/api/connections", method="POST", payload={
        "provider": "resend", "name": f"Unsafe {suffix}", "scope_kind": "global",
        "status": "connected", "connection_ref": "re_" + "1234567890abcdefghijklmnop", "idempotency_key": f"canary-unsafe-{suffix}",
    })
    assert status == 400

    print(json.dumps({
        "status": "pass",
        "widgets": len(catalog["widgets"]),
        "layout_revision": saved["revision"],
        "connection_status": verified["connection"]["status"],
        "secret_rejection": "pass",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
