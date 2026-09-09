import tempfile
import unittest
from pathlib import Path

from hermes_adapter.http import RestError, RestSurface
from hermes_adapter.ledger import OperationLedger
from hermes_adapter.runs import RunsClient, RunsError, poll_delay


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def make_surface(handler, ledger=None):
    surface = RestSurface(
        "gateway",
        "http://127.0.0.1:18643",
        lambda: {"Authorization": "Bearer test"},
        urlopen=lambda request, timeout: _FakeResponse(handler(request)),
    )
    return surface


class _FakeResponse:
    def __init__(self, result):
        self.result = result

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    @property
    def status(self):
        return self.result[0]

    def read(self, limit):
        import json

        body = self.result[1]
        return b"" if body is None else json.dumps(body).encode()


class RunsClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger = OperationLedger(Path(self.tmp.name) / "ledger")
        self.clock = FakeClock()

    def tearDown(self):
        self.tmp.cleanup()

    def test_submit_happy_path_journals_idempotency_key(self):
        seen = {}

        def handler(request):
            seen["key"] = request.get_header("Idempotency-key")
            return (202, {"run_id": "run_1", "status": "started", "replayed": False})

        client = RunsClient(make_surface(handler), ledger=self.ledger, clock=self.clock)
        result = client.submit({"prompt": "hello"})
        self.assertEqual(result["run_id"], "run_1")
        self.assertTrue(len(seen["key"]) >= 32)
        outstanding = self.ledger.outstanding()
        self.assertEqual(outstanding, [])
        records = list(self.ledger._iter_records())
        self.assertEqual(records[-1]["state"], "acknowledged")
        self.assertEqual(records[-1]["result_refs"]["run_id"], "run_1")

    def test_409_conflict_means_already_accepted(self):
        def handler(request):
            return (409, {"error": "conflict"})

        client = RunsClient(make_surface(handler), ledger=self.ledger, clock=self.clock)
        with self.assertRaises(RunsError) as caught:
            client.submit({"prompt": "hello"})
        self.assertEqual(caught.exception.frank_code, "hermes.already_accepted")

    def test_timeout_becomes_uncertain_never_blind_retry(self):
        def handler(request):
            raise RestError("timeout", "exceeded")

        client = RunsClient(make_surface(handler), ledger=self.ledger, clock=self.clock)
        with self.assertRaises(RunsError):
            client.submit({"prompt": "hello"})
        outstanding = self.ledger.outstanding()
        self.assertEqual(len(outstanding), 1)
        self.assertEqual(outstanding[0]["state"], "uncertain")

    def test_client_error_4xx_resolves_failed(self):
        def handler(request):
            raise RestError("http_status", "bad request", status=400)

        client = RunsClient(make_surface(handler), ledger=self.ledger, clock=self.clock)
        with self.assertRaises(RunsError):
            client.submit({"prompt": "hello"})
        records = list(self.ledger._iter_records())
        self.assertEqual(records[-1]["state"], "resolved")
        self.assertEqual(records[-1]["resolved_outcome"], "failed")

    def test_poll_backoff_caps_at_60(self):
        self.assertEqual(poll_delay(0), 5)
        self.assertEqual(poll_delay(1), 10)
        self.assertEqual(poll_delay(2), 20)
        self.assertEqual(poll_delay(4), 60)
        self.assertEqual(poll_delay(10), 60)

    def test_poll_until_terminal_yields_snapshots(self):
        statuses = iter([
            (200, {"status": "started"}),
            (200, {"status": "started"}),
            (200, {"status": "completed", "last_event": "run.completed"}),
        ])

        def handler(request):
            return next(statuses)

        client = RunsClient(make_surface(handler), ledger=self.ledger, clock=self.clock)
        snapshots = list(client.poll_until_terminal("run_1", sleep=lambda s: None))
        self.assertEqual([snapshot["status"] for snapshot in snapshots], ["started", "started", "completed"])

    def test_approval_and_stop_are_single_exact_calls(self):
        calls = []

        def handler(request):
            calls.append(request.full_url)
            return (200, {"ok": True})

        client = RunsClient(make_surface(handler), ledger=self.ledger, clock=self.clock)
        client.approval("run_1", {"decision": "approve"})
        client.stop("run_1")
        self.assertTrue(calls[0].endswith("/v1/runs/run_1/approval"))
        self.assertTrue(calls[1].endswith("/v1/runs/run_1/stop"))

    def test_uncertain_recovery_uses_status_evidence(self):
        self.ledger.prepare("run.submit", "gateway", {"prompt": "x"}, refs={"idempotency_key": "k1"})
        op_id = self.ledger.outstanding()[0]["op_id"]
        self.ledger.mark_uncertain(op_id, "test")

        def handler(request):
            return (200, {"status": "completed"})

        client = RunsClient(make_surface(handler), ledger=self.ledger, clock=self.clock)
        client.recover_uncertain(op_id, "run_1")
        self.assertEqual(self.ledger.get(op_id)["state"], "resolved")


if __name__ == "__main__":
    unittest.main()
