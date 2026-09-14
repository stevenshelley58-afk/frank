import importlib.util, os, sys, unittest
from pathlib import Path
from unittest.mock import patch
SCRIPT=Path(__file__).parents[1]/"infra/owner_identity/bin/provision-trusted-device.py"
class Tests(unittest.TestCase):
 def load(self):
  os.environ.setdefault("OWNER_IDENTITY_BOOTSTRAP_TOKEN", "test-token")
  sys.path.insert(0,str(SCRIPT.parent)); spec=importlib.util.spec_from_file_location("trusted",SCRIPT); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
 def test_hash_compare_seed_and_guard(self):
  seed,skip,login=self.load().expressions("a"*64)
  self.assertIn("hmac.compare_digest",seed); self.assertIn("sha256(supplied.encode",seed); self.assertIn('flow_plan.context["pending_user"]=owner',seed); self.assertIn("seeded_uid",skip); self.assertIn("valid_proof()",login); self.assertNotIn("proof_secret",seed+skip+login)
 def test_invalid_hash_fails_closed(self):
  with patch.dict(os.environ,{"OWNER_TRUSTED_DEVICE_PROOF_SHA256":"bad"},clear=True):
   with self.assertRaises(SystemExit): self.load().proof_hash()
 def test_stock_guards_and_local_hashing(self):
  s=SCRIPT.read_text(); self.assertIn('set_all(password,"password")',s); self.assertIn('set_all(mfa,"MFA")',s); self.assertIn('set_all(user_login,"User Login")',s); self.assertIn('attach(password,skip,"password",True)',s); self.assertIn('attach(mfa,skip,"MFA",True)',s); self.assertIn('attach(user_login,login,"User Login",False)',s)
  w=SCRIPT.with_suffix(".sh").read_text(); self.assertIn("hashlib.sha256",w); self.assertIn("OWNER_IDENTITY_SOURCE_SHA",w); self.assertNotIn('-e "proof_secret=',w); self.assertIn("test ! -L",w)
 def test_native_connect_preserves_original_uri_until_auth(self):
  caddy=(SCRIPT.parents[3]/"Caddyfile").read_text()
  block=caddy.split("handle /frank/connect {",1)[1].split("handle /frank/bridge {",1)[0]
  self.assertIn("route {",block)
  self.assertLess(block.index("import owner_identity_session_gate"),block.index("rewrite * /owner-native-bridge.html"))
