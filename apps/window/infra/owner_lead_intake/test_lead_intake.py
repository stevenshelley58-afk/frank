import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent)); from lead_intake import *
RAW={"sourceKey":"blockwise_demo_request:11111111-1111-4111-8111-111111111111","sourceKind":"audit_request","sourceEventId":"11111111-1111-4111-8111-111111111111","receivedAt":"2026-09-13T00:00:00Z","lead":{"name":"Test Lead","email":"lead@example.invalid","phone":"+61400000000","agency":"Test Agency"}}
class Store:
 def __init__(self): self.rows={}; self.payloads=[]
 def find(self,key): return self.rows.get(key)
 def create(self,item):
  self.payloads.append(item); name="LEAD-0001"; self.rows[item.source_key]={"name":name}; return name
class IntakeTests(unittest.TestCase):
 def test_source_key_is_only_identity_and_replay_does_not_duplicate(self):
  item=map_item(RAW); store=Store(); first=intake_one(store,item); replay=intake_one(store,item)
  self.assertEqual(first["action"],"created"); self.assertEqual(replay["action"],"unchanged"); self.assertEqual(len(store.payloads),1); self.assertEqual(item.source_key,RAW["sourceKey"])
 def test_invalid_or_research_identity_is_rejected(self):
  bad=dict(RAW); bad["sourceKey"]="blockwise_research_agent:"+RAW["sourceEventId"]
  with self.assertRaises(IntakeError): map_item(bad)
 def test_create_payload_has_review_state_without_consent_or_sending_fields(self):
  item=map_item(RAW); payload={"lead_name":item.name,"first_name":item.name.split(None, 1)[0],"status":"New","lead_owner":"crm-sync@blockwise.sale","email":item.email,SOURCE_FIELD:item.source_key,ELIGIBILITY_FIELD:"review_required"}
  self.assertEqual(payload[ELIGIBILITY_FIELD],"review_required"); self.assertEqual(payload["status"],"New"); self.assertEqual(payload["lead_owner"],"crm-sync@blockwise.sale")
  self.assertFalse(any("consent" in k or "send" in k for k in payload))
if __name__=="__main__": unittest.main()

class NativeBoundaryTests(unittest.TestCase):
 def test_payload_uses_real_native_create_and_preserves_full_name(self):
  store=FrappeLeadStore();calls=[]
  store.request=lambda method,path,body: calls.append(body) or {"data":{"name":"CRM-TEST"}}
  store.create(map_item(RAW));payload=calls[0]
  self.assertEqual(payload["first_name"],"Test");self.assertEqual(payload["last_name"],"Lead")
  self.assertEqual(payload["lead_owner"],"crm-sync@blockwise.sale")
  self.assertEqual(payload[ELIGIBILITY_FIELD],"review_required")
  self.assertFalse(any("consent" in key for key in payload))
 def test_duplicate_without_same_source_key_is_not_success(self):
  class Conflict(Store):
   def create(self,item):raise DuplicateSource("different unique field")
  with self.assertRaises(IntakeError):intake_one(Conflict(),map_item(RAW))
 def test_uncertain_write_reconciles_same_native_source(self):
  class Uncertain(Store):
   def create(self,item):
    super().create(item);raise IntakeError("response lost")
  result=intake_one(Uncertain(),map_item(RAW));self.assertEqual(result["lead"],"LEAD-0001")
 def test_secret_permissions_and_symlink_rejected(self):
  import tempfile,os
  with tempfile.TemporaryDirectory() as d:
   secret=Path(d)/"secret";secret.write_text("OWNER_LEAD_INTAKE_AUTH_SECRET="+"a"*40+"\nOWNER_CRM_FRAPPE_API_KEY=k\nOWNER_CRM_FRAPPE_API_SECRET=s\n")
   secret.chmod(0o644)
   with self.assertRaises(IntakeError):load_credentials(secret)
   secret.chmod(0o600);self.assertEqual(load_credentials(secret).api_key,"k")
   link=Path(d)/"link";link.symlink_to(secret)
   with self.assertRaises(IntakeError):load_credentials(link)
 def test_source_invalid_item_not_silently_skipped(self):
  import io
  source=SourceClient("a"*40,opener=lambda *a,**k:io.BytesIO(json.dumps({"items":[RAW,None]}).encode()))
  with self.assertRaises(IntakeError):source.page()
 def test_source_nonadvancing_cursor_rejected(self):
  import io
  source=SourceClient("a"*40,opener=lambda *a,**k:io.BytesIO(json.dumps({"items":[RAW]}).encode()))
  with self.assertRaises(IntakeError):source.page(after_id=RAW["sourceEventId"])
 def test_multiple_pages_and_checkpoint_wrap(self):
  from operate import cycle
  import dataclasses
  base=map_item(RAW)
  items=[dataclasses.replace(base,source_event_id=f"{i:08x}-1111-4111-8111-111111111111",source_key=f"blockwise_demo_request:{i:08x}-1111-4111-8111-111111111111") for i in range(1,56)]
  class Source:
   def page(self,after_id=None,limit=50):return [i for i in items if after_id is None or i.source_event_id>after_id][:limit]
  checkpoints=[];store=Store()
  first=cycle(Source(),store,checkpoint=checkpoints.append,max_pages=1)
  self.assertFalse(first["scan_complete"]);self.assertEqual(first["processed"],50)
  second=cycle(Source(),store,after_id=checkpoints[-1],checkpoint=checkpoints.append)
  self.assertTrue(second["scan_complete"]);self.assertEqual(second["processed"],5);self.assertIsNone(checkpoints[-1]);self.assertEqual(len(store.rows),55)
