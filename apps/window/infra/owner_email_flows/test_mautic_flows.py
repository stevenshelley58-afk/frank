#!/usr/bin/env python3
import importlib.util
import pathlib
import sys
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("flows", pathlib.Path(__file__).with_name("mautic_flows.py"))
flows = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = flows
spec.loader.exec_module(flows)


class FakeMautic:
    def __init__(self):
        self.store = {"fields": [], "lists": [], "emails": [], "campaigns": []}
        self.calls = []

    def collection(self, path, key):
        return list(self.store[key])

    def total(self, path):
        self.calls.append(("GET", path, None))
        return 0

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        create = {
            "fields/contact/new": ("fields", "field"),
            "segments/new": ("lists", "list"),
            "emails/new": ("emails", "email"),
            "campaigns/new": ("campaigns", "campaign"),
        }
        if path in create:
            store, response = create[path]
            item = dict(payload, id=len(self.store[store]) + 1)
            self.store[store].append(item)
            return {response: item}
        if path.startswith("emails/") and path.endswith("/edit"):
            item = next(item for item in self.store["emails"] if item["id"] == int(path.split("/")[1]))
            item.update(payload)
            return {"email": item}
        if path.startswith("campaigns/") and path.endswith("/edit"):
            item = next(item for item in self.store["campaigns"] if item["id"] == int(path.split("/")[1]))
            item.update(payload)
            return {"campaign": item}
        if path.startswith("campaigns/") and path.endswith("/delete"):
            self.store["campaigns"] = [item for item in self.store["campaigns"] if item["id"] != int(path.split("/")[1])]
            return {}
        raise AssertionError((method, path))


PROFILE_ID = "10000000-0000-4000-8000-000000000001"
WORKSPACE_ID = "20000000-0000-4000-8000-000000000001"
EVENT_ONE = "30000000-0000-4000-8000-000000000001"
EVENT_OLD = "30000000-0000-4000-8000-000000000002"
EVENT_NEW = "30000000-0000-4000-8000-000000000003"


def bridge_contact(profile_id=PROFILE_ID, workspace_id=WORKSPACE_ID, dnc=None, contact_id=1, email="owner@example.test"):
    return {
        "id": contact_id,
        "fields": {"all": {"blockwise_profile_id": profile_id, "blockwise_workspace_id": workspace_id, "email": email}},
        "doNotContact": [] if dnc is None else dnc,
    }


class FakeBridgeMautic:
    def __init__(self, contacts=None, fail_segment_once=False, create_response=None, total_as_string=False):
        self.contacts = list(contacts or [])
        self.fail_segment_once = fail_segment_once
        self.create_response = create_response
        self.total_as_string = total_as_string
        self.memberships = set()
        self.calls = []

    def collection(self, path, key):
        if key != "lists":
            raise AssertionError((path, key))
        return [{"id": index + 1, "name": flows.PREFIX + flow.title, "isPublished": True} for index, flow in enumerate(flows.FLOWS)]

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET" and path.startswith("contacts?"):
            # Deliberately emulate a bounded paginated exact-lookup result.
            from urllib.parse import parse_qs, urlparse
            query = parse_qs(urlparse(path).query)
            start, limit = int(query["start"][0]), int(query["limit"][0])
            search = query["search"][0]
            if search.startswith("blockwise_profile_id:"):
                matched = [contact for contact in self.contacts if contact["fields"]["all"].get("blockwise_profile_id") == search.removeprefix("blockwise_profile_id:")]
            elif search.startswith("email:"):
                matched = [contact for contact in self.contacts if contact["fields"]["all"].get("email", "").lower() == search.removeprefix("email:").lower()]
            else:
                raise AssertionError(search)
            page = matched[start:start + limit]
            total = str(len(matched)) if self.total_as_string else len(matched)
            return {"contacts": {str(contact["id"]): contact for contact in page}, "total": total}
        if method == "POST" and path == "contacts/new":
            contact = bridge_contact(contact_id=len(self.contacts) + 1)
            contact["fields"]["all"].update(payload)
            self.contacts.append(contact)
            return {"contact": self.create_response if self.create_response is not None else contact}
        if method == "POST" and path.startswith("segments/") and "/contact/" in path and path.endswith("/add"):
            if self.fail_segment_once:
                self.fail_segment_once = False
                raise flows.ApiError("segment membership was unavailable")
            segment_id = int(path.split("/")[1])
            contact_id = int(path.split("/")[3])
            self.memberships.add((contact_id, segment_id))
            return {"contact": next(contact for contact in self.contacts if contact["id"] == contact_id)}
        if method == "PATCH" and path.startswith("contacts/") and path.endswith("/edit"):
            contact = next(contact for contact in self.contacts if contact["id"] == int(path.split("/")[1]))
            contact["fields"]["all"].update(payload)
            return {"contact": contact}
        raise AssertionError((method, path))


def bridge_args(**overrides):
    values = {
        "flow": "opted_in_education",
        "source_event_id": EVENT_ONE,
        "profile_id": PROFILE_ID,
        "workspace_id": WORKSPACE_ID,
        "email": "owner@example.test",
        "consent_state": "opted_in",
        "apply": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FlowTests(unittest.TestCase):
    def test_setup_is_idempotent_and_campaigns_are_unpublished(self):
        api = FakeMautic()
        first = flows.setup(api, apply=True)
        calls = len(api.calls)
        second = flows.setup(api, apply=True)
        self.assertEqual(first, {"fields": 6, "segments": 8, "emails": 10, "campaigns": 8, "unpublished_campaigns": 8})
        self.assertEqual(first, second)
        self.assertEqual(calls, len(api.calls))
        self.assertTrue(all(email["emailType"] == "template" for email in api.store["emails"]))
        self.assertTrue(all(not campaign["isPublished"] for campaign in api.store["campaigns"]))

    def test_opt_in_education_is_the_only_documented_multi_step_cadence(self):
        education = next(flow for flow in flows.FLOWS if flow.key == "opted_in_education")
        self.assertEqual([step.delay_days for step in education.steps], [0, 2, 3])
        self.assertEqual(len(education.steps), 3)
        for flow in flows.FLOWS:
            if flow.key != "opted_in_education":
                self.assertEqual(len(flow.steps), 1)

    def test_campaigns_fail_closed_and_use_marketing_delivery(self):
        sample_emails = {flows.email_key(flow, index): index + 1 for flow in flows.FLOWS for index, _step in enumerate(flow.steps)}
        for flow in flows.FLOWS:
            events, _canvas = flows.campaign_events(flow, sample_emails)
            if flow.cold:
                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]["properties"]["field"], flows.COLD_RELEASE_FIELD)
                self.assertNotIn("email.send", [event["type"] for event in events])
                continue
            expected_events = len(flow.steps) * (5 if flow.key == "opted_in_education" else 3)
            self.assertEqual(len(events), expected_events)
            conditions = [event for event in events if event["type"] == "lead.field_value"]
            sends = [event for event in events if event["type"] == "email.send"]
            self.assertEqual(len(conditions), len(flow.steps) * 2)
            self.assertEqual(len(sends), len(flow.steps))
            for index, _step in enumerate(flow.steps):
                self.assertEqual(conditions[index * 2]["properties"]["field"], flows.CONSENT_FIELD)
                self.assertEqual(conditions[index * 2]["properties"]["value"], "opted_in")
                self.assertEqual(conditions[index * 2 + 1]["properties"]["field"], flows.NURTURE_EXIT_FIELD)
                self.assertEqual(conditions[index * 2 + 1]["properties"]["value"], "active")
                self.assertEqual(sends[index]["properties"]["email_type"], "marketing")

    def test_campaign_reconciliation_detects_unsafe_same_count_drift(self):
        flow = next(flow for flow in flows.FLOWS if flow.key == "cold_local_audit")
        emails = {flows.email_key(candidate, index): index + 1 for candidate in flows.FLOWS for index, _step in enumerate(candidate.steps)}
        desired = flows.campaign_payload(flow, 1, emails)
        legacy = dict(desired, events=[{"type": "email.send", "order": 1, "properties": {"email": 1, "email_type": "transactional"}, "triggerInterval": 0}])
        self.assertTrue(flows.campaign_needs_update(legacy, desired))

    def test_campaign_reconciliation_replaces_stale_unpublished_campaign(self):
        api = FakeMautic()
        flows.setup(api, apply=True)
        campaign = api.store["campaigns"][0]
        campaign["events"] = [{"type": "email.send", "order": 1, "properties": {"email": 1, "email_type": "transactional"}, "triggerInterval": 0}]
        api.calls.clear()
        flows.setup(api, apply=True)
        self.assertIn(("DELETE", f"campaigns/{campaign['id']}/delete", None), api.calls)

    def test_copy_has_opt_out_and_no_em_dash(self):
        for flow in flows.FLOWS:
            for index, step in enumerate(flow.steps):
                self.assertNotIn("—", step.subject + step.preheader + step.text)
                payload = flows.email_payload(flow, index)
                self.assertIn("{unsubscribe_url}", payload["plainText"])
                self.assertIn("{dnc_url}", payload["plainText"])
                self.assertIn("{unsubscribe_url}", payload["customHtml"])
                self.assertIn("{dnc_url}", payload["customHtml"])
                self.assertIn("<!doctype html>", payload["customHtml"])
                self.assertNotIn("tracking_pixel", payload["customHtml"])
                if not flow.cold:
                    self.assertIn("https://blockwise.sale/", step.text)
                    self.assertNotIn("https://blockwise.sale\n", step.text)
            if flow.cold:
                self.assertFalse(flows.email_payload(flow, 0)["isPublished"])
        self.assertNotIn("error.read", pathlib.Path(flows.__file__).read_text(encoding="utf-8"))

    def test_cold_flow_is_explicitly_blocked(self):
        self.assertTrue(next(flow for flow in flows.FLOWS if flow.key == "cold_local_audit").cold)

    def test_education_reply_uses_native_exit_without_changing_other_flows(self):
        emails = {flows.email_key(flow, index): index + 1 for flow in flows.FLOWS for index, _step in enumerate(flow.steps)}
        for flow in flows.FLOWS:
            events, _canvas = flows.campaign_events(flow, emails)
            replies = [event for event in events if event["type"] == "email.reply"]
            if flow.key == "opted_in_education":
                self.assertEqual(len(replies), 3)
                self.assertEqual(len([event for event in events if event["type"] == "lead.updatelead"]), 3)
                self.assertTrue(all(event["properties"][flows.NURTURE_EXIT_FIELD] == "stopped" for event in events if event["type"] == "lead.updatelead"))
            else:
                self.assertEqual(replies, [])

    def test_bridge_replay_repairs_segment_failure_after_contact_create(self):
        api = FakeBridgeMautic(fail_segment_once=True)
        with self.assertRaisesRegex(flows.ApiError, "segment membership"):
            flows.bridge(api, bridge_args())
        self.assertEqual(len(api.contacts), 1)
        self.assertNotIn("blockwise_source_event_id", api.contacts[0]["fields"]["all"])
        flows.bridge(api, bridge_args())
        self.assertEqual(api.memberships, {(1, 4)})
        self.assertEqual(api.contacts[0]["fields"]["all"]["blockwise_source_event_id"], EVENT_ONE)

    def test_bridge_replays_old_and_new_events_without_last_event_dedup(self):
        api = FakeBridgeMautic(contacts=[bridge_contact()])
        flows.bridge(api, bridge_args(source_event_id=EVENT_ONE))
        flows.bridge(api, bridge_args(source_event_id=EVENT_OLD))
        flows.bridge(api, bridge_args(source_event_id=EVENT_NEW))
        segment_adds = [call for call in api.calls if call[0] == "POST" and call[1].startswith("segments/")]
        self.assertEqual(len(segment_adds), 3)
        self.assertEqual(api.memberships, {(1, 4)})
        self.assertEqual(api.contacts[0]["fields"]["all"]["blockwise_source_event_id"], EVENT_NEW)

    def test_bridge_holds_cross_workspace_profile_without_overwrite(self):
        api = FakeBridgeMautic(contacts=[bridge_contact(workspace_id="20000000-0000-4000-8000-000000000002")])
        with self.assertRaisesRegex(flows.ApiError, "profile/workspace"):
            flows.bridge(api, bridge_args())
        self.assertEqual(api.memberships, set())
        self.assertFalse(any(call[0] == "PATCH" for call in api.calls))

    def test_bridge_refuses_implicit_email_merge_before_create(self):
        api = FakeBridgeMautic(contacts=[bridge_contact(profile_id="10000000-0000-4000-8000-000000000002")])
        with self.assertRaisesRegex(flows.ApiError, "email belongs"):
            flows.bridge(api, bridge_args())
        self.assertFalse(any(call[1] == "contacts/new" for call in api.calls))

    def test_bridge_holds_existing_profile_when_email_has_drifted(self):
        api = FakeBridgeMautic(contacts=[bridge_contact(email="changed@example.test")])
        with self.assertRaisesRegex(flows.ApiError, "email identity drift"):
            flows.bridge(api, bridge_args())
        self.assertEqual(api.memberships, set())
        self.assertFalse(any(call[0] == "PATCH" for call in api.calls))

    def test_bridge_holds_malformed_or_mismatched_create_response_before_membership(self):
        responses = (
            {"id": 1, "fields": {"all": {"blockwise_profile_id": PROFILE_ID, "blockwise_workspace_id": WORKSPACE_ID}}},
            bridge_contact(profile_id="10000000-0000-4000-8000-000000000002"),
        )
        for response in responses:
            with self.subTest(response=response):
                api = FakeBridgeMautic(create_response=response)
                with self.assertRaisesRegex(flows.ApiError, "contact response"):
                    flows.bridge(api, bridge_args())
                self.assertEqual(api.memberships, set())

    def test_bridge_rejects_malformed_identity_and_email(self):
        for values in (
            {"profile_id": "not-a-uuid"},
            {"workspace_id": "not-a-uuid"},
            {"source_event_id": "not-a-uuid"},
            {"email": "not-an-email"},
        ):
            with self.subTest(values=values):
                with self.assertRaises(flows.ApiError):
                    flows.bridge(FakeBridgeMautic(), bridge_args(**values))

    def test_dnc_only_blocks_the_native_email_channel(self):
        sms = FakeBridgeMautic(contacts=[bridge_contact(dnc=[{"channel": "sms", "reason": 3}])])
        flows.bridge(sms, bridge_args())
        self.assertEqual(sms.memberships, {(1, 4)})
        email = FakeBridgeMautic(contacts=[bridge_contact(dnc=[{"channel": "email", "reason": 3}])])
        with self.assertRaisesRegex(flows.ApiError, "Do Not Contact"):
            flows.bridge(email, bridge_args())
        self.assertEqual(email.memberships, set())

    def test_suppression_stops_campaign_and_adds_email_dnc_only(self):
        api = FakeBridgeMautic(contacts=[bridge_contact(dnc=[{"channel": "sms", "reason": 3}])])
        flows.suppress(api, bridge_args(consent_state="opted_out", source_event_id=EVENT_NEW))
        patch = next(call[2] for call in api.calls if call[0] == "PATCH")
        self.assertEqual(patch[flows.CONSENT_FIELD], "opted_out")
        self.assertEqual(patch[flows.NURTURE_EXIT_FIELD], "stopped")
        self.assertEqual(
            patch["doNotContact"],
            [{"channel": "sms", "reason": 3}, {"channel": "email", "reason": 3}],
        )

    def test_suppression_never_creates_a_contact(self):
        api = FakeBridgeMautic()
        flows.suppress(api, bridge_args(consent_state="opted_out"))
        self.assertEqual(api.contacts, [])
        self.assertFalse(any(call[1] == "contacts/new" for call in api.calls))

    def test_identity_lookup_is_paginated_and_bounded(self):
        api = FakeBridgeMautic(contacts=[bridge_contact(contact_id=index) for index in range(1, 12)])
        with self.assertRaisesRegex(flows.ApiError, "ambiguous"):
            flows.bridge(api, bridge_args())
        lookups = [call for call in api.calls if call[0] == "GET"]
        self.assertEqual(len(lookups), 2)
        self.assertTrue(all("limit=10" in call[1] for call in lookups))

    def test_identity_lookup_accepts_only_decimal_matic_total(self):
        api = FakeBridgeMautic(total_as_string=True)
        flows.bridge(api, bridge_args())
        self.assertEqual(len(api.contacts), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
