import importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("support_folder",Path(__file__).resolve().parents[1]/"bin"/"configure-support-folder.py")
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Tests(unittest.TestCase):
 def test_adds_only_missing_support_child(self):
  original=[{"name":"imap-1","folder_name":"INBOX","append_to":"Communication","uidvalidity":42}]
  actual,changed=module.reconcile(original)
  self.assertTrue(changed); self.assertEqual(actual[0],original[0]); self.assertEqual(actual[1],{"folder_name":"Support","append_to":"HD Ticket"})
 def test_replay_preserves_native_child_rows(self):
  rows=[{"name":"imap-1","folder_name":"INBOX","append_to":"Communication"},{"name":"imap-2","folder_name":"Support","append_to":"HD Ticket","last_uid":9}]
  actual,changed=module.reconcile(rows); self.assertFalse(changed); self.assertEqual(actual,rows)
 def test_conflicts_and_duplicates_are_refused(self):
  with self.assertRaises(module.SupportFolderError): module.reconcile([{"folder_name":"Support","append_to":"Communication"}])
  with self.assertRaises(module.SupportFolderError): module.reconcile([{"folder_name":"Support","append_to":"HD Ticket"}]*2)
if __name__=="__main__": unittest.main()
