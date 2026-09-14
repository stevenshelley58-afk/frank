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

 def test_preview_guards(self):
  c={'Name':'/blockwise-homepage-preview-abcdef0123','Created':'2020-01-01T00:00:00Z','Mounts':[],'Config':{'Labels':{'org.opencontainers.image.revision':'a'*40}}}
  self.assertIsNone(m.preview_reason(c,2000000000,{'a'*40},set()))
  self.assertIsNotNone(m.preview_reason(c,2000000000,set(),set()))
  self.assertIsNotNone(m.preview_reason(c,2000000000,{'a'*40},{'a'*40}))
  self.assertIsNotNone(m.preview_reason(c,1577836801,{'a'*40},set()))
  c['Mounts']=[{}];self.assertIsNotNone(m.preview_reason(c,2000000000,{'a'*40},set()))
  c['Mounts']=[];c['Name']='/family-tablet-preview'
  self.assertIsNotNone(m.preview_reason(c,2000000000,{'a'*40},set()))
if __name__=='__main__': unittest.main()

