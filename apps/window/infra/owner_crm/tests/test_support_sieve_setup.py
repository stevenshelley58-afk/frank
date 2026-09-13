import unittest
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[2]/"owner_marketing"/"support_sieve_setup.sh"
class Tests(unittest.TestCase):
 def test_source_preserves_reply_copy_then_moves_support(self):
  text=SCRIPT.read_text(); self.assertIn('fileinto :copy "Mautic Replies"',text); self.assertIn('address :is "to" "support@blockwise.sale"',text); self.assertIn('fileinto "Support";\n  stop;',text); self.assertLess(text.index('fileinto :copy "Mautic Replies"'),text.index('fileinto "Support"'))
 def test_source_refuses_unknown_owned_script_and_backs_up_before_upload(self):
  text=SCRIPT.read_text(); self.assertIn('owned-script-drift-refusing-to-overwrite',text); self.assertLess(text.index('install -o root -g root -m 0600'),text.index('--remotesieve "$script" --upload'))
 def test_source_checks_folder_before_any_activation_and_reply_setup_refuses_drift(self):
  text=SCRIPT.read_text(); self.assertIn('native-imap-support-folder-unavailable',text); self.assertLess(text.index('native-imap-support-folder-unavailable'),text.index('--remotesieve "$script" --activate'))
  reply=(SCRIPT.parent/"reply_setup.sh").read_text(); self.assertIn('existing-owned-sieve-script-differs-refusing-to-replace',reply)
if __name__=="__main__":unittest.main()
