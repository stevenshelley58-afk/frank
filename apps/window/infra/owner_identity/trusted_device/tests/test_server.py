import importlib.util,pathlib,unittest
SOURCE=pathlib.Path(__file__).parents[1]/"server.py";SPEC=importlib.util.spec_from_file_location("trusted_device_server",SOURCE);server=importlib.util.module_from_spec(SPEC);assert SPEC.loader is not None;SPEC.loader.exec_module(server)
CONFIG=server.Config("gate","proof",(server.Device("n6HvGtfdy221CNTRL","6781099988612671","laptop"),));RECORD={"Node":{"StableID":"n6HvGtfdy221CNTRL","User":"6781099988612671"},"UserProfile":{"ID":"6781099988612671"}}
class TrustedDeviceTests(unittest.TestCase):
 def test_allowed(self):self.assertEqual(server.trusted_proof(CONFIG,"100.100.100.1",lambda _ip:RECORD),"proof")
 def test_spoof(self):self.assertIsNone(server.trusted_proof(CONFIG,"203.0.113.7",lambda _ip:self.fail("lookup")))
 def test_missing(self):self.assertIsNone(server.trusted_proof(CONFIG,"100.100.100.1",lambda _ip:{"Node":{}}))
 def test_revoked(self):self.assertIsNone(server.trusted_proof(server.Config("gate","proof",()),"100.100.100.1",lambda _ip:RECORD))
 def test_unapproved(self):self.assertIsNone(server.trusted_proof(CONFIG,"100.100.100.1",lambda _ip:{**RECORD,"UserProfile":{"ID":"other-user"}}))
 def test_failure(self):self.assertIsNone(server.trusted_proof(CONFIG,"100.100.100.1",lambda _ip:(_ for _ in ()).throw(TimeoutError())))
 def test_invalid_literal(self):self.assertIsNone(server.validated_tailnet_address("100.100.100.1:443"));self.assertIsNone(server.validated_tailnet_address("not-an-ip"))
