import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path


SOURCE = Path(__file__).with_name("private-access.py")
SPEC = importlib.util.spec_from_file_location("private_access", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PrivateAccessTests(unittest.TestCase):
    HOST = "srv.example.ts.net"

    def test_includes_native_marketing_route(self):
        self.assertEqual(MODULE.SERVICES["8447"], "http://127.0.0.1:18106")

    def test_unrelated_routes_are_preserved(self):
        config = {
            "TCP": {"8444": {"HTTPS": True}},
            "Web": {self.HOST + ":8444": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:3081"}}}},
            "AllowFunnel": {},
        }
        self.assertEqual(MODULE.other_routes(config, self.HOST), config)

    def test_valid_private_routes_do_not_invoke_commands(self):
        with patch.object(MODULE.subprocess, "check_output", side_effect=AssertionError("validation must be read-only")):
            MODULE.validate_routes({"TCP": {"8447": {"HTTPS": True}}, "Web": {self.HOST + ":8447": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:18106"}}}}}, self.HOST)
        self.assertTrue(callable(MODULE.main))

    def test_refuses_occupied_marketing_port(self):
        with self.assertRaisesRegex(RuntimeError, "TCP port is occupied"):
            MODULE.validate_routes({"TCP": {"8447": {"HTTPS": False}}}, self.HOST)

    def test_refuses_marketing_funnel(self):
        with self.assertRaisesRegex(RuntimeError, "public Funnel"):
            MODULE.validate_routes({"AllowFunnel": {self.HOST + ":8447": True}}, self.HOST)


if __name__ == "__main__":
    unittest.main()
