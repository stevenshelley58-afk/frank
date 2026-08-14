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
    assert status == 200
    assert home["entity"]["id"] == "blockwise"
    assert home["entity"]["kind"] == "project"
    assert home["entity"]["name"] == "Blockwise"
    assert home["entity"]["profile"]["root"] == "blockwise"
    assert [item["widget_id"] for item in home["instances"]] == [
        "entity-overview", "application-status", "repository-activity",
        "repository-status", "project-files", "accounts-summary",
        "connection-attention", "analytics-summary",
    ]
    connection_instance = next(item for item in home["instances"] if item["widget_id"] == "connection-attention")
    instances = [
        instance
        for instance in home["instances"]
    ]
    status, saved = request("/api/homes/project/blockwise", method="PUT", payload={
        "expected_revision": home["revision"], "instances": instances,
    })
    assert status == 200 and saved["revision"] == home["revision"] + 1

    connection_instance = next(item for item in saved["instances"] if item["widget_id"] == "connection-attention")
    status, snapshot = request(
        f"/api/homes/project/blockwise/widgets/{connection_instance['instance_id']}"
    )
    assert status == 200
    assert snapshot["status"] == "ready"
    assert snapshot["summary"] == "No connection setup, verification, or error items are recorded."
    assert snapshot["data"]["rows"] == []

    status, central_summary = request(
        "/api/homes/tool/connections/widgets/connections-summary-1"
    )
    assert status == 200
    assert central_summary["status"] == "ready"
    assert central_summary["data"]["counts"]["verified"] >= 1
    assert any(item["id"] == connection["id"] for item in central_summary["data"]["connections"])

    status, central_coverage = request(
        "/api/homes/tool/connections/widgets/provider-coverage-1"
    )
    assert status == 200
    assert central_coverage["data"]["verified"] >= 1
    assert next(row for row in central_coverage["data"]["rows"] if row["provider"] == "activepieces")["status"] == "verified"

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
