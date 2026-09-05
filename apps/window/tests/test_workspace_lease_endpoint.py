"""Private lease endpoint tests: runtime credential, fail-closed auth."""
import tempfile
import unittest
from pathlib import Path

from flask import Flask

from infra.workspace.lease import WorkspaceLease
from infra.workspace.lease_blueprint import create_lease_blueprint
from infra.workspace.schemas import LeaseOwner


class LeaseEndpointTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.lease = WorkspaceLease(Path(self.temp.name), ttl_seconds=5, verifier=lambda owner: False)
        self.original = None
        import os
        self.env_name = "FRANK_LEASE_CREDENTIAL_TEST"
        self.original = os.environ.get(self.env_name)
        os.environ[self.env_name] = "runtime-only-secret"
        app = Flask(__name__)
        app.register_blueprint(create_lease_blueprint(self.lease, credential_env=self.env_name))
        self.client = app.test_client()
        self.owner = {"owner": {"executor_kind": "codex", "executor_id": "codex-1"}}

    def tearDown(self):
        import os
        if self.original is None:
            os.environ.pop(self.env_name, None)
        else:
            os.environ[self.env_name] = self.original
        self.temp.cleanup()

    def test_acquire_requires_bearer_credential(self):
        self.assertEqual(self.client.post("/internal/leases/ws/acquire", json=self.owner).status_code, 403)
        self.assertEqual(
            self.client.post(
                "/internal/leases/ws/acquire", json=self.owner, headers={"Authorization": "Bearer wrong"}
            ).status_code,
            403,
        )

    def test_missing_runtime_credential_fails_closed(self):
        import os
        os.environ.pop(self.env_name)
        response = self.client.post(
            "/internal/leases/ws/acquire",
            json=self.owner,
            headers={"Authorization": "Bearer runtime-only-secret"},
        )
        self.assertEqual(response.status_code, 503)

    def test_authenticated_lifecycle(self):
        headers = {"Authorization": "Bearer runtime-only-secret"}
        created = self.client.post("/internal/leases/ws/acquire", json=self.owner, headers=headers)
        self.assertEqual(created.status_code, 201)
        generation = created.get_json()["lease"]["generation"]
        self.assertNotIn("runtime-only-secret", created.get_data(as_text=True))
        beat = self.client.post(
            "/internal/leases/ws/heartbeat", json={"generation": generation}, headers=headers
        )
        self.assertEqual(beat.status_code, 200)
        released = self.client.post(
            "/internal/leases/ws/release", json={"generation": generation}, headers=headers
        )
        self.assertEqual(released.status_code, 200)
        inspected = self.client.get("/internal/leases/ws", headers=headers)
        self.assertEqual(inspected.get_json()["record"]["state"], "released")

    def test_stale_generation_is_conflict(self):
        headers = {"Authorization": "Bearer runtime-only-secret"}
        self.client.post("/internal/leases/ws/acquire", json=self.owner, headers=headers)
        stale = self.client.post(
            "/internal/leases/ws/release", json={"generation": "forged"}, headers=headers
        )
        self.assertEqual(stale.status_code, 409)


if __name__ == "__main__":
    unittest.main()
