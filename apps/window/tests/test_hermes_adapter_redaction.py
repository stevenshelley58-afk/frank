import unittest

from hermes_adapter.redaction import REDACTED, redact_text, redact_url, redact_value


class RedactionTest(unittest.TestCase):
    def test_redacts_bearer_and_authorization_values(self):
        bearer_value = "fixture-" + "value-123456"
        text = "Authorization: Bearer " + bearer_value
        self.assertNotIn(bearer_value, redact_text(text))
        self.assertIn(REDACTED, redact_text(text))

    def test_redacts_api_keys_and_jwt(self):
        api_key = "s" + "k_live_" + "fixturevalue123456"
        jwt = ("e" + "yJ" + "hbGciOiJIUzI1NiJ9") + "." + ("e" + "yJzdWIiOiIxIn0") + "." + "fixture-signature"
        text = "key " + api_key + " and " + jwt
        redacted = redact_text(text)
        self.assertNotIn(api_key, redacted)
        self.assertNotIn(jwt.split(".")[0], redacted)

    def test_redacts_private_key_blocks(self):
        text = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----"
        self.assertNotIn("MIIabc", redact_text(text))

    def test_redacts_env_values(self):
        text = "HERMES_SESSION_TOKEN=supersecret123\nPLAIN=value"
        redacted = redact_text(text)
        self.assertNotIn("supersecret123", redacted)
        self.assertIn("PLAIN=value", redacted)

    def test_redacts_url_query_tokens(self):
        url = "/api/ws?token=abcdef123456&other=visible"
        redacted = redact_url(url)
        self.assertNotIn("abcdef123456", redacted)
        self.assertIn("other=visible", redacted)

    def test_redacts_restricted_paths(self):
        text = "config at /home/hermes/.hermes/config.yaml and /srv/frank/secrets/window.env"
        redacted = redact_text(text)
        self.assertNotIn("config.yaml", redacted)
        self.assertNotIn("window.env", redacted)

    def test_structural_redaction_keeps_shape_and_counts(self):
        event = {
            "kind": "tool.start",
            "sequence": 7,
            "headers": {"Authorization": "Bearer " + "fixture-value-123456"},
            "nested": {"api_key": "s" + "k_live_fixturevalue123456", "note": "safe"},
            "items": [1, "two", {"token": "fixture-token-123456"}],
        }
        redacted = redact_value(event)
        self.assertEqual(redacted["sequence"], 7)
        self.assertEqual(redacted["headers"]["Authorization"], REDACTED)
        self.assertEqual(redacted["nested"]["api_key"], REDACTED)
        self.assertEqual(redacted["nested"]["note"], "safe")
        self.assertEqual(redacted["items"][2]["token"], REDACTED)
        self.assertEqual(len(redacted["items"]), 3)

    def test_redaction_is_idempotent(self):
        text = "Bearer " + "fixture-value-123456"
        self.assertEqual(redact_text(redact_text(text)), redact_text(text))


if __name__ == "__main__":
    unittest.main()
