import importlib.util, os, unittest
from pathlib import Path
SPEC=importlib.util.spec_from_file_location("connector",Path(__file__).parents[1]/"connector.py")
c=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(c)
ITEM={"workspaceId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","owner":{"profileId":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","name":"Ada Owner","email":"ada@example.test"},"billingAccessState":"raw-access","stripeSubscriptionStatus":"raw-stripe","trial":{"state":"raw-trial","startedAt":"2026-01-01T00:00:00Z","endsAt":"2026-02-01T00:00:00Z"},"mappingAmbiguities":[],"sourceObservedAt":"2026-01-02T00:00:00Z"}
class ConnectorTests(unittest.TestCase):
 def setUp(self):
  self.old=dict(os.environ); os.environ.update({"HERMES_OWNER_CRM_SYNC_SNAPSHOT_URL":"http://127.0.0.1:3000/api/internal/ops/owner-crm-snapshot","HERMES_OWNER_CRM_SYNC_FRAPPE_URL":"http://127.0.0.1:18081","OWNER_CRM_SNAPSHOT_AUTH_SECRET":"x"*32,"OWNER_CRM_FRAPPE_API_KEY":"key","OWNER_CRM_FRAPPE_API_SECRET":"secret"})
 def tearDown(self): os.environ.clear(); os.environ.update(self.old)
 def test_preview_never_writes_and_does_not_match_email(self):
  old=(c.snapshot,c.lookup,c.request)
  c.snapshot=lambda *a:[ITEM]; c.lookup=lambda *a: (200,[])
  c.request=lambda *a: self.fail("preview wrote")
  r=c.run("preview"); self.assertEqual((r["created"],r["updated"],r["held"]),(1,0,0))
  c.snapshot,c.lookup,c.request=old
 def test_conflicting_immutable_ids_hold(self):
  old=(c.snapshot,c.lookup)
  c.snapshot=lambda *a:[ITEM]; c.lookup=lambda *a:(200,[{"name":"one"}] if a[2]==c.IDS[0] else [{"name":"two"}])
  r=c.run("preview"); self.assertEqual(r["held"],1)
  c.snapshot,c.lookup=old
 def test_update_carries_modified_and_readback_is_required(self):
  old=(c.snapshot,c.lookup,c.frappe_one,c.request)
  current={"name":"one","modified":"old",c.IDS[0]:ITEM["owner"]["profileId"],c.IDS[1]:ITEM["workspaceId"],"custom_blockwise_source_observed_at":"2025-01-01T00:00:00Z"}
  writes=[]; c.snapshot=lambda *a:[ITEM]; c.lookup=lambda *a:(200,[current])
  def one(*a): return (200,{**current,**(writes[-1] if writes else {})})
  c.frappe_one=one
  def req(method,url,h,payload=None):
   if method=="PUT": writes.append(payload); return 200,{} 
   return 200,{"data":{**current,**payload}}
  c.request=req
  r=c.run("apply"); self.assertEqual(r["updated"],1); self.assertEqual(writes[0]["modified"],"old"); self.assertNotIn("email_id",writes[0])
  c.snapshot,c.lookup,c.frappe_one,c.request=old
 def test_snapshot_uses_canonical_internal_auth_headers(self):
  old=c.request; got={}
  c.request=lambda method,url,headers:(got.update(headers) or (200,{"records":[]}))
  c.snapshot("http://127.0.0.1:3000/api/internal/ops/owner-crm-snapshot","x"*32)
  self.assertEqual(got["x-blockwise-scope"],"owner-crm.customer-snapshot"); self.assertRegex(got["x-blockwise-signature"],r"^[0-9a-f]{64}$")
  c.request=old
if __name__=="__main__": unittest.main()
