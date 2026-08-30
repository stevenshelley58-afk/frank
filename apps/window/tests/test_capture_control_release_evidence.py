import json, subprocess, sys, tempfile, unittest
from pathlib import Path
MANDATORY={"projection:vps/world","projection:frank/architecture","projection:blockwise/runtime","projection:mini-frank/knowledge-flow","projection:ad-template-builder/architecture","projection:ad-template-builder/workflow"}
SCRIPT=Path(__file__).parents[1]/"scripts"/"capture_control_release_evidence.py"
class CaptureTests(unittest.TestCase):
 def test_happy_deterministic_read_only_bundle(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d); maps={k:{"manifest_hash":"sha256:"+"a"*64} for k in MANDATORY}; (root/"current.json").write_text(json.dumps({"graph_revision":"sha256:"+"b"*64,"maps":maps})); browser=root/"receipt.json"; browser.write_text('{"id":"receipt:test"}')
   args=[sys.executable,str(SCRIPT),"--root",str(root),"--approved-sha","a"*40,"--rollback-target","b"*40,"--image-digest","sha256:"+"c"*64,"--browser-receipt",str(browser)]
   one=subprocess.run(args,capture_output=True,text=True); two=subprocess.run(args,capture_output=True,text=True)
   self.assertEqual(one.returncode,0); self.assertEqual(one.stdout,two.stdout); self.assertFalse((root/"current.json").stat().st_mtime==0)
 def test_missing_projection_and_secret_fail_closed(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d); (root/"current.json").write_text(json.dumps({"graph_revision":"sha256:"+"b"*64,"maps":{}})); b=root/"b"; b.write_text('secret=bad')
   r=subprocess.run([sys.executable,str(SCRIPT),"--root",str(root),"--approved-sha","a"*40,"--rollback-target","b"*40,"--image-digest","sha256:"+"c"*64,"--browser-receipt",str(b)],capture_output=True,text=True)
   self.assertEqual(r.returncode,1); self.assertIn("evidence_rejected",r.stdout)
if __name__=='__main__': unittest.main()
