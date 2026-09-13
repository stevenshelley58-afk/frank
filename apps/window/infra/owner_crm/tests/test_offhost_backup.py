import pathlib, unittest
p=pathlib.Path(__file__).parents[1]/"bin/offhost-backup.sh"
class T(unittest.TestCase):
 def test_fail_closed(self):
  s=p.read_text(); self.assertIn("--offhost",s); self.assertIn("OWNER_BACKUP_OFFHOST_ENABLED",s); self.assertIn("RESTIC_REPOSITORY",s); self.assertIn("restic backup",s); self.assertNotIn("forget --prune",s)
if __name__ == "__main__": unittest.main()
