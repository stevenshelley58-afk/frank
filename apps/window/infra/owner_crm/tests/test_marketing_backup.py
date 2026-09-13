import pathlib,unittest
s=(pathlib.Path(__file__).parents[1]/'bin/marketing-backup.sh').read_text()
class T(unittest.TestCase):
 def test_explicit_native_artifacts(self):
  for x in ('mysqldump','--single-transaction','frank_owner_marketing_config','frank_owner_notifications_cache','off_host') : self.assertIn(x,s)
  self.assertNotIn('restic ',s)
if __name__=='__main__':unittest.main()
