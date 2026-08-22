import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest


APP = Path(__file__).resolve().parents[1]
INFRA = APP / "infra" / "memory"


def load_configure():
    spec = importlib.util.spec_from_file_location("hindsight_configure", INFRA / "configure.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


configure_module = load_configure()


class HindsightMemoryInfraTests(unittest.TestCase):
    def test_tracked_contract_is_native_project_scoped_and_secret_free(self):
        config = json.loads((INFRA / "hindsight-config.json").read_text(encoding="utf-8"))
        self.assertEqual(config["mode"], "local_embedded")
        self.assertEqual(config["bank_id"], "steven-unassigned")
        self.assertEqual(config["bank_id_template"], "steven-{workspace}")
        self.assertTrue(config["auto_recall"])
        self.assertTrue(config["auto_retain"])
        self.assertNotIn("agent_workspace", json.dumps(config))
        self.assertNotIn("DEEPSEEK_API_KEY", json.dumps(config))
        self.assertNotIn("HINDSIGHT_LLM_API_KEY", json.dumps(config))

    def test_configure_derives_provider_secret_without_changing_source_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            env = home / ".env"
            env.write_text("UNCHANGED=value\nDEEPSEEK_API_KEY=secret-value\n", encoding="utf-8")
            os.chmod(env, 0o600)
            config_path, env_path = configure_module.configure(INFRA / "hindsight-config.json", home)

            installed = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(installed["bank_id_template"], "steven-{workspace}")
            self.assertEqual(
                env_path.read_text(encoding="utf-8"),
                "UNCHANGED=value\nDEEPSEEK_API_KEY=secret-value\nHINDSIGHT_LLM_API_KEY=secret-value\n",
            )
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(config_path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(env_path.stat().st_mode), 0o600)

    def test_deploy_uses_one_provider_and_no_static_runtime_workspace(self):
        deploy = (INFRA / "deploy.sh").read_text(encoding="utf-8")
        check = (INFRA / "check.sh").read_text(encoding="utf-8")
        self.assertIn("config set memory.provider hindsight", deploy)
        self.assertIn('hindsight-all==0.6.1', deploy)
        self.assertIn('hindsight-client==0.6.1', deploy)
        self.assertIn('hindsight-embed==0.6.1', deploy)
        self.assertNotIn("agent_workspace=", deploy)
        self.assertIn('steven-{workspace}', check)

    def test_frank_inspector_bridge_is_private_and_has_no_memory_runtime(self):
        expose = (INFRA / "expose.sh").read_text(encoding="utf-8")
        socket = (INFRA / "hindsight-frank-proxy.socket").read_text(encoding="utf-8")
        service = (INFRA / "hindsight-frank-proxy.service").read_text(encoding="utf-8")
        self.assertIn("172.16.1.1:9178", socket)
        self.assertIn("127.0.0.1:9177", service)
        self.assertIn("systemd-socket-proxyd", service)
        self.assertIn("/health", expose)
        self.assertIn("systemctl stop hindsight-frank-proxy.service", expose)
        self.assertIn("systemctl restart hindsight-frank-proxy.socket", expose)
        self.assertNotIn("docker ", expose)
        self.assertNotIn("hindsight-api", service)


if __name__ == "__main__":
    unittest.main()
