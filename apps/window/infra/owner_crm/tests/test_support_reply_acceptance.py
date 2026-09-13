import importlib.util
from pathlib import Path
import sys, unittest, json
ROOT=Path(__file__).parent;sys.path.insert(0,str(ROOT.parent.parent/'owner_crm_setup'))
s=importlib.util.spec_from_file_location("support",ROOT.parent/'bin'/'support-reply-acceptance.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class T(unittest.TestCase):
 def test_constants_are_fixed_and_safe(self):
  self.assertEqual((m.TICKET,m.PARENT,m.RECIPIENT),("0003","9lvbn08rlv","blockwise@purelymail.com"))
 def test_send_uses_native_doc_method_with_exact_args(self):
  class A:
   def _request(self,*x,**k): self.x=x;self.k=k;return {}
  a=A();m.send(a,"marker");self.assertEqual(a.x,("POST","/api/method/run_doc_method"));self.assertEqual(json.loads(a.k["body"]["args"])["to"],m.RECIPIENT)
 def test_source_is_execution_gated(self):
  source=(ROOT.parent/'bin'/'support-reply-acceptance.py').read_text();self.assertIn('"--execute"',source);self.assertIn('native_reply_email_disabled',source)
if __name__=="__main__":unittest.main()
