import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
SPEC = importlib.util.spec_from_file_location("owner_user_under_test", ROOT / "owner_user.py")
owner_user = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(owner_user)


class FakeClient:
    def __init__(self, *, agent=None, agent_role=True):
        roles = list(owner_user.ROLES) + ([owner_user.AGENT_ROLE] if agent_role else [])
        self.user = {"name": owner_user.USER, "enabled": 1, "user_type": "System User", "full_name": "Steven Shelley", "roles": [{"role": role} for role in roles]}
        self.agent = agent
        self.calls = []

    def _request(self, method, path, *, body=None):
        self.calls.append((method, path, body))
        if path.startswith("/api/resource/User?"):
            return {"data": [{"name": owner_user.USER}]}
        if path == "/api/resource/User/" + owner_user.USER:
            return {"data": self.user}
        if path.startswith("/api/resource/HD%20Agent?"):
            return {"data": [self.agent] if self.agent else []}
        if path == "/api/resource/HD%20Agent" and method == "POST":
            self.agent = {"name": owner_user.USER, **body}
            self.user["roles"].append({"role": owner_user.AGENT_ROLE})
            return {"data": self.agent}
        if path == "/api/resource/HD%20Agent/" + owner_user.USER and method == "PUT":
            self.agent["is_active"] = body["is_active"]
            if owner_user.AGENT_ROLE not in {row["role"] for row in self.user["roles"]}:
                self.user["roles"].append({"role": owner_user.AGENT_ROLE})
            return {"data": self.agent}
        raise AssertionError((method, path, body))


class OwnerHelpdeskTests(unittest.TestCase):
    def test_preview_of_missing_agent_is_read_only(self):
        client = FakeClient(agent=None, agent_role=False)
        self.assertIsNone(owner_user._owner_agent(client))
        self.assertFalse(any(method in {"POST", "PUT"} for method, _, _ in client.calls))

    def test_apply_creates_native_agent_and_verifies_native_role(self):
        client = FakeClient(agent=None, agent_role=False)
        owner_user._create_agent(client, client.user)
        self.assertIsNotNone(owner_user._owner_agent(client))
        self.assertIn(owner_user.AGENT_ROLE, owner_user._roles(client.user))
        post = next(body for method, path, body in client.calls if method == "POST" and path == "/api/resource/HD%20Agent")
        self.assertEqual(post, {"user": owner_user.USER, "agent_name": "Steven Shelley", "is_active": 1})
        self.assertFalse(any(path.startswith("/api/resource/User") and method == "POST" for method, path, _ in client.calls))

    def test_replay_does_not_write_or_reset_identity(self):
        agent = {"name": owner_user.USER, "user": owner_user.USER, "agent_name": "Steven Shelley", "is_active": 1}
        client = FakeClient(agent=agent, agent_role=True)
        owner_user._validate_owner(client.user)
        self.assertEqual(owner_user._owner_agent(client), agent)
        self.assertFalse(any(method in {"POST", "PUT"} for method, _, _ in client.calls))

    def test_existing_agent_without_agent_role_requires_review(self):
        agent = {"name": owner_user.USER, "user": owner_user.USER, "agent_name": "Steven Shelley", "is_active": 1}
        client = FakeClient(agent=agent, agent_role=False)
        self.assertNotIn(owner_user.AGENT_ROLE, owner_user._roles(client.user))
        self.assertEqual(owner_user._owner_agent(client), agent)


if __name__ == "__main__":
    unittest.main()
