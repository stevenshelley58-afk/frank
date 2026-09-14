"""Focused tests for the owner workspace read projections.

These tests prove the **rules**, not the deployment:

* a metric is defined by the source's own native rule (Helpdesk status category
  plus assignment; CRM source creation time), so a ticket assigned to another
  agent and a lead mirrored late are both excluded;
* a source that cannot be read produces no value at all, so it can never be
  drawn as a real zero, and it cannot damage another widget;
* a cached reading keeps its original observation time and is labelled stale
  instead of being silently re-dated;
* no credential, message body or unrelated customer record reaches a payload.

The live-service proof is recorded separately in the evidence file; these tests
inject a transport, which proves the query shape and the honesty rules rather
than the integration.
"""

from __future__ import annotations

import io
import json
import os
import stat
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

import home_providers
import owner_projections as op
import owner_workspace as ow


# --------------------------------------------------------------------------- #
# Fakes
# --------------------------------------------------------------------------- #


@contextmanager
def _response(payload: bytes, status: int = 200):
    stream = io.BytesIO(payload)

    class _Reply:
        def __init__(self) -> None:
            self.status = status

        def read(self, size: int = -1) -> bytes:
            return stream.read(size)

        def getcode(self) -> int:
            return status

    yield _Reply()


class FakeTransport:
    """A bounded transport that replays canned Frappe payloads and records requests.

    A route value may be a payload, an exception to raise, or a callable taking the
    request URL so a test can answer the same path differently per query.
    """

    def __init__(self, routes: dict[str, object]) -> None:
        self.routes = routes
        self.requests: list[str] = []

    def open(self, request, *, limit: int = op.MAX_RESPONSE_BYTES) -> bytes:
        url = request.full_url
        self.requests.append(url)
        if url.endswith("/api/method/login"):
            return b'{"message":"Logged In"}'
        for needle, payload in self.routes.items():
            if needle in url:
                if callable(payload):
                    payload = payload(url)
                if isinstance(payload, Exception):
                    raise payload
                body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                if len(body) > limit:
                    raise op.OwnerSourceUnavailable("source response exceeded the read bound")
                return body
        raise op.OwnerSourceUnavailable(f"no canned route for {url}")

    @staticmethod
    def json(raw: bytes):
        return json.loads(raw.decode("utf-8") or "null")

    def query(self, needle: str) -> str:
        for url in self.requests:
            if needle in url:
                return url
        raise AssertionError(f"no request contained {needle}: {self.requests}")

    def count_queries(self, needle: str) -> list[str]:
        return [url for url in self.requests if needle in url]


def frappe_client(routes: dict[str, object]) -> tuple[op.FrappeReadClient, FakeTransport]:
    transport = FakeTransport(routes)
    client = op.FrappeReadClient(
        endpoint="http://127.0.0.1:18081",
        site="owner.crm.internal",
        credentials=lambda: ("owner@blockwise.sale", "not-a-real-password"),
        transport=transport,
    )
    return client, transport


def ticket(name: str, *, assign: str | None, status: str = "Open", category: str = "Open") -> dict:
    return {
        "name": name,
        "subject": f"Subject {name}",
        "status": status,
        "status_category": category,
        "_assign": assign,
        "creation": "2026-09-12 21:46:18.513658",
        "opening_date": "2026-09-12",
    }


def lead(name: str, *, created: str, status: str = "New") -> dict:
    return {"name": name, "creation": created, "status": status, "lead_name": f"Lead {name}"}


class ProjectionTestCase(unittest.TestCase):
    def setUp(self) -> None:
        op._reset_caches()
        self.addCleanup(op._reset_caches)
        self._env = mock.patch.dict(os.environ, {}, clear=False)
        self._env.start()
        self.addCleanup(self._env.stop)


# --------------------------------------------------------------------------- #
# Reachability allowlist
# --------------------------------------------------------------------------- #


class PrivateEndpointAllowlist(unittest.TestCase):
    def test_loopback_and_private_and_service_names_are_accepted(self):
        for value in (
            "http://127.0.0.1:18081",
            "https://127.0.0.1",
            "http://10.0.0.5:8080",
            "http://172.16.1.9:18081",
            "http://192.168.1.4",
            "http://localhost:18104",
            "http://owner-crm-frontend-1:8080",
        ):
            self.assertEqual(op._private_endpoint(value, source="x"), value.rstrip("/"))

    def test_public_hosts_paths_and_embedded_credentials_are_refused(self):
        for value in (
            "http://example.com",
            "https://crm.blockwise.sale",
            "http://8.8.8.8:18081",
            "http://user:pw@127.0.0.1:18081",
            "http://127.0.0.1:18081/api/resource/HD%20Ticket",
            "http://127.0.0.1:18081/?x=1",
            "ftp://127.0.0.1",
            "file:///etc/passwd",
        ):
            with self.assertRaises(op.OwnerSourceUnavailable, msg=value):
                op._private_endpoint(value, source="x")


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #


class SecretFiles(unittest.TestCase):
    def _secret(self, contents: str, mode: int = 0o600) -> Path:
        handle = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        handle.write(contents)
        handle.close()
        path = Path(handle.name)
        os.chmod(path, mode)
        self.addCleanup(path.unlink)
        return path

    def test_a_proper_secret_file_yields_the_named_keys(self):
        path = self._secret("OWNER_CRM_USERNAME=owner@blockwise.sale\nOWNER_CRM_PASSWORD=abc123\n")
        self.assertEqual(
            op._read_secret_file(path, ("OWNER_CRM_USERNAME", "OWNER_CRM_PASSWORD"), source="s"),
            {"OWNER_CRM_USERNAME": "owner@blockwise.sale", "OWNER_CRM_PASSWORD": "abc123"},
        )

    def test_group_or_world_readable_secret_is_refused(self):
        path = self._secret("OWNER_CRM_USERNAME=a\nOWNER_CRM_PASSWORD=b\n", mode=0o644)
        with self.assertRaises(op.OwnerSourceUnavailable) as caught:
            op._read_secret_file(path, ("OWNER_CRM_PASSWORD",), source="s")
        self.assertIn("group or world readable", str(caught.exception))

    def test_a_missing_key_is_named_without_disclosing_a_value(self):
        path = self._secret("OWNER_CRM_USERNAME=owner@blockwise.sale\n")
        with self.assertRaises(op.OwnerSourceUnavailable) as caught:
            op._read_secret_file(path, ("OWNER_CRM_USERNAME", "OWNER_CRM_PASSWORD"), source="s")
        self.assertIn("OWNER_CRM_PASSWORD", str(caught.exception))
        self.assertNotIn("owner@blockwise.sale", str(caught.exception))

    def test_a_missing_file_is_reported_by_path(self):
        with self.assertRaises(op.OwnerSourceUnavailable) as caught:
            op._read_secret_file(Path("/nonexistent/owner.env"), ("A",), source="s")
        self.assertIn("/nonexistent/owner.env", str(caught.exception))

    def test_a_symlinked_secret_is_refused(self):
        target = self._secret("OWNER_CRM_PASSWORD=b\n")
        link = target.with_suffix(".link")
        os.symlink(target, link)
        self.addCleanup(link.unlink)
        with self.assertRaises(op.OwnerSourceUnavailable):
            op._read_secret_file(link, ("OWNER_CRM_PASSWORD",), source="s")

    def test_the_owner_identity_must_match_the_configured_account(self):
        path = self._secret("OWNER_CRM_USERNAME=someone-else@blockwise.sale\nOWNER_CRM_PASSWORD=b\n")
        with self.assertRaises(op.OwnerSourceUnavailable) as caught:
            op.crm_credentials(path=path)
        self.assertIn("different identity", str(caught.exception))

    def test_an_owner_account_that_would_widen_the_like_filter_is_refused(self):
        for value in ("owner_name@blockwise.sale", "owner%@blockwise.sale", "owner name", "a/b"):
            with mock.patch.dict(os.environ, {op.CRM_OWNER_USER_ENV: value}):
                with self.assertRaises(op.OwnerSourceUnavailable):
                    op.crm_owner_user()

    def test_the_password_never_appears_in_a_snapshot(self):
        secret = "s3cr3t-value-that-must-not-leak"
        path = self._secret(
            "OWNER_CRM_USERNAME=owner@blockwise.sale\nOWNER_CRM_PASSWORD=" + secret + "\n"
        )
        client, _ = frappe_client(
            {
                "frappe.client.get_count": {"message": 1},
                "HD%20Ticket": {"data": [ticket("0001", assign=None)]},
            }
        )
        with mock.patch.object(op, "crm_credentials", lambda **_: ("owner@blockwise.sale", secret)):
            snapshot = op.support_snapshot(now=1000)
        self.assertNotIn(secret, json.dumps(snapshot))
        self.assertNotIn(secret, json.dumps(client.__dict__, default=str))


# --------------------------------------------------------------------------- #
# Helpdesk: native status category plus assignment rule
# --------------------------------------------------------------------------- #


class HelpdeskAwaitingOwner(ProjectionTestCase):
    def _routes(self, *, tickets: list[dict], total: int, open_total: int) -> dict[str, object]:
        return {
            "HD%20Ticket?": {"data": tickets},
            "frappe.client.get_count": {"message": total},
        }

    def test_the_query_uses_the_native_status_category_and_assignment_rule(self):
        client, transport = frappe_client(
            {
                "HD%20Ticket?": {
                    "data": [ticket("0002", assign=None), ticket("0003", assign='["owner@blockwise.sale"]')]
                },
                # The awaiting-owner count carries or_filters; the open-category
                # total does not, so the fake answers them differently.
                "frappe.client.get_count": lambda url: {"message": 2 if "or_filters" in url else 3},
            }
        )
        op._reset_caches(client)
        model = op._load_helpdesk_model(owner_user="owner@blockwise.sale")
        listing = transport.query("HD%20Ticket?")
        self.assertIn("status_category", listing)
        self.assertIn("Open", listing)
        self.assertIn("docstatus", listing)
        self.assertIn("is_merged", listing)
        self.assertIn("or_filters", listing)
        self.assertIn("not+set", listing)
        self.assertIn("owner%40blockwise.sale", listing)
        self.assertNotIn("Paused", listing)
        self.assertEqual(model["total"], 2)
        self.assertEqual(model["open_category_total"], 3)
        self.assertEqual([row["id"] for row in model["tickets"]], ["0002", "0003"])

    def test_a_ticket_owned_by_another_agent_is_not_awaiting_the_owner(self):
        rows = [
            ticket("0001", assign='["Administrator"]'),
            ticket("0002", assign=None),
            ticket("0003", assign='["owner@blockwise.sale"]'),
        ]
        client, _ = frappe_client(
            {
                "HD%20Ticket?": {"data": rows},
                "frappe.client.get_count": lambda url: {"message": 2 if "or_filters" in url else 3},
            }
        )
        op._reset_caches(client)
        readings = op.support_snapshot(now=1000)["data"]["readings"]
        self.assertEqual(readings["tickets_awaiting_owner"]["status"], "attention")
        self.assertEqual(readings["tickets_awaiting_owner"]["value"], 2)
        # The excluded ticket is the one explicitly owned by another agent.
        self.assertIn("1 is explicitly assigned to another agent", readings["tickets_awaiting_owner"]["detail"])
        items = readings["tickets_awaiting_owner_items"]["value"]
        self.assertNotIn("frappe_helpdesk:0001", [item["id"] for item in items])

    def test_other_agents_work_is_reported_as_excluded_rather_than_counted(self):
        client, _ = frappe_client(
            {
                "HD%20Ticket?": {
                    "data": [ticket("0002", assign=None), ticket("0003", assign='["owner@blockwise.sale"]')]
                },
                "frappe.client.get_count": lambda url: {"message": 2 if "or_filters" in url else 5},
            }
        )
        op._reset_caches(client)
        detail = op.support_snapshot(now=1000)["data"]["readings"]["tickets_awaiting_owner"]["detail"]
        self.assertIn("2 of 5", detail)
        self.assertIn("3 are explicitly assigned to another agent", detail)
        self.assertIn("Paused", detail)

    def test_a_full_page_falls_back_to_the_source_count(self):
        rows = [ticket(f"{index:04d}", assign=None) for index in range(op.MAX_LIST_BOUND)]
        client, transport = frappe_client(
            {"HD%20Ticket?": {"data": rows}, "frappe.client.get_count": {"message": 900}}
        )
        op._reset_caches(client)
        model = op._load_helpdesk_model(owner_user="owner@blockwise.sale")
        self.assertTrue(model["truncated"])
        self.assertEqual(model["total"], 900)
        self.assertTrue(any("frappe.client.get_count" in url for url in transport.requests))

    def test_an_unreadable_helpdesk_returns_no_value_and_no_metric(self):
        client, _ = frappe_client({"HD%20Ticket?": op.OwnerSourceUnavailable("Helpdesk is unreachable")})
        op._reset_caches(client)
        snapshot = op.support_snapshot(now=1000)
        reading = snapshot["data"]["readings"]["tickets_awaiting_owner"]
        self.assertEqual(reading["status"], "unavailable")
        self.assertIsNone(reading["value"])
        self.assertIn("unreachable", reading["detail"])
        self.assertNotIn("metrics", snapshot["data"])
        self.assertEqual(snapshot["status"], "unavailable")

    def test_items_carry_a_stable_id_a_source_time_and_a_typed_internal_link(self):
        client, _ = frappe_client(
            {
                "HD%20Ticket?": {"data": [ticket("0002", assign=None)]},
                "frappe.client.get_count": {"message": 1},
            }
        )
        op._reset_caches(client)
        snapshot = op.support_snapshot(now=1000)
        items = snapshot["data"]["readings"]["tickets_awaiting_owner_items"]["value"]
        self.assertTrue(items)
        for item in items:
            self.assertEqual(item["source"], op.SOURCE_HELPDESK)
            self.assertTrue(item["id"].startswith(op.SOURCE_HELPDESK + ":"))
            self.assertEqual(item["observed_at"], snapshot["data"][ow.OBSERVED_AT])
            self.assertEqual(item["link"]["kind"], "internal")
            self.assertEqual(item["link"]["path"], "/project/blockwise/support")
            self.assertNotIn("://", json.dumps(item["link"]))


# --------------------------------------------------------------------------- #
# CRM: creation time and stable ID, never mirror time
# --------------------------------------------------------------------------- #


class CrmNewLeads(ProjectionTestCase):
    def test_the_query_uses_the_native_creation_timespan_not_a_mirror_key(self):
        client, transport = frappe_client(
            {
                "CRM%20Lead?": {"data": [lead("CRM-LEAD-2026-00015", created="2026-09-13 19:29:31")]},
                "CRM%20Lead%20Status": {"data": [{"name": "New", "type": "Open"}]},
                "frappe.client.get_count": {"message": 1},
            }
        )
        op._reset_caches(client)
        op.crm_snapshot(now=1000)
        listing = transport.query("CRM%20Lead?")
        self.assertIn("timespan", listing)
        self.assertIn("last+7+days", listing)
        self.assertIn("creation", listing)
        self.assertNotIn("modified", listing)
        self.assertNotIn("custom_blockwise_source_key", listing)

    def test_a_lead_whose_creation_is_outside_the_window_is_not_counted(self):
        # The source decides the window; a record the source did not return can
        # never be counted, however recently it was mirrored or modified.
        client, _ = frappe_client(
            {
                "CRM%20Lead?": {"data": [lead("CRM-LEAD-2026-00001", created="2026-09-13 08:23:51")]},
                "CRM%20Lead%20Status": {"data": [{"name": "New", "type": "Open"}]},
                "frappe.client.get_count": {"message": 1},
            }
        )
        op._reset_caches(client)
        reading = op.crm_snapshot(now=1000)["data"]["readings"]["crm_new_leads"]
        self.assertEqual(reading["value"], 1)
        self.assertEqual(reading["source_ids"], ["frappe_crm:CRM-LEAD-2026-00001"])

    def test_awaiting_first_contact_is_derived_from_the_native_status_type(self):
        client, transport = frappe_client(
            {
                "CRM%20Lead?": {"data": []},
                "CRM%20Lead%20Status": {
                    "data": [
                        {"name": "New", "type": "Open"},
                        {"name": "Contacted", "type": "Ongoing"},
                        {"name": "Junk", "type": "Lost"},
                    ]
                },
                "frappe.client.get_count": {"message": 7},
            }
        )
        op._reset_caches(client)
        snapshot = op.crm_snapshot(now=1000)
        reading = snapshot["data"]["readings"]["crm_leads_awaiting_first_contact"]
        self.assertEqual(reading["value"], 7)
        self.assertIn("New", reading["detail"])
        self.assertNotIn("Contacted", reading["detail"])
        counts = [url for url in transport.requests if "frappe.client.get_count" in url]
        self.assertTrue(counts)
        self.assertIn("New", counts[0])

    def test_a_status_lookup_failure_degrades_one_number_not_the_card(self):
        client, _ = frappe_client(
            {
                "CRM%20Lead?": {"data": [lead("CRM-LEAD-2026-00001", created="2026-09-13 08:23:51")]},
                "CRM%20Lead%20Status": op.OwnerSourceUnavailable("status taxonomy unavailable"),
            }
        )
        op._reset_caches(client)
        snapshot = op.crm_snapshot(now=1000)
        readings = snapshot["data"]["readings"]
        self.assertEqual(readings["crm_new_leads"]["value"], 1)
        self.assertEqual(readings["crm_leads_awaiting_first_contact"]["status"], "unavailable")
        self.assertEqual(snapshot["status"], "stale")

    def test_no_contact_details_or_notes_are_carried(self):
        client, _ = frappe_client(
            {
                "CRM%20Lead?": {
                    "data": [
                        {
                            "name": "CRM-LEAD-2026-00015",
                            "creation": "2026-09-13 19:29:31",
                            "status": "New",
                            "lead_name": "Controlled",
                            "email": "person@example.com",
                            "mobile_no": "+61 400 000 000",
                            "organization": "Example Pty Ltd",
                        }
                    ]
                },
                "CRM%20Lead%20Status": {"data": [{"name": "New", "type": "Open"}]},
                "frappe.client.get_count": {"message": 1},
            }
        )
        op._reset_caches(client)
        payload = json.dumps(op.crm_snapshot(now=1000))
        self.assertNotIn("person@example.com", payload)
        self.assertNotIn("400 000 000", payload)
        self.assertNotIn("Example Pty Ltd", payload)


# --------------------------------------------------------------------------- #
# Cache: TTL, single-flight, backoff, stale
# --------------------------------------------------------------------------- #


class ProjectionCacheBehaviour(unittest.TestCase):
    def _cache(self, now: list[float]):
        return op.ProjectionCache(
            ttl_seconds=lambda: 60.0,
            clock=lambda: now[0],
            wall_clock=lambda: now[0],
            backoff_base=30.0,
            backoff_cap=600.0,
        )

    def test_a_fresh_entry_does_not_touch_the_source(self):
        now = [1000.0]
        cache = self._cache(now)
        calls = []

        def loader():
            calls.append(1)
            return {"value": len(calls)}

        first = cache.read("k", loader)
        second = cache.read("k", loader)
        self.assertEqual(len(calls), 1)
        self.assertEqual(first, second)
        self.assertFalse(first[2])

    def test_a_stale_ttl_refreshes_and_advances_the_observation_time(self):
        now = [1000.0]
        cache = self._cache(now)
        cache.read("k", lambda: {"value": 1})
        now[0] += 61
        model, observed_at, stale = cache.read("k", lambda: {"value": 2})
        self.assertEqual(model["value"], 2)
        self.assertEqual(observed_at, 1061)
        self.assertFalse(stale)

    def test_a_failure_after_a_good_read_serves_the_old_value_marked_stale(self):
        now = [1000.0]
        cache = self._cache(now)
        cache.read("k", lambda: {"value": 1})

        def failing():
            raise RuntimeError("provider refused")

        now[0] += 61
        model, observed_at, stale = cache.read("k", failing)
        self.assertEqual(model["value"], 1)
        self.assertEqual(observed_at, 1000)  # the original observation time survives
        self.assertTrue(stale)
        self.assertIn("provider refused", cache.last_error)

    def test_backoff_stops_an_immediate_retry(self):
        now = [1000.0]
        cache = self._cache(now)
        cache.read("k", lambda: {"value": 1})
        attempts = []

        def failing():
            attempts.append(1)
            raise RuntimeError("down")

        now[0] += 61
        cache.read("k", failing)
        now[0] += 5  # inside the 30s backoff
        model, _, stale = cache.read("k", failing)
        self.assertEqual(len(attempts), 1)
        self.assertTrue(stale)
        self.assertEqual(model["value"], 1)
        now[0] += 26  # past the backoff
        cache.read("k", failing)
        self.assertEqual(len(attempts), 2)

    def test_a_first_ever_failure_is_reported_rather_than_invented(self):
        cache = self._cache([1000.0])
        with self.assertRaises(RuntimeError):
            cache.read("k", lambda: (_ for _ in ()).throw(RuntimeError("never read")))

    def test_keys_do_not_evict_each_other(self):
        now = [1000.0]
        cache = self._cache(now)
        calls = []

        def loader(name):
            def inner():
                calls.append(name)
                return {"name": name}

            return inner

        cache.read("a", loader("a"))
        cache.read("b", loader("b"))
        cache.read("a", loader("a"))
        cache.read("b", loader("b"))
        self.assertEqual(calls, ["a", "b"])


# --------------------------------------------------------------------------- #
# Source isolation and the merged owner queue
# --------------------------------------------------------------------------- #


class SourceIsolation(ProjectionTestCase):
    def test_one_dead_source_does_not_blank_another_widget(self):
        client, _ = frappe_client({"HD%20Ticket?": op.OwnerSourceUnavailable("helpdesk down")})
        op._reset_caches(client)
        support = op.support_snapshot(now=1000)
        self.assertEqual(support["status"], "unavailable")
        # The CRM widget is a separate provider over a separate cache; a dead
        # Helpdesk cannot touch it.
        op._reset_caches(
            frappe_client(
                {
                    "CRM%20Lead?": {"data": [lead("CRM-LEAD-2026-00001", created="2026-09-13 08:23:51")]},
                    "CRM%20Lead%20Status": {"data": [{"name": "New", "type": "Open"}]},
                    "frappe.client.get_count": {"message": 1},
                }
            )[0]
        )
        crm = op.crm_snapshot(now=1000)
        self.assertEqual(crm["data"]["readings"]["crm_new_leads"]["value"], 1)

    def test_the_merged_queue_keeps_the_working_source_when_the_other_fails(self):
        client, _ = frappe_client(
            {
                "HD%20Ticket?": op.OwnerSourceUnavailable("helpdesk down"),
                "CRM%20Lead?": {"data": [lead("CRM-LEAD-2026-00001", created="2026-09-13 08:23:51")]},
                "CRM%20Lead%20Status": {"data": [{"name": "New", "type": "Open"}]},
                "frappe.client.get_count": {"message": 1},
            }
        )
        op._reset_caches(client)
        snapshot = op.attention_snapshot(now=1000)
        ids = [item["id"] for item in snapshot["data"]["readings"]["owner_attention"]["value"]]
        self.assertTrue(any(item.startswith("frappe_crm:") for item in ids))
        self.assertFalse(any(item.startswith("frappe_helpdesk:") for item in ids))
        self.assertEqual(snapshot["data"]["readings"]["unavailable_frappe_helpdesk"]["status"], "unavailable")

    def test_a_provider_that_raises_is_quarantined_by_the_shared_renderer(self):
        class _Ctx:
            now = 1000

        with mock.patch.object(op, "support_snapshot", side_effect=RuntimeError("boom")):
            rendered = home_providers.render("owner-support", _Ctx())  # type: ignore[arg-type]
        self.assertEqual(rendered["status"], "error")
        self.assertIn("still available", rendered["summary"])


# --------------------------------------------------------------------------- #
# ntfy
# --------------------------------------------------------------------------- #


class NotificationActivity(ProjectionTestCase):
    def _transport(self, lines: list[str]) -> FakeTransport:
        payload = ("\n".join(lines) + "\n").encode()
        return FakeTransport({"/v1/health": b'{"healthy":true}', "/json?": payload})

    def test_only_time_and_title_are_read_from_a_notification(self):
        transport = self._transport(
            [
                json.dumps(
                    {
                        "id": "m1",
                        "event": "message",
                        "time": 1789277418,
                        "topic": "owner-notifications",
                        "title": "Owner CRM lead created",
                        "message": "A secret customer sentence that must not be carried.",
                    }
                )
            ]
        )
        with mock.patch.object(op, "_ntfy_transport", lambda: transport):
            model = op._load_ntfy_model(topic="owner-notifications", window="24h", password="pw")
        self.assertEqual(model["notifications"], [{"id": "m1", "time": 1789277418, "title": "Owner CRM lead created"}])
        self.assertNotIn("secret customer sentence", json.dumps(model))

    def test_more_notifications_than_the_bound_refuses_a_partial_count(self):
        lines = [
            json.dumps({"id": f"m{i}", "event": "message", "time": 1789277418 + i, "title": "t"})
            for i in range(op.MAX_NTFY_NOTIFICATIONS + 2)
        ]
        with mock.patch.object(op, "_ntfy_transport", lambda: self._transport(lines)):
            with self.assertRaises(op.OwnerSourceUnavailable) as caught:
                op._load_ntfy_model(topic="owner-notifications", window="24h", password="pw")
        self.assertIn("partial count", str(caught.exception))

    def test_an_unhealthy_server_is_reported(self):
        transport = FakeTransport({"/v1/health": b'{"healthy":false}'})
        with mock.patch.object(op, "_ntfy_transport", lambda: transport):
            with self.assertRaises(op.OwnerSourceUnavailable):
                op._load_ntfy_model(topic="owner-notifications", window="24h", password="pw")

    def test_the_detail_never_claims_delivery(self):
        transport = self._transport(
            [json.dumps({"id": "m1", "event": "message", "time": 1789277418, "title": "t"})]
        )
        with mock.patch.object(op, "_ntfy_transport", lambda: transport), mock.patch.object(
            op, "ntfy_credentials", lambda **_: "pw"
        ):
            op._reset_caches()
            detail = op.notifications_snapshot(now=1000)["data"]["readings"]["notification_activity"]["detail"]
        self.assertIn("not proof", detail)
        self.assertIn("no message body is read", detail)


# --------------------------------------------------------------------------- #
# Registration and catalogue
# --------------------------------------------------------------------------- #


class Registration(unittest.TestCase):
    def test_every_owner_widget_has_a_registered_provider(self):
        for manifest in op.OWNER_WIDGET_MANIFESTS:
            self.assertIn(manifest["id"], home_providers.PROVIDERS, manifest["id"])

    def test_every_owner_widget_is_scoped_to_the_owner_project(self):
        for manifest in op.OWNER_WIDGET_MANIFESTS:
            self.assertEqual(manifest["surfaces"], ["project"])
            self.assertEqual(manifest["entity_scope"], {"kind": "project", "id": ow.OWNER_PROJECT_ID})
            self.assertFalse(manifest["accepts_connection"])
            self.assertEqual(manifest["provider"], "frank.owner")

    def test_no_manifest_id_collides_with_an_existing_widget(self):
        import home_platform

        existing = {item["id"] for item in home_platform.BUILTIN_WIDGETS}
        mine = {item["id"] for item in op.OWNER_WIDGET_MANIFESTS}
        self.assertEqual(existing & mine, set())


class StandardView(unittest.TestCase):
    def test_an_unavailable_reading_contributes_no_metric(self):
        snapshot = ow.owner_snapshot(
            summary="x",
            readings={"a": ow.unconfigured("s")},
            now=1000,
        )
        op._attach_standard_view(snapshot, metrics=[("a", "A", "")], row_reading="b")
        self.assertNotIn("metrics", snapshot["data"])
        self.assertNotIn("rows", snapshot["data"])

    def test_a_real_zero_is_published_as_a_real_zero(self):
        snapshot = ow.owner_snapshot(
            summary="x",
            readings={"a": ow.reading(status="empty", value=0, source="s")},
            now=1000,
        )
        op._attach_standard_view(snapshot, metrics=[("a", "A", "")], row_reading="b")
        self.assertEqual(snapshot["data"]["metrics"], [{"label": "A", "value": 0, "unit": ""}])

    def test_rows_come_only_from_a_list_valued_reading(self):
        items = [ow.attention_item(item_id="i1", label="One", source="s", detail="d")]
        snapshot = ow.owner_snapshot(
            summary="x",
            readings={"b": ow.reading(status="attention", value=items, source="s")},
            now=1000,
        )
        op._attach_standard_view(snapshot, metrics=[], row_reading="b")
        self.assertEqual(snapshot["data"]["rows"], [{"name": "One", "detail": "d", "id": "i1"}])

    def test_a_row_keeps_the_source_own_stable_identifier(self):
        # The rendered row must carry the source's own id. A positional id would
        # change as new records arrive, so it could not deduplicate or recognise
        # the same record across two refreshes.
        items = [
            ow.attention_item(item_id="ntfy:abc123", label="One", source="s", detail="d"),
            ow.attention_item(item_id="ntfy:def456", label="Two", source="s", detail="d"),
        ]
        snapshot = ow.owner_snapshot(
            summary="x",
            readings={"b": ow.reading(status="ready", value=items, source="s")},
            now=1000,
        )
        op._attach_standard_view(snapshot, metrics=[], row_reading="b")
        self.assertEqual([row["id"] for row in snapshot["data"]["rows"]], ["ntfy:abc123", "ntfy:def456"])

    def test_the_same_records_keep_the_same_ids_across_two_reads(self):
        # Two refreshes that see the same records must produce the same ids, and
        # a newer record arriving must not renumber the older ones.
        def build(labels):
            items = [
                ow.attention_item(item_id=f"ntfy:{name}", label=name, source="s", detail="d")
                for name in labels
            ]
            snapshot = ow.owner_snapshot(
                summary="x",
                readings={"b": ow.reading(status="ready", value=items, source="s")},
                now=1000,
            )
            op._attach_standard_view(snapshot, metrics=[], row_reading="b")
            return {row["name"]: row["id"] for row in snapshot["data"]["rows"]}

        first = build(["alpha", "bravo"])
        second = build(["alpha", "bravo", "charlie"])
        self.assertEqual(first["alpha"], second["alpha"])
        self.assertEqual(first["bravo"], second["bravo"])


if __name__ == "__main__":
    unittest.main()
