import hashlib,importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('retention',Path(__file__).with_name('retain-two.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RetentionTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def backup(self,n,valid=True):
  p=self.root/f'202601{n:02}T000000Z';p.mkdir();(p/'database.dump').write_bytes(str(n).encode());h=hashlib.sha256(str(n).encode()).hexdigest();(p/'SHA256SUMS').write_text(f'{h}  database.dump\n')
  if not valid:(p/'database.dump').write_bytes(b'bad')
  return p
 def test_keep_two_and_dryrun(self):
  for n in range(1,5):self.backup(n)
  out=m.run_series(self.root,m.STAMP,'manifest');self.assertEqual(len(out['planned']),2);self.assertEqual(len(list(self.root.iterdir())),4)
  original=m.protected_paths;m.protected_paths=lambda:[]
  try:out=m.run_series(self.root,m.STAMP,'manifest',True)
  finally:m.protected_paths=original
  self.assertEqual(len(out['deleted']),2);self.assertEqual(len(list(self.root.iterdir())),2)
 def test_bad_newest_kept_and_two_good_kept(self):
  for n in range(1,4):self.backup(n,n!=3)
  out=m.run_series(self.root,m.STAMP,'manifest');self.assertEqual(out['planned'],[]);self.assertEqual(len(out['invalid_retained']),1)
 def test_incomplete_and_unrelated_kept(self):
  for n in range(1,4):self.backup(n)
  (self.root/'.incomplete').mkdir();(self.root/'unrelated').mkdir();out=m.run_series(self.root,m.STAMP,'manifest');self.assertEqual(len(out['planned']),1)
 def test_mounted_ancestor_protected(self):
  for n in range(1,4):self.backup(n)
  out=m.run_series(self.root,m.STAMP,'manifest',refs=[{'path':str(self.root),'ancestor':True}]);self.assertEqual(out['planned'],[])
 def test_symlink_refused(self):
  p=self.backup(1);(p/'bad').symlink_to('/etc/passwd')
  with self.assertRaises(ValueError):m.validate(p,'manifest')
 def test_manifest_traversal_refused(self):
  p=self.backup(1);(p/'SHA256SUMS').write_text('0'*64+'  ../outside\n')
  with self.assertRaises(ValueError):m.validate(p,'manifest')
 def test_changed_coverage_kept(self):
  for n in range(1,4):self.backup(n)
  p=self.root/'20260101T000000Z';(p/'extra').write_bytes(b'x');h=hashlib.sha256(b'x').hexdigest();f=p/'SHA256SUMS';f.write_text(f.read_text()+f'{h}  extra\n')
  self.assertEqual(m.run_series(self.root,m.STAMP,'manifest')['planned'],[])
 def test_router_keeps_two_valid_complete_copies(self):
  import json
  for n in range(1,5):(self.root/f'router-before-2026010{n}T000000Z.json').write_text(json.dumps({'routes':n}))
  original=m.protected_paths;m.protected_paths=lambda:[]
  try:out=m.run_router_backups(True,self.root)
  finally:m.protected_paths=original
  self.assertEqual(len(out['deleted']),2)
  self.assertEqual(len(list(self.root.iterdir())),2)
if __name__=='__main__':unittest.main()
