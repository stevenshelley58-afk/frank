import importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('prune',Path(__file__).with_name('prune.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Rules(unittest.TestCase):
 def test_only_draft_rasters(self):
  for p in ['iterations/01/rendered/feed.png','previews/iteration-01-feed-difference.png','reusable-validation/01-max/rendered/feed.png']:self.assertTrue(m.eligible(Path(p),3))
 def test_protected(self):
  for p in ['iterations/03/rendered/feed.png','previews/iteration-03-story.png','final/rendered/feed.png','final-review-production-03/feed.png','demo-assets/photo.png','references/source.png','iterations/01/artifact.json','exact-clone-checkpoint.json']:self.assertFalse(m.eligible(Path(p),3))
 def test_symlinks_fail(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'link').symlink_to('/tmp');self.assertRaises(RuntimeError,m.plan,p,3)
if __name__=='__main__':unittest.main()
