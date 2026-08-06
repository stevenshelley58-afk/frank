#!/usr/bin/env python3
"""
register_tool.py — idempotently create the delegate_task tool in Letta and
attach it to the frank-central agent.

Env:
  LETTA_URL   base URL (default http://localhost:8283)

Flags:
  --create-only   Create the tool in Letta's registry but do NOT attach it to
                  frank-central. Use before the /api/delegations route ships —
                  an attached tool pointing at a backend without that route
                  would hand Steve a confusing failure. Re-run without the
                  flag after deploy to finish the wiring.

Safe to run repeatedly: re-runs detect an existing tool/attachment and no-op.
"""
import json
import os
import sys
import urllib.error
import urllib.request

CREATE_ONLY = "--create-only" in sys.argv

LETTA = os.environ.get("LETTA_URL", "http://localhost:8283").rstrip("/")
HERE = os.path.dirname(os.path.abspath(__file__))
AGENT_NAME = "frank-central"

JSON_SCHEMA = {
    "name": "delegate_task",
    "description": (
        "Hand a concrete piece of work to a project room so its scoped agent "
        "executes it. Call this ONLY when Steve has asked for actual work that "
        "belongs to one project — never for questions about the system, the "
        "rooms, or whether you can delegate. The task argument must be a "
        "complete standalone instruction that makes sense with no other context."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "room": {
                "type": "string",
                "enum": ["blockwise", "chase", "merrypaws", "lotfile"],
                "description": "Which project room executes the task.",
            },
            "task": {
                "type": "string",
                "minLength": 12,
                "description": "The complete standalone instruction for the receiving agent.",
            },
            "why": {
                "type": "string",
                "description": "One sentence: why this belongs in that room. Shown to Steve.",
            },
            "confidence": {
                "type": "string",
                "enum": ["sure", "unsure"],
                "description": '"sure" starts the run immediately. "unsure" waits for Steve to approve. When in doubt, choose "unsure".',
            },
        },
        "required": ["room", "task", "why", "confidence"],
    },
}


def api(method, path, body=None):
    req = urllib.request.Request(
        LETTA + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        raise SystemExit(f"HTTP {e.code} on {method} {path}: {detail}")


def main():
    with open(os.path.join(HERE, "delegate_task.py"), encoding="utf-8") as f:
        source_code = f.read()

    # 1. Find or create the tool.
    tools = api("GET", "/v1/tools/?name=delegate_task")
    tool = next((t for t in tools if t.get("name") == "delegate_task"), None)
    if tool:
        print(f"tool exists: {tool['id']}")
    else:
        tool = api("POST", "/v1/tools/", {
            "source_code": source_code,
            "source_type": "python",
            "json_schema": JSON_SCHEMA,
        })
        print(f"tool created: {tool['id']}")

    # 2. Find the frank-central agent.
    if CREATE_ONLY:
        print("create-only: skipping attachment (run again without --create-only after deploy)")
        return
    agents = api("GET", f"/v1/agents/?name={AGENT_NAME}")
    agent = next((a for a in agents if a.get("name") == AGENT_NAME), None)
    if not agent:
        print(f"agent '{AGENT_NAME}' does not exist yet — it is created on Central's first chat turn.")
        print("Re-run this script after Central has been used once, or attach via the console.")
        return

    # 3. Attach if not already attached.
    attached = api("GET", f"/v1/agents/{agent['id']}/tools")
    names = [t.get("name") for t in attached]
    if "delegate_task" in names:
        print("already attached — nothing to do")
        return
    api("PATCH", f"/v1/agents/{agent['id']}/tools/attach/{tool['id']}")
    print("attached delegate_task to frank-central")


if __name__ == "__main__":
    main()
