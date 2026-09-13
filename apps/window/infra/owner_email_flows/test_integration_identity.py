#!/usr/bin/env python3
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("identity", HERE / "provision_integration_identity.py")
identity = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = identity
spec.loader.exec_module(identity)


class IdentityTests(unittest.TestCase):
    def test_role_is_non_admin_and_has_no_delete_publish_or_send(self):
        self.assertEqual(identity.PERMISSIONS["lead:leads"], ["viewother", "create", "editother"])
        self.assertEqual(identity.PERMISSIONS["lead:lists"], ["viewother"])
        self.assertEqual(identity.PERMISSIONS["campaign:campaigns"], ["viewother"])
        self.assertEqual(identity.PERMISSIONS["email:emails"], ["viewother"])
        encoded = repr(identity.PERMISSIONS)
        self.assertNotIn("delete", encoded)
        self.assertNotIn("publish", encoded)
        self.assertNotIn("send", encoded)

    def test_native_api_list_shape_is_accepted_but_ambiguous_identity_is_not(self):
        class Api:
            def request(self, method, path):
                return {"roles": [{"id": 1, "name": "Owner email consent bridge"}]}
        self.assertEqual(identity.exact(Api(), "roles", "roles", "Owner email consent bridge")["id"], 1)
        class Ambiguous:
            def request(self, method, path):
                return {"roles": [{"id": 1, "name": "Owner email consent bridge"}, {"id": 2, "name": "Owner email consent bridge"}]}
        with self.assertRaises(RuntimeError):
            identity.exact(Ambiguous(), "roles", "roles", "Owner email consent bridge")


if __name__ == "__main__":
    unittest.main(verbosity=2)
