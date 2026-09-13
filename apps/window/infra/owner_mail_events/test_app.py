import importlib.util, sys, types, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent
class EventError(Exception): pass
class Unavailable(Exception): pass
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
 def test_invalid_and_transient_are_not_acknowledged(self):
  app=load(lambda *args: (_ for _ in ()).throw(EventError())); self.assertEqual(app.test_client().post("/api/owner-mail-events/resend",data=b"{}").status_code,400)
  app=load(lambda *args: (_ for _ in ()).throw(Unavailable())); self.assertEqual(app.test_client().post("/api/owner-mail-events/resend",data=b"{}").status_code,503)
if __name__=="__main__": unittest.main()
