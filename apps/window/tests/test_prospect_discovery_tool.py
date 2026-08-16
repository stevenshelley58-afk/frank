import importlib.util
import json
import re
import sys
import unittest
from copy import deepcopy
from pathlib import Path


TOOL_DIR = Path(__file__).parents[1] / "tools" / "prospect-discovery"
MODULE_SPEC = importlib.util.spec_from_file_location(
    "prospect_discovery_release", TOOL_DIR / "release.py"
)
prospect_release = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = prospect_release
MODULE_SPEC.loader.exec_module(prospect_release)


class ProspectDiscoveryReleaseTests(unittest.TestCase):
    def fixture(self):
        return json.loads(
            (TOOL_DIR / "fixtures" / "verified-prospect-release-v1.json").read_text(
                encoding="utf-8"
            )
        )

    def test_manifest_schema_pipeline_and_fixture_are_exact(self):
        manifest = json.loads((TOOL_DIR / "manifest.json").read_text(encoding="utf-8"))
        schema = json.loads((TOOL_DIR / "release.schema.json").read_text(encoding="utf-8"))
        fixture = self.fixture()
        pipeline = manifest["pipelines"][0]

        self.assertEqual(manifest["release_schema"], prospect_release.RELEASE_SCHEMA)
        self.assertEqual(schema["$id"], manifest["release_schema"])
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(fixture), set(schema["required"]))
        self.assertEqual(pipeline["id"], prospect_release.PIPELINE_ID)
        self.assertEqual(pipeline["version"], prospect_release.PIPELINE_VERSION)
        self.assertEqual(fixture["consumer_compatibility"], ["prospect-release-v1"])

    def test_golden_fixture_validates_and_hashes_with_rfc8785(self):
        fixture = self.fixture()
        result = prospect_release.validate_release(fixture)
        expected_hash = prospect_release.canonical_sha256(
            {key: value for key, value in fixture.items() if key != "release_hash"}
        )
        self.assertEqual(result, fixture)
        self.assertEqual(
            result["release_hash"],
            "a81bf1484ceadf0b6e7a9b790cfe37439a41f9fcb169b3151c99a08fd020d4e9",
        )
        self.assertEqual(result["release_hash"], expected_hash)

    def test_builder_emits_the_golden_release(self):
        fixture = self.fixture()
        built = prospect_release.build_release(
            release_id=fixture["release_id"],
            version=fixture["version"],
            released_at=fixture["released_at"],
            project_scope=fixture["project_scope"],
            settings_revision=fixture["settings_revision"],
            settings_ref=fixture["settings_ref"],
            trace_refs=fixture["trace_refs"],
            sanitization_receipt_refs=fixture["sanitization_receipt_refs"],
            candidates=fixture["candidates"],
        )
        self.assertEqual(built, fixture)

    def test_candidates_are_closed_verified_opaque_records(self):
        fixture = self.fixture()
        candidate = fixture["candidates"][0]
        self.assertEqual(
            set(candidate),
            {
                "prospect_ref",
                "contact_ref",
                "evidence_refs",
                "qualification",
                "verification_receipt_ref",
            },
        )
        self.assertEqual(
            set(candidate["qualification"]), {"decision", "score", "policy_ref"}
        )
        self.assertEqual(candidate["qualification"]["decision"], "qualified")
        self.assertEqual(
            fixture["verification_receipt_refs"],
            [candidate["verification_receipt_ref"]],
        )

        for key in ("email", "phone", "raw_provider_payload", "consent", "blockwise_lead_id"):
            invalid = deepcopy(fixture)
            invalid["candidates"][0][key] = "not-public"
            with self.subTest(key=key), self.assertRaises(ValueError):
                prospect_release.validate_release(invalid)

    def test_release_rejects_unverified_or_mismatched_qa_receipts(self):
        fixture = self.fixture()
        invalid = deepcopy(fixture)
        invalid["candidates"][0]["qualification"]["decision"] = "review"
        with self.assertRaises(ValueError):
            prospect_release.validate_release(invalid)

        invalid = deepcopy(fixture)
        invalid["consumer_compatibility"].append("unsupported-consumer-v1")
        with self.assertRaises(ValueError):
            prospect_release.validate_release(invalid)

        invalid = deepcopy(fixture)
        invalid["candidates"][0]["qualification"]["score"] = True
        with self.assertRaises(ValueError):
            prospect_release.validate_release(invalid)

        invalid = deepcopy(fixture)
        invalid["verification_receipt_refs"] = ["receipt://prospect/p-2/verified"]
        with self.assertRaises(ValueError):
            prospect_release.validate_release(invalid)

        invalid = deepcopy(fixture)
        invalid["sanitization_receipt_refs"] = []
        with self.assertRaises(ValueError):
            prospect_release.validate_release(invalid)

    def test_release_rejects_contact_values_private_refs_and_ad_radar_records(self):
        fixture = self.fixture()
        cases = (
            ("contact_ref", "person@example.test"),
            ("contact_ref", "contact://person@example.test"),
            ("contact_ref", "contact://+61400123456"),
            ("contact_ref", "contact://61400123456"),
            ("contact_ref", "contact://0061/400/123/456"),
            ("prospect_ref", "prospect://0061/400/123/456"),
            ("prospect_ref", "ad://creative/a-1"),
            ("evidence_refs", ["openbao://private/evidence"]),
            ("verification_receipt_ref", "receipt://prospect/p-1?token=secret"),
            ("verification_receipt_ref", "receipt://ghp_secretvalue"),
            ("verification_receipt_ref", "receipt://GHP_secretvalue"),
            ("verification_receipt_ref", "receipt://sk_live_secretvalue"),
        )
        for field, value in cases:
            invalid = deepcopy(fixture)
            invalid["candidates"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                prospect_release.validate_release(invalid)

        invalid = deepcopy(fixture)
        invalid["candidates"][0]["qualification"]["policy_ref"] = "policy://api_key_livevalue"
        with self.assertRaises(ValueError):
            prospect_release.validate_release(invalid)

    def test_schema_secret_and_phone_guards_match_runtime_rejections(self):
        schema = json.loads((TOOL_DIR / "release.schema.json").read_text(encoding="utf-8"))
        guards = [
            re.compile(item["pattern"])
            for item in schema["$defs"]["opaqueRefGuard"]["not"]["anyOf"]
        ]
        for unsafe in (
            "receipt://sk_live_secretvalue",
            "receipt://GHP_secretvalue",
            "policy://api_key_livevalue",
            "contact://0061/400/123/456",
            "trace://javascript:alert",
            "evidence://-----BEGIN PRIVATE KEY-----",
        ):
            with self.subTest(unsafe=unsafe):
                self.assertTrue(any(pattern.search(unsafe) for pattern in guards))

        def ref_schema_accepts(definition_name, value):
            definition = schema["$defs"][definition_name]
            for clause in definition["allOf"]:
                if "$ref" in clause:
                    guard = schema["$defs"][clause["$ref"].rsplit("/", 1)[-1]]
                    if any(re.search(item["pattern"], value) for item in guard["not"]["anyOf"]):
                        return False
                elif not re.search(clause["pattern"], value):
                    return False
            return True

        self.assertTrue(ref_schema_accepts("contactRef", "contact://prospect/p-1"))
        for unsafe_contact in (
            "contact://1234-5678",
            "contact://123-45678",
            "contact://12-345678",
            "contact://1-234-5678",
        ):
            with self.subTest(unsafe_contact=unsafe_contact):
                self.assertFalse(ref_schema_accepts("contactRef", unsafe_contact))
                invalid = self.fixture()
                invalid["candidates"][0]["contact_ref"] = unsafe_contact
                with self.assertRaises(ValueError):
                    prospect_release.validate_release(invalid)

    def test_release_rejects_wrong_scope_identity_and_hash(self):
        fixture = self.fixture()
        cases = (
            ("schema", "schema://frank.ad-intelligence-release/v1"),
            ("tool_id", "ad-intelligence"),
            ("pipeline_id", "ad-radar-pipeline"),
            ("project_scope", "Blockwise"),
            ("settings_revision", True),
            ("released_at", "2026-08-14"),
            ("immutable", False),
        )
        for field, value in cases:
            invalid = deepcopy(fixture)
            invalid[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                prospect_release.validate_release(invalid)

        invalid = deepcopy(fixture)
        invalid["release_hash"] = "0" * 64
        with self.assertRaises(ValueError):
            prospect_release.validate_release(invalid)


if __name__ == "__main__":
    unittest.main()
