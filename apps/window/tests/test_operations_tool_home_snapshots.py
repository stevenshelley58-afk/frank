import importlib.util
import json
import sys
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).parents[1] / "tools"


def load_package(name, directory):
    spec = importlib.util.spec_from_file_location(
        name,
        directory / "__init__.py",
        submodule_search_locations=[str(directory)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


prospect = load_package("prospect_discovery_snapshot_package", TOOLS_DIR / "prospect-discovery")
outreach = load_package("outreach_snapshot_package", TOOLS_DIR / "outreach")
mail = load_package("mail_snapshot_package", TOOLS_DIR / "mail")


class OperationsToolHomeSnapshotTests(unittest.TestCase):
    TOP_LEVEL = {
        "schema", "tool_id", "status", "summary", "overview", "connections",
        "current_work", "outputs", "receipts", "source_truth",
    }

    def fixture(self):
        return json.loads(
            (
                TOOLS_DIR
                / "prospect-discovery"
                / "fixtures"
                / "verified-prospect-release-v1.json"
            ).read_text(encoding="utf-8")
        )

    def test_unavailable_and_empty_states_are_explicit(self):
        for tool in (prospect, outreach, mail):
            with self.subTest(tool=tool.__name__):
                unavailable = tool.build_home_snapshot()
                empty = tool.build_home_snapshot({})
                self.assertEqual(set(unavailable), self.TOP_LEVEL)
                self.assertEqual(unavailable["status"], "unavailable")
                self.assertEqual(empty["status"], "empty")
                self.assertEqual(empty["current_work"]["items"], [])
                self.assertEqual(empty["outputs"]["items"], [])
                self.assertEqual(empty["receipts"]["items"], [])
                self.assertEqual(empty["source_truth"], "runtime")
                unavailable["overview"]["capabilities"].append("mutated")
                self.assertNotIn(
                    "mutated", tool.build_home_snapshot()["overview"]["capabilities"]
                )

    def test_overview_and_connection_requirements_match_canonical_manifests(self):
        for tool_id, tool in (
            ("prospect-discovery", prospect),
            ("outreach", outreach),
            ("mail", mail),
        ):
            with self.subTest(tool=tool_id):
                manifest = json.loads((TOOLS_DIR / tool_id / "manifest.json").read_text(encoding="utf-8"))
                home = json.loads((TOOLS_DIR / tool_id / "home.json").read_text(encoding="utf-8"))
                snapshot = tool.build_home_snapshot({})
                overview = snapshot["overview"]
                self.assertEqual(overview["name"], home["name"])
                self.assertEqual(overview["blurb"], home["blurb"])
                self.assertEqual(overview["version"], manifest["version"])
                self.assertEqual(overview["scopes"], manifest["scopes"])
                self.assertEqual(overview["capabilities"], home["capabilities"])
                self.assertEqual(
                    overview["adjustable_settings"],
                    sorted(manifest["settings"]["properties"]),
                )
                self.assertEqual(
                    [item["capability"] for item in snapshot["connections"]["items"]],
                    home["connection_capabilities"],
                )
                self.assertEqual(snapshot["connections"]["status"], "unavailable")

    def test_prospect_snapshot_uses_only_validated_release_summary_and_receipts(self):
        fixture = self.fixture()
        snapshot = prospect.build_home_snapshot({
            "connections": [
                {"capability": "public-source-read", "status": "verified", "connection_id": "connection-public-1"}
            ],
            "runs": [
                {"run_id": "run-1", "status": "completed", "stage": "qualify", "updated_at": "2026-08-14T00:00:00Z"}
            ],
            "releases": [fixture],
        })
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["connections"]["status"], "ready")
        self.assertEqual(snapshot["outputs"]["items"][0]["candidate_count"], 1)
        rendered_outputs = json.dumps(snapshot["outputs"])
        self.assertNotIn("contact_ref", rendered_outputs)
        self.assertNotIn("evidence_refs", rendered_outputs)
        self.assertNotIn("policy_ref", rendered_outputs)
        self.assertNotIn("score", rendered_outputs)
        self.assertIn("receipt://prospect/p-1/verified", json.dumps(snapshot["receipts"]))

    def test_outreach_requires_an_immutable_prospect_release_reference(self):
        command = {
            "command_id": "command-1",
            "action": "delivery-request",
            "status": "awaiting_approval",
            "project_id": "blockwise",
            "updated_at": "2026-08-14T00:00:00Z",
            "prospect_release_ref": "release://prospect/prospect-release-1",
            "trace_ref": "trace://outreach/command-1",
        }
        snapshot = outreach.build_home_snapshot({"commands": [command]})
        self.assertEqual(snapshot["status"], "attention")
        self.assertEqual(snapshot["current_work"]["status"], "attention")
        self.assertFalse(snapshot["current_work"]["items"][0]["gate_receipts_complete"])
        self.assertEqual(snapshot["current_work"]["items"][0]["prospect_release_ref"], command["prospect_release_ref"])

        invalid = dict(command, prospect_release_ref="prospect://mutable/p-1")
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({"commands": [invalid]})
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({"commands": [dict(command, email="person@example.test")]})
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({"commands": [dict(command, prospect_release_ref="release://prospect/")]})

        command["status"] = "completed"
        gate_kinds = (
            "approval", "legal-basis", "policy", "project-suppression",
            "global-suppression", "quiet-hours", "idempotency", "connection-capability",
        )
        ready = outreach.build_home_snapshot({
            "connections": [
                {"capability": capability, "status": "verified", "connection_id": f"connection-{index}"}
                for index, capability in enumerate(("campaign-management", "segment-management", "outbound-delivery"), 1)
            ],
            "commands": [command],
            "outcomes": [{
                "request_id": "request-1",
                "command_id": "command-1",
                "status": "accepted",
                "action_receipt_ref": "receipt://outreach/command-1/action",
                "recorded_at": "2026-08-14T00:00:01Z",
            }],
            "receipts": [
                {
                    "command_id": "command-1",
                    "kind": kind,
                    "receipt_ref": f"receipt://outreach/command-1/{kind}",
                    "status": "approved" if kind == "approval" else "pass",
                    "recorded_at": "2026-08-14T00:00:00Z",
                }
                for kind in gate_kinds
            ],
        })
        self.assertEqual(ready["status"], "ready")
        self.assertTrue(ready["current_work"]["items"][0]["gate_receipts_complete"])
        self.assertTrue(ready["current_work"]["items"][0]["action_receipt_recorded"])

        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({
                "commands": [command],
                "outcomes": [{
                    "request_id": "request-late-gates",
                    "command_id": "command-1",
                    "status": "accepted",
                    "action_receipt_ref": "receipt://outreach/command-1/late-gates-action",
                    "recorded_at": "2026-08-14T00:00:01Z",
                }],
                "receipts": [
                    {
                        "command_id": "command-1",
                        "kind": kind,
                        "receipt_ref": f"receipt://outreach/command-1/late-{kind}",
                        "status": "approved" if kind == "approval" else "pass",
                        "recorded_at": "2026-08-15T00:00:00Z",
                    }
                    for kind in gate_kinds
                ],
            })

        outcome = {
            "request_id": "request-2",
            "command_id": "missing-command",
            "status": "accepted",
            "action_receipt_ref": "receipt://outreach/missing/action",
            "recorded_at": "2026-08-14T00:00:00Z",
        }
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({"commands": [command], "outcomes": [outcome]})

        non_delivery = dict(command, command_id="command-2", action="list-build")
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({
                "commands": [non_delivery],
                "outcomes": [{**outcome, "command_id": "command-2"}],
            })

        stale_outcome = {
            **outcome,
            "command_id": "command-1",
            "recorded_at": "2026-08-13T23:59:59Z",
        }
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({"commands": [command], "outcomes": [stale_outcome]})

        receipt = {
            "command_id": "missing-command",
            "kind": "policy",
            "receipt_ref": "receipt://outreach/missing/policy",
            "status": "pass",
            "recorded_at": "2026-08-14T00:00:00Z",
        }
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({"commands": [command], "receipts": [receipt]})
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({
                "commands": [command],
                "receipts": [{
                    **receipt,
                    "command_id": "command-1",
                    "recorded_at": "2026-08-13T23:59:59Z",
                }],
            })

    def test_mail_projects_counts_and_refs_never_message_content(self):
        snapshot = mail.build_home_snapshot({
            "connections": [
                {"capability": capability, "status": "verified", "connection_id": f"connection-mail-{index}"}
                for index, capability in enumerate(("mail-read", "mail-receipts", "mail-events"), 1)
            ],
            "sync_runs": [{
                "sync_id": "sync-1",
                "status": "completed",
                "stage": "events",
                "cursor_ref": "cursor://mail/project-1",
                "updated_at": "2026-08-14T00:00:00Z",
            }],
            "projections": [{
                "projection_id": "projection-1",
                "kind": "thread",
                "status": "ready",
                "count": 12,
                "updated_at": "2026-08-14T00:00:00Z",
            }],
            "receipts": [{
                "kind": "delivery",
                "receipt_ref": "receipt://mail/delivery-1",
                "status": "delivered",
                "recorded_at": "2026-08-14T00:00:00Z",
            }],
        })
        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["outputs"]["items"][0]["count"], 12)
        self.assertNotIn("body", json.dumps(snapshot).lower())
        self.assertNotIn("address", json.dumps(snapshot).lower())

        with self.assertRaises(ValueError):
            mail.build_home_snapshot({"message_body": "not allowed"})
        invalid_sync = {
            "sync_id": "sync-1",
            "status": "completed",
            "stage": "events",
            "cursor_ref": "cursor://mail/",
            "updated_at": "2026-08-14T00:00:00Z",
        }
        with self.assertRaises(ValueError):
            mail.build_home_snapshot({"sync_runs": [invalid_sync]})

    def test_attention_states_and_row_caps_are_truthful(self):
        runs = [
            {
                "run_id": f"run-{index}",
                "status": "failed" if index == 24 else "completed",
                "stage": "qualify",
                "updated_at": "2026-08-14T00:00:00Z",
            }
            for index in range(25)
        ]
        snapshot = prospect.build_home_snapshot({"runs": runs})
        self.assertEqual(snapshot["status"], "attention")
        self.assertEqual(snapshot["current_work"]["count"], 25)
        self.assertEqual(len(snapshot["current_work"]["items"]), 20)
        self.assertEqual(snapshot["current_work"]["items"][-1]["run_id"], "run-24")

        awaiting = prospect.build_home_snapshot({
            "connections": [{
                "capability": "public-source-read",
                "status": "verified",
                "connection_id": "connection-public-1",
            }],
            "runs": [{
                "run_id": "run-awaiting-verification",
                "status": "awaiting_verification",
                "stage": "evidence",
                "updated_at": "2026-08-14T00:00:00Z",
            }],
        })
        self.assertEqual(awaiting["status"], "attention")
        self.assertEqual(awaiting["current_work"]["status"], "attention")

    def test_explicit_connection_attention_is_never_hidden_by_empty_work(self):
        cases = (
            (prospect, "public-source-read"),
            (outreach, "outbound-delivery"),
            (mail, "mail-read"),
        )
        for tool, capability in cases:
            with self.subTest(tool=tool.__name__):
                snapshot = tool.build_home_snapshot({
                    "connections": [{
                        "capability": capability,
                        "status": "attention",
                        "connection_id": None,
                    }]
                })
                self.assertEqual(snapshot["connections"]["status"], "attention")
                self.assertEqual(snapshot["status"], "attention")

    def test_mail_rejects_contradictory_receipt_kind_and_status(self):
        with self.assertRaises(ValueError):
            mail.build_home_snapshot({
                "receipts": [{
                    "kind": "complaint",
                    "receipt_ref": "receipt://mail/complaint-1",
                    "status": "delivered",
                    "recorded_at": "2026-08-14T00:00:00Z",
                }]
            })

    def test_recorded_mail_bounce_and_complaint_are_attention(self):
        for kind in ("bounce", "complaint"):
            with self.subTest(kind=kind):
                snapshot = mail.build_home_snapshot({
                    "connections": [
                        {
                            "capability": capability,
                            "status": "verified",
                            "connection_id": f"connection-mail-{index}",
                        }
                        for index, capability in enumerate(
                            ("mail-read", "mail-receipts", "mail-events"), 1
                        )
                    ],
                    "receipts": [{
                        "kind": kind,
                        "receipt_ref": f"receipt://mail/{kind}-1",
                        "status": "recorded",
                        "recorded_at": "2026-08-14T00:00:00Z",
                    }],
                })
                self.assertEqual(snapshot["status"], "attention")
                self.assertEqual(snapshot["receipts"]["status"], "attention")

    def test_invalid_state_is_rejected_and_providers_do_no_io(self):
        for tool_id, tool in (
            ("prospect-discovery", prospect),
            ("outreach", outreach),
            ("mail", mail),
        ):
            with self.subTest(tool=tool_id):
                with self.assertRaises(TypeError):
                    tool.build_home_snapshot([])
                with self.assertRaises(ValueError):
                    tool.build_home_snapshot({"fixture": {}})
                source = (TOOLS_DIR / tool_id / "home_snapshot.py").read_text(encoding="utf-8")
                self.assertNotIn("read_text(", source)
                self.assertNotIn("open(", source)
                self.assertNotIn("requests", source)
                self.assertNotIn("urlopen", source)

        with self.assertRaises(ValueError):
            prospect.build_home_snapshot({
                "connections": [{
                    "capability": "public-source-read",
                    "status": "verified",
                    "connection_id": "vault://private/connection",
                }]
            })
        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({
                "receipts": [{
                    "command_id": "command-1",
                    "kind": "policy",
                    "receipt_ref": "openbao://private/receipt",
                    "status": "pass",
                    "recorded_at": "2026-08-14T00:00:00Z",
                }]
            })
        with self.assertRaises(ValueError):
            mail.build_home_snapshot({
                "receipts": [{
                    "kind": "delivery",
                    "receipt_ref": "file://private/receipt",
                    "status": "recorded",
                    "recorded_at": "2026-08-14T00:00:00Z",
                }]
            })

        with self.assertRaises(ValueError):
            outreach.build_home_snapshot({
                "receipts": [{
                    "command_id": "command-1",
                    "kind": "policy",
                    "receipt_ref": "https://provider.example/receipt/1",
                    "status": "pass",
                    "recorded_at": "2026-08-14T00:00:00Z",
                }]
            })
        with self.assertRaises(ValueError):
            prospect.build_home_snapshot({
                "connections": [{
                    "capability": "public-source-read",
                    "status": "verified",
                    "connection_id": "api_key_livevalue",
                }]
            })

    def test_mail_unavailable_projection_needs_attention_with_verified_connections(self):
        snapshot = mail.build_home_snapshot({
            "connections": [
                {"capability": capability, "status": "verified", "connection_id": f"connection-mail-{index}"}
                for index, capability in enumerate(("mail-read", "mail-receipts", "mail-events"), 1)
            ],
            "projections": [{
                "projection_id": "projection-1",
                "kind": "thread",
                "status": "unavailable",
                "count": 0,
                "updated_at": "2026-08-14T00:00:00Z",
            }],
        })
        self.assertEqual(snapshot["status"], "attention")
        self.assertEqual(snapshot["outputs"]["status"], "attention")

    def test_outreach_consumer_fixture_is_byte_compatible_with_producer(self):
        producer_path = TOOLS_DIR / "prospect-discovery" / "fixtures" / "verified-prospect-release-v1.json"
        consumer_path = TOOLS_DIR / "outreach" / "fixtures" / "prospect-release-v1.json"
        self.assertEqual(producer_path.read_bytes(), consumer_path.read_bytes())
        self.assertEqual(prospect.validate_release(json.loads(consumer_path.read_text(encoding="utf-8"))), self.fixture())


if __name__ == "__main__":
    unittest.main()
