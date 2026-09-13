import unittest
from owner_layout import reconcile,SECTIONS
class LayoutTests(unittest.TestCase):
 def test_replay_and_unrelated_sections(self):
  old=[{'name':'manual_section','columns':[]}];out=reconcile(old,SECTIONS['Contact']);self.assertEqual(out[0],old[0]);self.assertEqual(reconcile(out,SECTIONS['Contact']),out)
 def test_ambiguous_duplicate_rejected(self):
  with self.assertRaises(RuntimeError):reconcile([{'name':'blockwise_outreach'},{'name':'blockwise_outreach'}],SECTIONS['CRM Lead'])
if __name__=='__main__':unittest.main()
