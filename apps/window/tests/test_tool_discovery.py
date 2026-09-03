"""Automatic tool/widget discovery tests: add/remove fixture, quarantine."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tool_apps.contracts import ContractError
from tool_apps.discovery_adapter import build_catalogue, discover_catalogue
from tool_apps.home_manifest import discover_tool_homes

VALID_HOME = {
    "id": "fixture-tool",
    "name": "Fixture Tool",
    "kind": "tool",
    "blurb": "A disposable fixture proving automatic discovery.",
    "capabilities": ["fixture.capability"],
    "default_widget_ids": ["fixture-tool-summary"],
    "connection_capabilities": ["fixture.connect"],
}


def _make_package(root: Path, name: str, home: dict | None, *, manifest: bool = True, home_name: str = "home.json"):
    package = root / name
    package.mkdir(parents=True, exist_ok=True)
    if manifest:
        (package / "manifest.json").write_text(json.dumps({"name": name}), encoding="utf-8")
    if home is not None:
        (package / home_name).write_text(json.dumps(home), encoding="utf-8")
    return package


class DiscoveryAdapterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "tools"
        self.root.mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def test_fixture_tool_automatically_appears_and_disappears(self):
        _make_package(self.root, "fixture-tool", VALID_HOME)
        catalogue = discover_catalogue(self.root)
        self.assertEqual([w["id"] for w in catalogue["widgets"]], ["fixture-tool"])
        self.assertEqual(catalogue["widgets"][0]["source_type"], "tool-package")
        self.assertEqual(catalogue["quarantined"], [])
        # Removal proves disappearance.
        for item in (self.root / "fixture-tool").iterdir():
            item.unlink()
        (self.root / "fixture-tool").rmdir()
        after = discover_catalogue(self.root)
        self.assertEqual(after["widgets"], [])
        self.assertEqual(after["quarantined"], [])

    def test_invalid_manifest_is_quarantined_without_blocking_others(self):
        _make_package(self.root, "fixture-tool", VALID_HOME)
        broken = _make_package(self.root, "broken-tool", {"id": "broken-tool", "kind": "wrong-kind"})
        catalogue = discover_catalogue(self.root)
        self.assertEqual([w["id"] for w in catalogue["widgets"]], ["fixture-tool"])  # unaffected
        self.assertEqual(len(catalogue["quarantined"]), 1)
        self.assertEqual(catalogue["quarantined"][0]["id"], "broken-tool")
        self.assertTrue(catalogue["quarantined"][0]["reason"])

    def test_duplicate_ids_quarantined(self):
        # The directory-name==id rule normally makes duplicates impossible;
        # the dedupe guard is exercised with the name check neutralized so a
        # future relaxation cannot reintroduce silent same-id merges.
        _make_package(self.root, "alpha", dict(VALID_HOME, id="fixture-tool"))
        _make_package(self.root, "beta", dict(VALID_HOME, id="fixture-tool"))
        from unittest import mock
        with mock.patch("tool_apps.discovery_adapter.validate_home_manifest", lambda manifest: manifest):
            catalogue = discover_catalogue(self.root)
        self.assertEqual(len(catalogue["widgets"]), 1)
        self.assertTrue(catalogue["quarantined"][0]["reason"].startswith("duplicate widget id"))

    def test_symlink_and_escape_attempts_are_quarantined(self):
        import os
        outside = Path(self.temp.name) / "outside"
        _make_package(Path(self.temp.name), "outside", VALID_HOME)
        os.symlink(outside, self.root / "fixture-tool")
        catalogue = discover_catalogue(self.root)
        self.assertEqual(catalogue["widgets"], [])  # symlinked package skipped entirely

    def test_packages_without_home_json_are_ignored(self):
        _make_package(self.root, "plain-package", None)
        catalogue = discover_catalogue(self.root)
        self.assertEqual(catalogue["widgets"], [])
        self.assertEqual(catalogue["quarantined"], [])

    def test_builtins_win_and_are_counted(self):
        _make_package(self.root, "fixture-tool", VALID_HOME)
        builtins = [{"id": "fixture-tool", "name": "Built-in Fixture", "kind": "builtin"}]
        catalogue = build_catalogue(self.root, builtins=builtins)
        self.assertEqual(catalogue["widgets"][0]["name"], "Built-in Fixture")
        self.assertEqual(catalogue["counts"], {"builtins": 1, "tools": 0})
        self.assertEqual(catalogue["quarantined"][0]["reason"], "built-in default kept")

    def test_missing_root_fails_closed(self):
        with self.assertRaises(ContractError):
            discover_catalogue(self.root / "missing")

    def test_revision_is_stable_and_content_bound(self):
        _make_package(self.root, "fixture-tool", VALID_HOME)
        first = discover_catalogue(self.root)["widgets"][0]["revision"]
        second = discover_catalogue(self.root)["widgets"][0]["revision"]
        self.assertEqual(first, second)
        changed = dict(VALID_HOME, blurb="Changed blurb.")
        _make_package(self.root, "fixture-tool", changed)
        third = discover_catalogue(self.root)["widgets"][0]["revision"]
        self.assertNotEqual(first, third)


if __name__ == "__main__":
    unittest.main()
