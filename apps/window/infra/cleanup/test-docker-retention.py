import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('retention',Path(__file__).with_name('docker-runtime-retention.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Retention(unittest.TestCase):
 def test_versions_live_selector_and_unowned(self):
  images=[{'Created':str(i),'RepoTags':['blockwise-homepage-preview:'+str(i)],'Id':str(i)} for i in range(6)]
  self.assertEqual(m.select(images,{'0'},'1'),['blockwise-homepage-preview:2','blockwise-homepage-preview:3'])
  images.append({'Created':'0','RepoTags':['postgres:old'],'Id':'p'})
  self.assertNotIn('postgres:old',m.select(images,set(),''))
 def test_same_image_tags_count_as_one_version(self):
  images=[{'Created':str(i),'RepoTags':['blockwise-homepage-preview:'+str(i)],'Id':str(i)} for i in range(3)]
  images[-1]['RepoTags'].append('blockwise-homepage-preview:current')
  self.assertEqual(m.select(images,set(),''),['blockwise-homepage-preview:0'])
if __name__=='__main__': unittest.main()
