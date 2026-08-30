import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1] / "infra" / "runtime_monitoring"


class RuntimeMonitoringPromotionTests(unittest.TestCase):
    def test_definition_is_isolated_and_hardened(self):
        doc = yaml.safe_load((ROOT / "beszel-compose.yml").read_text())
        self.assertEqual(doc["services"]["beszel"]["profiles"], ["step4b-isolated"])
        for name in ("beszel", "beszel-agent"):
            svc = doc["services"][name]
            self.assertTrue(svc["read_only"])
            self.assertEqual(svc["cap_drop"], ["ALL"])
            self.assertIn("mem_limit", svc)
        self.assertTrue(doc["networks"]["beszel_internal"]["internal"])

    def test_operator_scripts_require_explicit_activation_and_support_rollback(self):
        promote = (ROOT / "promote.sh").read_text()
        self.assertIn("--profile step4b-isolated up -d", promote)
        self.assertIn("FRANK_RELEASE_SHA", promote)
        self.assertIn("BLOCKWISE_RELEASE_SHA", promote)
        self.assertIn("/srv/frank/secrets", promote)
        rollback = (ROOT / "rollback.sh").read_text()
        self.assertIn("down --remove-orphans", rollback)


if __name__ == "__main__":
    unittest.main()
