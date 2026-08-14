"""VPS-only acceptance canary for Frank homes, widgets, and connections."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


BASE_URL = os.environ.get("FRANK_CANARY_URL", "http://127.0.0.1:8080").rstrip("/")


def request(path: str, *, method: str = "GET", payload: dict | None = None) -> tuple[int, dict]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    outgoing = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
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
    })
    assert status == 201
    connection = created["connection"]

    status, updated = request(f"/api/connections/{connection['id']}", method="PATCH", payload={"status": "verified"})
    assert status == 200 and updated["connection"]["status"] == "verified"

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
        "status": "connected", "connection_ref": "re_" + "1234567890abcdefghijklmnop",
    })
    assert status == 400

    print(json.dumps({
        "status": "pass",
        "widgets": len(catalog["widgets"]),
        "layout_revision": saved["revision"],
        "connection_status": updated["connection"]["status"],
        "secret_rejection": "pass",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
