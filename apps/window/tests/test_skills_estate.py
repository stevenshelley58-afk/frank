"""Skills inventory, staging, and provider tests (isolated roots only)."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from infra.skills.inventory import inventory_root
from infra.skills.provider import provider_snapshot, read_skill_source
from infra.skills.staging import (
    StagingError,
    build_staging_tree,
    emit_cutover_scripts,
    validate_staging_tree,
)


def _make_skill(root: Path, dirname: str, name: str, description: str = "does things", *, ref: str | None = None):
    skill_dir = root / dirname
    skill_dir.mkdir(parents=True)
    front = f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n"
    if ref:
        front += f"See {ref} for details.\n"
        (skill_dir / ref).write_text("referenced", encoding="utf-8")
    (skill_dir / "SKILL.md").write_text(front, encoding="utf-8")
    return skill_dir


class InventoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "skills"

    def tearDown(self):
        self.temp.cleanup()

    def test_operator_and_runtime_owned_classification(self):
        _make_skill(self.root, "ad-writer", "ad-writer")
        _make_skill(self.root, ".system", "system-internal")
        result = inventory_root(self.root)
        by_name = {s["name"]: s for s in result["skills"]}
        self.assertEqual(by_name["ad-writer"]["classification"], "operator")
        self.assertEqual(by_name["system-internal"]["classification"], "runtime-owned")
        self.assertEqual(by_name["ad-writer"]["validation"], "valid")

    def test_invalid_frontmatter_and_broken_reference_marked_error(self):
        bad = self.root / "bad-front"
        bad.mkdir(parents=True)
        (bad / "SKILL.md").write_text("no frontmatter here", encoding="utf-8")
        _make_skill(self.root, "broken-ref", "broken-ref", ref="helper.md")
        (self.root / "broken-ref" / "helper.md").unlink()
        result = inventory_root(self.root)
        by_name = {s["name"]: s for s in result["skills"]}
        self.assertEqual(by_name["bad-front"]["validation"], "error")
        self.assertIn("frontmatter", by_name["bad-front"]["validation_detail"])
        self.assertEqual(by_name["broken-ref"]["validation"], "error")
        self.assertIn("unreadable reference", by_name["broken-ref"]["validation_detail"])

    def test_same_name_collision_quarantined_production_version_preserved(self):
        _make_skill(self.root, "ad-writer-hermes", "ad-writer")
        production = _make_skill(self.root, "ad-writer-prod", "ad-writer")
        result = inventory_root(
            self.root, production_active_names={"ad-writer"}
        )
        # The production-active one is marked via provenance by the caller mapping;
        # here both collide in one root, so the first is kept and the other quarantined.
        collisions = [s for s in result["skills"] if s["collision_with"]]
        self.assertEqual(len(collisions), 1)
        self.assertIn("never merged", collisions[0]["validation_detail"])
        self.assertTrue(production.exists())  # folders never merged or deleted

    def test_symlinked_skill_dir_skipped(self):
        real = _make_skill(self.root, "real", "real")
        import os
        os.symlink(real, self.root / "link")
        result = inventory_root(self.root)
        self.assertEqual([s["path"] for s in result["skills"]], ["real"])

    def test_nested_skill_directories_discovered(self):
        _make_skill(self.root, "github/github-issues", "github-issues")
        _make_skill(self.root, "research/deep/arxiv", "arxiv")
        result = inventory_root(self.root)
        by_name = {s["name"]: s for s in result["skills"]}
        self.assertEqual(by_name["github-issues"]["path"], "github/github-issues")
        self.assertEqual(by_name["github-issues"]["validation"], "valid")
        self.assertEqual(by_name["arxiv"]["path"], "research/deep/arxiv")

    def test_runtime_owned_category_excluded_at_any_depth(self):
        _make_skill(self.root, ".system/packaged", "packaged-internal")
        result = inventory_root(self.root)
        self.assertEqual(result["skills"][0]["classification"], "runtime-owned")

    def test_empty_root_reports_empty_inventory(self):
        self.root.mkdir(parents=True)
        result = inventory_root(self.root)
        self.assertEqual(result["skills"], [])
        missing = inventory_root(self.root / "nope")
        self.assertEqual(missing["skills"], [])


class StagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.source = base / "hermes-skills"
        _make_skill(self.source, "ad-writer", "ad-writer")
        _make_skill(self.source, ".system-internal", "system-internal")
        _make_skill(self.source, "broken", "broken")
        (self.source / "broken" / "SKILL.md").write_text("broken", encoding="utf-8")
        self.inventories = [inventory_root(self.source)]
        self.staging = base / "skills.next.test-release"

    def tearDown(self):
        self.temp.cleanup()

    def test_staging_includes_valid_operator_only(self):
        catalog = build_staging_tree(self.staging, self.inventories)
        self.assertEqual([i["name"] for i in catalog["included"]], ["ad-writer"])
        excluded_names = {e["name"] for e in catalog["excluded"]}
        self.assertIn("system-internal", excluded_names)
        self.assertIn("broken", excluded_names)
        validation = validate_staging_tree(self.staging)
        self.assertTrue(validation["ok"])
        self.assertEqual(validation["consumers"], ["hermes", "codex-vps"])

    def test_duplicate_names_quarantined_in_staging(self):
        other = Path(self.temp.name) / "codex-skills"
        _make_skill(other, "ad-writer-copy", "ad-writer")
        catalog = build_staging_tree(self.staging, self.inventories + [inventory_root(other)])
        self.assertEqual([i["name"] for i in catalog["included"]], ["ad-writer"])
        duplicate = next(e for e in catalog["excluded"] if e["name"] == "ad-writer")
        self.assertEqual(duplicate["reason"], "duplicate name in staging")

    def test_project_scoped_skill_enters_with_scope_metadata(self):
        project_skill = _make_skill(Path(self.temp.name), "widget-builder", "widget-builder")
        catalog = build_staging_tree(
            self.staging, self.inventories,
            extra_operator_skills=[{"name": "widget-builder", "source_path": str(project_skill), "scope": "project", "project": "blockwise"}],
        )
        self.assertIn("widget-builder", [i["name"] for i in catalog["included"]])
        scope = json.loads((self.staging / "widget-builder" / ".frank-skill-scope.json").read_text())
        self.assertEqual(scope, {"scope": "project", "project": "blockwise"})
        validate_staging_tree(self.staging)

    def test_staging_requires_fresh_release_path(self):
        build_staging_tree(self.staging, self.inventories)
        with self.assertRaises(StagingError):
            build_staging_tree(self.staging, self.inventories)

    def test_cutover_scripts_are_emitted_for_session_1(self):
        build_staging_tree(self.staging, self.inventories)
        validation = validate_staging_tree(self.staging)
        scripts_dir = Path(self.temp.name) / "cutover"
        result = emit_cutover_scripts(self.staging, scripts_dir)
        self.assertEqual(result["catalog_checksum"], validation["catalog_checksum"])
        for name in result["scripts"]:
            script = scripts_dir / name
            self.assertTrue(script.is_file())
            self.assertIn("set -euo pipefail", script.read_text())
            subprocess.run(["bash", "-n", str(script)], check=True)
        self.assertIn("/srv/skills", (scripts_dir / "promote_skills_cutover.sh").read_text())
        self.assertIn("rollback", (scripts_dir / "rollback_skills_cutover.sh").read_text())
        self.assertIn("parity", (scripts_dir / "check_checksum_parity.sh").read_text())


class ProviderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_states_ready_empty_unavailable(self):
        missing = provider_snapshot(self.base / "nope")
        self.assertEqual(missing["state"], "unavailable")
        empty = provider_snapshot(self.base)
        self.assertEqual(empty["state"], "empty")
        source = Path(self.temp.name) / "src"
        _make_skill(source, "ad-writer", "ad-writer", description="writes ads")
        staging = self.base / "canonical"
        build_staging_tree(staging, [inventory_root(source)])
        ready = provider_snapshot(staging)
        self.assertEqual(ready["state"], "ready")
        self.assertEqual(ready["source_truth"], "filesystem")
        self.assertEqual(ready["skills"][0]["description"], "writes ads")

    def test_missing_canonical_skill_is_stale_not_fake(self):
        source = Path(self.temp.name) / "src"
        _make_skill(source, "ad-writer", "ad-writer")
        staging = self.base / "canonical"
        build_staging_tree(staging, [inventory_root(source)])
        (staging / "ad-writer" / "SKILL.md").unlink()
        snapshot = provider_snapshot(staging)
        self.assertEqual(snapshot["state"], "stale")
        self.assertEqual(snapshot["skills"][0]["validation"], "error")

    def test_read_skill_source_is_bounded_and_safe(self):
        source = Path(self.temp.name) / "src"
        _make_skill(source, "ad-writer", "ad-writer")
        staging = self.base / "canonical"
        build_staging_tree(staging, [inventory_root(source)])
        view = read_skill_source(staging, "ad-writer/SKILL.md")
        self.assertIn("ad-writer", view["text"])
        self.assertFalse(view["truncated"])
        with self.assertRaises(ValueError):
            read_skill_source(staging, "../escape/SKILL.md")
        with self.assertRaises(ValueError):
            read_skill_source(staging, "ad-writer/../../etc/passwd")
        (staging / "ad-writer" / "evil.sh").write_text("rm -rf /", encoding="utf-8")
        with self.assertRaises(ValueError):
            read_skill_source(staging, "ad-writer/evil.sh")


if __name__ == "__main__":
    unittest.main()
