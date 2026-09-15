from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1] / "dns"


class TrustedDeviceResolverTests(unittest.TestCase):
    def test_deploy_script_is_valid_and_refuses_dirty_source(self):
        subprocess.run(["bash", "-n", str(ROOT / "deploy.sh")], check=True)
        source = (ROOT / "deploy.sh").read_text()
        self.assertIn("status --porcelain", source)
        self.assertIn("tailscale ip -4", source)
        self.assertIn("dig +short", source)

    def test_resolver_binds_only_the_tailscale_address_and_answers_one_name(self):
        compose = (ROOT / "compose.yaml").read_text()
        self.assertIn('"${OWNER_TAILSCALE_ADDRESS:?required}:53:53/udp"', compose)
        self.assertNotIn('"53:53', compose)
        self.assertNotIn("0.0.0.0", compose)
        self.assertIn("auth.frank.fail", compose)
        corefile = compose[compose.index("content: |"):]
        self.assertEqual(re.findall(r"[a-z]+\.frank\.fail", corefile), ["auth.frank.fail"], "only the identity host is answered privately")
        self.assertIn("fallthrough", compose)
        self.assertIn("forward . 1.1.1.1", compose)
        self.assertIn("read_only: true", compose)
        self.assertIn("cap_drop: [ALL]", compose)
        self.assertRegex(compose, r"coredns/coredns:[0-9.]+@sha256:[0-9a-f]{64}")


if __name__ == "__main__":
    unittest.main()
