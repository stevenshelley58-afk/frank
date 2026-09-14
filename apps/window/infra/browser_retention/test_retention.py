import importlib.util, pathlib, tempfile, unittest, os, time
s=importlib.util.spec_from_file_location('retention',pathlib.Path(__file__).with_name('browser-profile-retention.py')); m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_overlap(self):
  self.assertTrue(m.overlaps(pathlib.Path('/a/b'),pathlib.Path('/a')))
  self.assertFalse(m.overlaps(pathlib.Path('/a/b'),pathlib.Path('/a/c')))
 def test_scope_age_and_symlinks(self):
  with tempfile.TemporaryDirectory() as d:
   m.ROOT=pathlib.Path(d);p=m.ROOT/'run-12345678-1234-1234-1234-123456789abc';p.mkdir();q=p/'data';q.write_text('x')
   self.assertIsNone(m.inspect_candidate(p,time.time()-86400,set()))
   os.utime(q,(1,1));os.utime(p,(1,1))
   self.assertIsNotNone(m.inspect_candidate(p,time.time()-86400,set()))
   self.assertIsNone(m.inspect_candidate(p,time.time(),{m.ROOT}))
   (p/'link').symlink_to('/tmp');self.assertIsNotNone(m.inspect_candidate(p,time.time()+1,set()))
 def test_names(self):
  self.assertIsNone(m.RUN.fullmatch('Default'));self.assertIsNone(m.RUN.fullmatch('run-../../'))
if __name__=='__main__': unittest.main()
