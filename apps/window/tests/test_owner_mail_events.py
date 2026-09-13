import base64, hashlib, hmac, json, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import owner_mail_events as events

SECRET="whsec_"+base64.b64encode(b"test-key").decode()
EMAIL="11111111-1111-4111-8111-111111111111"
PROFILE="22222222-2222-4222-8222-222222222222"
WORKSPACE="33333333-3333-4333-8333-333333333333"

def signed(event):
 raw=json.dumps(event,separators=(",",":")).encode(); ident="msg_test"; stamp="1000"
 sig=base64.b64encode(hmac.new(b"test-key",(ident+"."+stamp+".").encode()+raw,hashlib.sha256).digest()).decode()
 return raw,{"svix-id":ident,"svix-timestamp":stamp,"svix-signature":"v1,"+sig}

class FakeHttp:
 def __init__(self,collision=False,unavailable=False,provider_to=None): self.calls=[]; self.collision=collision; self.unavailable=unavailable; self.provider_to=provider_to or ['"Owner, CRM" <owner@example.test>']
 def request(self,method,url,headers,payload=None):
  self.calls.append((method,url,payload))
  if self.unavailable and "api.resend.com" in url: raise events.OwnerMailEventUnavailable("temporary")
  if "api.resend.com" in url: return {"id":EMAIL,"to":self.provider_to,"html":"https://mail.blockwise.sale/email/unsubscribe/abc123/recipient/secret"}
  if "/stats/" in url:
   row={"email_address":"owner@example.test","lead_id":"7"}
   return {"stats":[row,row] if self.collision else [row]}
  if "/contacts/7" in url and method=="GET": return {"contact":{"id":7,"fields":{"all":{"email":"owner@example.test","blockwise_profile_id":PROFILE,"blockwise_workspace_id":WORKSPACE}},"doNotContact":[]}}
  if "/segments?" in url: return {"lists":{str(i):{"id":i,"name":name} for i,name in enumerate(events.SOURCE_SEGMENT_NAMES,1)}}
  return {}

class OwnerMailEventsTests(unittest.TestCase):
 def setUp(self): self.cfg=events.OwnerMailEventsConfig(SECRET,"key","http://mautic","role","password")
 def payload(self): return {"type":"email.bounced","data":{"email_id":EMAIL,"to":[{"email":"owner@example.test"}]}}
 def test_unsigned_is_rejected_before_lookup(self):
  with self.assertRaises(events.OwnerMailEventError): events.process_event(b"{}",{},self.cfg,http=FakeHttp(),now=1000)
 def test_collision_is_rejected_without_mutation(self):
  raw,headers=signed(self.payload()); fake=FakeHttp(collision=True)
  with self.assertRaises(events.OwnerMailEventError): events.process_event(raw,headers,self.cfg,fake,1000)
  self.assertFalse(any(method in {"PATCH","POST"} for method,_,_ in fake.calls))
 def test_provider_503_is_retryable_without_mutation(self):
  raw,headers=signed(self.payload()); fake=FakeHttp(unavailable=True)
  with self.assertRaises(events.OwnerMailEventUnavailable): events.process_event(raw,headers,self.cfg,fake,1000)
  self.assertEqual(len(fake.calls),1)
 def test_replay_is_native_idempotent(self):
  raw,headers=signed(self.payload()); fake=FakeHttp()
  self.assertEqual(events.process_event(raw,headers,self.cfg,fake,1000),"suppressed")
  self.assertEqual(events.process_event(raw,headers,self.cfg,fake,1000),"suppressed")
  patches=[payload for method,url,payload in fake.calls if method=="PATCH"]
  self.assertEqual(len(patches),2)
  self.assertEqual(patches[0]["doNotContact"],[{"channel":"email","reason":3}])
 def test_recipient_parser_accepts_one_quoted_display_name_only(self):
  self.assertEqual(events._recipients(['"Owner, CRM" <OWNER@EXAMPLE.TEST>']),{"owner@example.test"})
  for value in ([],["owner@example.test","other@example.test"],["owner@example.test, other@example.test"],["not-an-address"],["Owner <owner@example.test"],['"Owner <owner@example.test>'],["Owner <owner@example.test> trailing"],["group: owner@example.test;"],["owner@example.test\r\nBcc: other@example.test"],[{"email":"Owner <owner@example.test>"}]):
   with self.assertRaises(events.OwnerMailEventError): events._recipients(value)
 def test_wrong_provider_recipient_is_rejected_without_mutation(self):
  raw,headers=signed(self.payload()); fake=FakeHttp(provider_to=["wrong@example.test"])
  with self.assertRaises(events.OwnerMailEventError): events.process_event(raw,headers,self.cfg,fake,1000)
  self.assertFalse(any(method in {"PATCH","POST"} for method,_,_ in fake.calls))
 def test_wrong_immutable_scope_is_rejected(self):
  raw,headers=signed(self.payload()); fake=FakeHttp()
  original=fake.request
  def wrong(method,url,headers,payload=None):
   value=original(method,url,headers,payload)
   if "/contacts/7" in url and method=="GET": value["contact"]["fields"]["all"]["blockwise_workspace_id"]="not-a-uuid"
   return value
  fake.request=wrong
  with self.assertRaises(events.OwnerMailEventError): events.process_event(raw,headers,self.cfg,fake,1000)
  self.assertFalse(any(method in {"PATCH","POST"} for method,_,_ in fake.calls))

if __name__=="__main__": unittest.main()
