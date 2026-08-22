from pathlib import Path
import unittest


INFRA = Path(__file__).resolve().parents[1] / "infra" / "knowledge"


class ProjectKnowledgeInfraTests(unittest.TestCase):
    def test_codewiki_is_pinned_and_runs_as_a_native_batch_generator(self):
        deploy = (INFRA / "deploy.sh").read_text(encoding="utf-8")
        generate = (INFRA / "generate.sh").read_text(encoding="utf-8")
        readme = (INFRA / "README.md").read_text(encoding="utf-8")

        self.assertIn("00138da6ab25f0b0aad58d42c74a97d78b6547a7", deploy)
        self.assertIn("FSoft-AI4Code/CodeWiki.git@$codewiki_revision", deploy)
        self.assertIn("--provider codex", deploy)
        self.assertIn('python3.12', deploy)
        self.assertIn('-m pip install', deploy)
        self.assertNotIn("docker", deploy.lower())
        self.assertIn('repo="/projects/$slug"', generate)
        self.assertIn("git clone --quiet --no-hardlinks", generate)
        self.assertIn('knowledge_root="/srv/frank/data/window/knowledge"', generate)
        self.assertIn("--doc-type architecture", generate)
        self.assertIn("Mermaid architecture, data-flow, and sequence diagrams", generate)
        self.assertIn("never requires a local Docker runtime", readme)


if __name__ == "__main__":
    unittest.main()
