import json
import os
import urllib.error
import urllib.request
import uuid


def delegate_task(room: str, task: str, why: str, confidence: str) -> str:
    """Hand a concrete piece of work to a project room so its scoped agent executes it.

    Call this ONLY when Steve has asked for actual work that belongs to one project.
    Do NOT call it when Steve is asking a question about how the system works, when
    he is asking whether you CAN delegate, when you are explaining what you already
    did, or when you are listing the rooms that exist. Talking about a room is not
    delegating to it.

    The task argument must be a complete, standalone instruction that the receiving
    agent could act on with no other context — not a topic, not a room name, not a
    fragment of your reply.

    Args:
        room: Which project room executes the task. One of: blockwise, chase,
            merrypaws, lotfile.
        task: The complete standalone instruction for the receiving agent. Must
            make sense with no other context.
        why: One sentence: why this belongs in that room. Shown to Steve.
        confidence: "sure" starts the run immediately. "unsure" creates a proposal
            Steve must approve. When in doubt, choose "unsure".

    Returns:
        A short receipt describing what happened. If the delegation is proposed,
        tell Steve it is waiting on his confirm.
    """
    url = os.environ.get("FRANK_DELEGATE_URL", "http://frank-web:3001")
    payload = {
        "room": room,
        "task": task,
        "why": why,
        "confidence": "sure" if confidence == "sure" else "unsure",
        "key": str(uuid.uuid4()),
    }
    req = urllib.request.Request(
        url.rstrip("/") + "/api/delegations",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8")).get("error", str(e))
        except Exception:
            err = str(e)
        return f"Delegation rejected: {err}"
    except Exception as e:
        return f"Delegation failed to reach Frank web: {e}"

    if out.get("status") == "proposed":
        return (
            f"Proposed to {room}. Steve must approve it before it runs — "
            "tell him it is waiting on his confirm."
        )
    return (
        f"Running in {room} (id {out.get('id')}). The receipt lands in Central "
        "automatically — do not repeat it yourself."
    )
