import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).parent))
import incoming_email_assignment as mod
from setup_adapter import SetupError

class Fake:
 def __init__(self,existing=None):self.value=existing;self.created=[];self.preflighted=0
 def preflight(self):self.preflighted+=1
 def existing(self):return self.value
 def create(self,value):self.created.append(value);self.value=value

def test_exact_native_contract():
 d=mod.desired_rule()
 assert d["document_type"]=="Communication" and d["rule"]=="Round Robin"
 assert d["users"]==[{"user":"owner@blockwise.sale"}]
 assert d["description"] == "Review incoming owner inbox email"
 assert "{{" not in d["description"]
 assert 'sent_or_received == "Received"' in d["assign_condition"]
 assert 'email_account == "Blockwise Owner Inbox"' in d["assign_condition"]
 assert 'reference_doctype != "HD Ticket"' in d["assign_condition"]
 assert "unread_notification_sent" not in d["assign_condition"]
 assert "hello@blockwise.sale" in d["assign_condition"] and "owner@blockwise.sale" in d["assign_condition"]
 assert set(x["day"] for x in d["assignment_days"])==set(mod.DAYS)

def test_dry_run_plans_create_without_write():
 f=Fake();r=mod.run(client=f)
 assert r.action=="create" and f.created==[] and f.preflighted==1

def test_apply_creates_then_replays_unchanged():
 f=Fake();r=mod.run(apply=True,client=f)
 assert r.action=="create" and len(f.created)==1 and f.preflighted==2
 assert mod.run(client=f).action=="unchanged"

def test_existing_exact_is_unchanged():
 f=Fake(mod.desired_rule());assert mod.run(client=f).action=="unchanged";assert f.created==[]

@pytest.mark.parametrize("field,value",[("assign_condition","True"),("disabled",1),("priority",1),("users",[{"user":"Administrator"}]),("assignment_days",[{"day":"Monday"}])])
def test_drift_fails_closed(field,value):
 d=mod.desired_rule();d[field]=value
 with pytest.raises(SetupError,match="drifted"):mod.run(client=Fake(d))

def test_canonical_ignores_native_child_metadata():
 d=mod.desired_rule();d["users"][0].update({"doctype":"Assignment Rule User","idx":1});d["assignment_days"][0]["idx"]=1
 assert mod.canonical(d)==mod.canonical(mod.desired_rule())
