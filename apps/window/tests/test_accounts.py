import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class AccountsApiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_file = server.ACCOUNTS_FILE
        server.ACCOUNTS_FILE = Path(self.temp.name) / "accounts.json"
        self.client = server.app.test_client()

    def tearDown(self):
        server.ACCOUNTS_FILE = self.original_file
        self.temp.cleanup()

    def test_account_lifecycle_persists_only_safe_metadata(self):
        created = self.client.post("/api/accounts", json={
            "project_id": "blockwise",
            "kind": "email",
            "name": "Blockwise main",
            "identity": "hello@blockwise.sale",
            "provider": "Resend",
            "purpose": "main sender",
            "credential_ref": "openbao://frank/email/blockwise",
            "status": "setup",
        })
        self.assertEqual(created.status_code, 201)
        account = created.get_json()["account"]
        self.assertEqual(account["identity"], "hello@blockwise.sale")

        listed = self.client.get("/api/accounts").get_json()["accounts"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["credential_ref"], "openbao://frank/email/blockwise")

        updated = self.client.patch(f"/api/accounts/{account['id']}", json={"status": "ready"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["account"]["status"], "ready")

        removed = self.client.delete(f"/api/accounts/{account['id']}")
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self.client.get("/api/accounts").get_json()["accounts"], [])

    def test_rejects_credentials_and_invalid_email(self):
        secret = self.client.post("/api/accounts", json={
            "kind": "service",
            "name": "Resend",
            "identity": "blockwise",
            "password": "must-not-land-here",
        })
        self.assertEqual(secret.status_code, 400)
        self.assertFalse(server.ACCOUNTS_FILE.exists())

        invalid = self.client.post("/api/accounts", json={
            "kind": "email",
            "name": "Broken",
            "identity": "not-an-email",
        })
        self.assertEqual(invalid.status_code, 400)

        safe_account = {
            "project_id": "blockwise",
            "kind": "email",
            "name": "Blockwise main",
            "identity": "hello@blockwise.sale",
            "provider": "Resend",
        }
        pasted_secret = self.client.post("/api/accounts", json={
            **safe_account,
            "notes": "api_key=re_this_is_a_secret_value",
        })
        self.assertEqual(pasted_secret.status_code, 400)

        raw_reference = self.client.post("/api/accounts", json={
            **safe_account,
            "credential_ref": "re_this_is_not_a_vault_locator",
        })
        self.assertEqual(raw_reference.status_code, 400)

    def test_email_tool_health_never_depends_on_resend_key(self):
        with patch.dict(os.environ, {
            "RESEND_API_KEY": "re_secret_never_read_by_frank",
            "RESEND_CONNECTOR_STATUS": "",
            "RESEND_MCP_STATUS": "configured",
            "MAUTIC_URL": "https://campaigns.example.test",
            "MAUTIC_CONNECTOR_STATUS": "",
        }):
            response = self.client.get("/api/email-tools")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["resend"]["status"], "unconfigured")
        self.assertEqual(payload["resend"]["mcp_status"], "configured")
        self.assertEqual(payload["mautic"]["status"], "configured")
        self.assertNotIn("re_secret", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
