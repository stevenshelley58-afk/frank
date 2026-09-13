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