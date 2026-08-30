import re
import tempfile
import unittest
from pathlib import Path

from graph.control_plane import (
    ControlContractError,
    ControlPlaneContracts,
    FEATURE_FLAGS,
    REQUIRED_OSS_DECISION_IDS,
    RELATIONSHIPS,
    STABLE_ID_PATTERN,
    canonical_bytes,
    id_key,
    normalize_stable_id,
    require_canonical_stable_id,
    resolve_key_path,
    stable_id_from_key,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
CONTROL_ROOT = REPO_ROOT / "governance" / "control-plane"


class ControlPlaneContractTests(unittest.TestCase):
    def test_release_one_stable_ids_normalize_then_persist_canonically(self):
        self.assertEqual(normalize_stable_id("Project:Frank"), "project:frank")
        self.assertEqual(
            require_canonical_stable_id("capability:frank/ad-template-builder"),
            "capability:frank/ad-template-builder",
        )
        for invalid in (
            "artifact:receipt",
            "project:../escape",
            "project:frank_legacy",
            "project:",
            "project:frank//window",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ControlContractError):
                normalize_stable_id(invalid)
        with self.assertRaisesRegex(ControlContractError, "lower-case"):
            require_canonical_stable_id("Project:Frank")

    def test_id_keys_are_strict_canonical_base64url_round_trips(self):
        stable_id = "receipt:map/vps-world-20260830-001"
        key = id_key(stable_id)
        self.assertTrue(key.startswith("id_"))
        self.assertNotIn("=", key)
        self.assertEqual(stable_id_from_key(key), stable_id)
        for invalid in (
            stable_id,
            "id_",
            "id_Zm9v=",
            "id_..",
            "id_%2e%2e",
            "id_\\escape",
            "id_Zm9v",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ControlContractError):
                stable_id_from_key(invalid)

    def test_materialization_paths_accept_only_declared_key_formats(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = resolve_key_path(root, id_key("project:frank"), "manifest")
            self.assertEqual(target.parent.parent, root.resolve())
            for invalid in ("project:frank", "../escape", "id_%2e%2e", "g_123"):
                with self.subTest(invalid=invalid), self.assertRaises(ControlContractError):
                    resolve_key_path(root, invalid, "manifest")
            with self.assertRaises(ControlContractError):
                resolve_key_path(root, id_key("project:frank"), "../manifest")

    def test_duplicate_yaml_keys_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "duplicate.yaml").write_text("value: one\nvalue: two\n", encoding="utf-8")
            with self.assertRaisesRegex(ControlContractError, "duplicate declaration key"):
                ControlPlaneContracts(root).load("duplicate.yaml")

    def test_declared_contract_is_cross_record_valid_and_byte_deterministic(self):
        contracts = ControlPlaneContracts(CONTROL_ROOT)
        first = contracts.validate()
        second = contracts.validate()
        self.assertEqual(canonical_bytes(first), canonical_bytes(second))
        self.assertRegex(first["contract_hash"], r"^sha256:[0-9a-f]{64}$")
        self.assertEqual(set(first["feature_flags"]["defaults"]), FEATURE_FLAGS)
        self.assertEqual(
            {decision["id"] for decision in first["oss_decisions"]},
            REQUIRED_OSS_DECISION_IDS,
        )
        self.assertEqual(
            {edge["type"] for edge in first["catalog"]["relationships"]} - RELATIONSHIPS,
            set(),
        )

    def test_schemas_embed_the_exact_closed_id_grammar(self):
        escaped = STABLE_ID_PATTERN.replace("\\", "\\\\")
        for path in sorted((CONTROL_ROOT / "schema").glob("*.schema.json")):
            raw = path.read_text(encoding="utf-8")
            if "stable_id" in raw:
                self.assertTrue(
                    STABLE_ID_PATTERN in raw or escaped in raw,
                    f"{path.name} drifted from the release-1 ID grammar",
                )
        self.assertTrue(re.fullmatch(STABLE_ID_PATTERN, "edge:frank/window-routes"))


if __name__ == "__main__":
    unittest.main()
