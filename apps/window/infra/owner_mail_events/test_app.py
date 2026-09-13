import importlib.util, sys, types, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent
class EventError(Exception):
 def __init__(self,message="rejected",safe_code="recipient_rejected"): super().__init__(message); self.safe_code=safe_code
class Unavailable(Exception):
 def __init__(self,message="unavailable",safe_code="native_write_unavailable"): super().__init__(message); self.safe_code=safe_code
class Config:
 @classmethod
 def from_env(cls, value): return cls()
def load(process):
 receiver=types.SimpleNamespace(OwnerMailEventError=EventError,OwnerMailEventUnavailable=Unavailable,OwnerMailEventsConfig=Config,process_event=process)
 reply=types.SimpleNamespace(register_owner_mail_reply=lambda app,config: app.add_url_rule("/api/owner-mail-events/reply","reply",lambda:("",204),methods=["POST"]))
 sys.modules["owner_mail_events"]=receiver; sys.modules["owner_mail_reply"]=reply
 spec=importlib.util.spec_from_file_location("owner_mail_events_app",ROOT/"owner_mail_events_app.py"); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module.app
class Tests(unittest.TestCase):
 def test_resend_success_and_private_reply_registration(self):
  calls=[]; app=load(lambda raw,headers,cfg: calls.append(raw)); client=app.test_client()
  self.assertEqual(client.post("/api/owner-mail-events/resend",data=b"{}").status_code,204); self.assertEqual(client.post("/api/owner-mail-events/reply").status_code,204); self.assertEqual(calls,[b"{}"])
 def test_invalid_and_transient_log_only_allowlisted_codes(self):
  app=load(lambda *args: (_ for _ in ()).throw(EventError("payload-secret-marker")))
  with self.assertLogs(app.logger,level="WARNING") as captured:
   response=app.test_client().post("/api/owner-mail-events/resend",data=b"body-secret-marker",headers={"Svix-Signature":"header-secret-marker"})
  self.assertEqual(response.status_code,400); logged=" ".join(captured.output)
  self.assertIn("code=recipient_rejected status=400",logged)
  self.assertNotIn("payload-secret-marker",logged); self.assertNotIn("body-secret-marker",logged); self.assertNotIn("header-secret-marker",logged)
  app=load(lambda *args: (_ for _ in ()).throw(Unavailable("upstream-secret-marker")))
  with self.assertLogs(app.logger,level="WARNING") as captured:
   response=app.test_client().post("/api/owner-mail-events/resend",data=b"{}")
  self.assertEqual(response.status_code,503); logged=" ".join(captured.output)
  self.assertIn("code=native_write_unavailable status=503",logged); self.assertNotIn("upstream-secret-marker",logged)
 def test_unknown_error_code_is_reduced_to_processing_rejected(self):
  app=load(lambda *args: (_ for _ in ()).throw(EventError("secret","attacker-controlled")))
  with self.assertLogs(app.logger,level="WARNING") as captured:
   self.assertEqual(app.test_client().post("/api/owner-mail-events/resend",data=b"{}").status_code,400)
  self.assertIn("code=processing_rejected status=400"," ".join(captured.output))
  self.assertNotIn("attacker-controlled"," ".join(captured.output))
if __name__=="__main__": unittest.main()
