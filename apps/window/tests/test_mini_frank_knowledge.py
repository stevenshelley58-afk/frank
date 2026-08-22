from datetime import date
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest


APP = Path(__file__).resolve().parents[1]
REPO = APP.parents[1]
INFRA = APP / "infra" / "knowledge"
SEED = INFRA / "project-seeds" / "mini-frank"


def load_compiler():
    spec = importlib.util.spec_from_file_location("mini_frank_knowledge", INFRA / "mini_frank_knowledge.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


compiler = load_compiler()


class MiniFrankKnowledgeTests(unittest.TestCase):
    def test_seed_is_valid_grounded_and_within_the_reviewed_slice(self):
        project = compiler.load_project(SEED, verify_local_sources=True, repo_root=REPO)

        self.assertEqual(len(project["records"]), 20)
        self.assertGreaterEqual(len(project["sources"]), 12)
        self.assertTrue(all(record["source_refs"] for record in project["records"].values()))
        self.assertNotIn("private-client", {record["privacy"] for record in project["records"].values()})

        candidate = project["records"]["repository-shadcn-ui"]
        self.assertEqual(candidate["status"], "candidate")
        self.assertEqual(candidate["license_spdx"], "MIT")
        self.assertEqual(candidate["exact_revision"], "1773ecfeeb4a04366978d353e69b5c7ded78dcb2")
        self.assertTrue(candidate["missing_evidence"])

    def test_compiler_emits_deterministic_rebuildable_outputs_and_passes_fixture(self):
        project = compiler.load_project(SEED, verify_local_sources=True, repo_root=REPO)
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            compiler.compile_project(project, Path(first), date(2026, 8, 22))
            compiler.compile_project(project, Path(second), date(2026, 8, 22))

            names = ["catalog.json", "freshness-report.json", "relationships.json", "evaluation-results.json"]
            for name in names:
                self.assertEqual((Path(first) / name).read_bytes(), (Path(second) / name).read_bytes())

            catalog = json.loads((Path(first) / "catalog.json").read_text(encoding="utf-8"))
            self.assertEqual(catalog["record_count"], 20)
            evaluation = json.loads((Path(first) / "evaluation-results.json").read_text(encoding="utf-8"))
            self.assertTrue(evaluation["results"][0]["passed"])
            result_ids = evaluation["results"][0]["result_ids"]
            self.assertIn("architecture-responsive-small-business-dashboard", result_ids)
            self.assertIn("ui-mobile-first-dashboard", result_ids)
            self.assertIn("ui-isolated-failure-states", result_ids)
            self.assertIn("craft-reuse-before-build", result_ids)

    def test_seed_declares_runtime_projection_without_adding_a_runtime(self):
        readme = (SEED / "README.md").read_text(encoding="utf-8")
        compiler_source = (INFRA / "mini_frank_knowledge.py").read_text(encoding="utf-8")
        generator = (INFRA / "generate-mini-frank.sh").read_text(encoding="utf-8")

        self.assertIn("/projects/mini-frank", readme)
        self.assertIn("/srv/frank/data/window/knowledge/mini-frank", readme)
        self.assertIn('source_root="/projects/mini-frank"', generator)
        self.assertIn('git -C "$source_root" status --porcelain', generator)
        self.assertIn('source-revision.txt', generator)
        self.assertIn('stage_dir="$(mktemp -d "$knowledge_root/.mini-frank.stage.XXXXXX")"', generator)
        self.assertLess(generator.index('mv -- "$stage_dir/output" "$destination"'), generator.index('echo "generated: mini-frank knowledge"'))
        self.assertNotIn("flask", compiler_source.lower())
        self.assertNotIn("sqlite", compiler_source.lower())
        self.assertNotIn("requests", compiler_source.lower())

    def test_shared_compiler_rejects_private_client_records(self):
        with tempfile.TemporaryDirectory() as directory:
            copied_seed = Path(directory) / "mini-frank"
            shutil.copytree(SEED, copied_seed)
            record_path = copied_seed / "knowledge" / "layers" / "l0-craft" / "reuse-before-build.md"
            record = record_path.read_text(encoding="utf-8")
            record_path.write_text(record.replace('"privacy":"public"', '"privacy":"private-client"'), encoding="utf-8")

            with self.assertRaisesRegex(compiler.KnowledgeError, "private client records cannot enter shared knowledge"):
                compiler.load_project(copied_seed)


if __name__ == "__main__":
    unittest.main()
