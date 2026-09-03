import io
import json
import unittest
import urllib.error
from datetime import datetime
from zoneinfo import ZoneInfo

import work_cron


def http_response(payload, status=200):
    body = json.dumps(payload).encode("utf-8")
    if status >= 400:
        raise urllib.error.HTTPError("url", status, "err", {}, io.BytesIO(body))
    return io.BytesIO(body)


class FakeOpener:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, request, timeout=None):
        self.calls.append({"method": request.method, "url": request.full_url,
                           "headers": dict(request.header_items())})
        outcome = self.responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return http_response(outcome)


TOKEN = {"token": "test-token"}


def make_client(responses):
    opener = FakeOpener(responses)
    client = work_cron.CronClient(
        "http://hermes.test", lambda: TOKEN["token"], opener=opener)
    return client, opener


class ScheduleValidationTest(unittest.TestCase):
    def test_valid_cron(self):
        parsed = work_cron.validate_schedule("0 9 * * 1-5")
        self.assertEqual(parsed["kind"], "cron")
        self.assertEqual(parsed["expr"], "0 9 * * 1-5")

    def test_invalid_cron_rejected(self):
        for bad in ("* * * *", "61 * * * *", "0 25 * * *", "* * * FOO *", "a b c d e f g"):
            with self.assertRaises(ValueError, msg=bad):
                work_cron.validate_schedule(bad)

    def test_interval_bounds(self):
        self.assertEqual(work_cron.validate_schedule("every 15m")["kind"], "interval")
        with self.assertRaises(ValueError):
            work_cron.validate_schedule("every 1m")
        with self.assertRaises(ValueError):
            work_cron.validate_schedule("every 20000m")

    def test_natural_language_rejected(self):
        for phrase in ("daily", "weekdays at 9", "every weekday morning", "once a week"):
            with self.assertRaises(ValueError, msg=phrase):
                work_cron.validate_schedule(phrase)

    def test_once_requires_future_and_offset(self):
        with self.assertRaises(ValueError):
            work_cron.validate_schedule("2099-12-31T00:00:00")
        past = "2001-01-01T00:00:00+00:00"
        with self.assertRaises(ValueError):
            work_cron.validate_schedule(past)
        parsed = work_cron.validate_schedule("2099-12-31T00:00:00+00:00")
        self.assertEqual(parsed["kind"], "once")

    def test_inert_schedule_is_valid_and_far_future(self):
        parsed = work_cron.validate_schedule(work_cron.INERT_SCHEDULE)
        self.assertEqual(parsed["kind"], "once")
        self.assertTrue(parsed["run_at"].startswith("2099"))

    def test_next_executions_preview(self):
        upcoming = work_cron.next_executions("every 15m", count=2, tz=ZoneInfo("UTC"))
        self.assertEqual(len(upcoming), 2)
        first, second = upcoming
        self.assertEqual(second["epoch"] - first["epoch"], 900)

    def test_cron_next_executions_specific_fields(self):
        upcoming = work_cron.next_executions("0 9 * * 1", count=3, tz=ZoneInfo("UTC"))
        moments = [datetime.fromtimestamp(item["epoch"], tz=ZoneInfo("UTC")) for item in upcoming]
        self.assertTrue(all(moment.weekday() == 0 for moment in moments))
        self.assertTrue(all(moment.hour == 9 and moment.minute == 0 for moment in moments))


class CronClientTest(unittest.TestCase):
    def test_headers_carry_session_token(self):
        client, opener = make_client([{"jobs": []}])
        client.list_jobs()
        headers = {k.lower(): v for k, v in opener.calls[0]["headers"].items()}
        self.assertEqual(headers.get("x-hermes-session-token"), "test-token")
        self.assertTrue(opener.calls[0]["url"].startswith("http://hermes.test/api/cron/jobs"))

    def test_unreachable_fails_closed(self):
        client, opener = make_client([urllib.error.URLError("down")])
        with self.assertRaises(work_cron.CronClientUnavailable):
            client.list_jobs()

    def test_http_error_maps_status(self):
        client, opener = make_client([urllib.error.HTTPError("u", 404, "nf", {}, io.BytesIO(b"{}"))])
        with self.assertRaises(work_cron.CronClientError) as caught:
            client.get_job("abc")
        self.assertEqual(caught.exception.status, 404)

    def test_create_and_update_shapes(self):
        client, opener = make_client([{"id": "j1"}, {"ok": True}])
        client.create_job({"name": "n", "schedule": work_cron.INERT_SCHEDULE})
        client.update_job("j1", {"schedule": "0 9 * * 1-5"})
        self.assertEqual(opener.calls[0]["method"], "POST")
        self.assertEqual(opener.calls[1]["method"], "PUT")
        self.assertIn("/api/cron/jobs/j1", opener.calls[1]["url"])

    def test_pause_resume_trigger_routes(self):
        client, opener = make_client([{}, {}, {}])
        client.pause_job("j1")
        client.resume_job("j1")
        client.trigger_job("j1")
        self.assertTrue(opener.calls[0]["url"].endswith("/api/cron/jobs/j1/pause"))
        self.assertTrue(opener.calls[1]["url"].endswith("/api/cron/jobs/j1/resume"))
        self.assertTrue(opener.calls[2]["url"].endswith("/api/cron/jobs/j1/trigger"))

    def test_gateway_health_requires_running(self):
        client, opener = make_client([{"gateway_running": True, "gateway_state": "running"}])
        self.assertTrue(client.gateway_health()["ok"])
        client2, opener2 = make_client([{"gateway_running": False, "gateway_state": "stopped"}])
        self.assertFalse(client2.gateway_health()["ok"])

    def test_gateway_health_unreachable_is_false(self):
        client, opener = make_client([urllib.error.URLError("down")])
        self.assertFalse(client.gateway_health()["ok"])

    def test_inert_constants(self):
        self.assertEqual(work_cron.INERT_DELIVERY, "local")


if __name__ == "__main__":
    unittest.main()
