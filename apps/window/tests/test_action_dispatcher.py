import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from action_dispatcher import DispatchError, HermesDispatcher


YAML = """actions:
  - id: tool:refresh-evidence
    enabled: true
    target_allowlist: [project:frank]
    arguments:
      mode: {type: enum, values: [fast, full]}
      idempotency_key: {type: idempotency_key}
    rollback_action_id: null
  - id: tool:deploy-frank
    enabled: true
    target_allowlist: [release:frank]
    arguments:
      commit: {type: revision}
      idempotency_key: {type: idempotency_key}
    rollback_action_id: tool:rollback-frank
"""


class Response:
    def __init__(self, body=b'{"status":"accepted","receipt_id":"r1","rollback_action_id":"tool:rollback-frank","idempotency_key":"abcdefgh","preview":false}', url=None):
        self.body, self.url = body, url
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit=-1): return self.body
    def geturl(self): return self.url or os.environ["HERMES_ENDPOINT"] + "/v1/control/actions"


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "actions.yaml"
        self.path.write_text(YAML, encoding="utf-8")
        os.environ["HERMES_ENDPOINT"] = "https://hermes.example"
        os.environ["HERMES_API_KEY"] = "dispatcher-test-key"
        self.args = {"mode": "fast", "idempotency_key": "abcdefgh"}

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop("HERMES_ENDPOINT", None)
        os.environ.pop("HERMES_API_KEY", None)

    def dispatch(self, opener=lambda req, timeout: Response()):
        return HermesDispatcher(self.path, opener=opener).dispatch(
            action_id="tool:refresh-evidence", target_id="project:frank",
            arguments=self.args, attestation="operator-approved")

    def test_forwards_typed_payload_and_receipt_including_rollback(self):
        seen = []
        result = self.dispatch(lambda req, timeout: (seen.append((req, timeout)) or Response()))
        payload = json.loads(seen[0][0].data)
        self.assertEqual(payload["action_id"], "tool:refresh-evidence")
        self.assertEqual(result["rollback_action_id"], "tool:rollback-frank")

    def test_rejects_disabled_unknown_target_missing_attestation_and_bad_enum(self):
        with self.assertRaises(DispatchError): HermesDispatcher(self.path).dispatch(action_id="x", target_id="project:frank", arguments=self.args, attestation="x")
        with self.assertRaises(DispatchError): HermesDispatcher(self.path).dispatch(action_id="tool:refresh-evidence", target_id="project:blockwise", arguments=self.args, attestation="x")
        with self.assertRaises(DispatchError): HermesDispatcher(self.path).dispatch(action_id="tool:refresh-evidence", target_id="project:frank", arguments={**self.args, "mode":"nope"}, attestation="x")
        with self.assertRaises(DispatchError): HermesDispatcher(self.path).dispatch(action_id="tool:refresh-evidence", target_id="project:frank", arguments=self.args, attestation="")

    def test_body_and_response_bounds_and_unavailable_are_preview_errors(self):
        with self.assertRaises(DispatchError): self.dispatch(lambda req, timeout: Response(b"x" * (128*1024+1)))
        huge = {"mode":"fast", "idempotency_key":"abcdefgh", "x":"y"*(128*1024)}
        with self.assertRaises(DispatchError): HermesDispatcher(self.path).dispatch(action_id="tool:refresh-evidence", target_id="project:frank", arguments=huge, attestation="x")
        with self.assertRaisesRegex(DispatchError, "unavailable"): self.dispatch(lambda req, timeout: (_ for _ in ()).throw(OSError()))

    def test_origin_rejects_bad_scheme_and_redirect_ssrf(self):
        with patch.dict(os.environ, {"HERMES_ENDPOINT":"file:///etc/passwd"}):
            with self.assertRaises(DispatchError): self.dispatch()
        with self.assertRaisesRegex(DispatchError, "redirect"):
            self.dispatch(lambda req, timeout: Response(url="https://attacker.example/v1/control/actions"))


if __name__ == "__main__": unittest.main()
