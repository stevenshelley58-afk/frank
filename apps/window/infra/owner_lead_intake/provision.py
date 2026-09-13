"""Provision only the immutable native CRM Lead source key field."""
import argparse,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / "owner_crm_setup"))
from setup_adapter import FrappeRestClient, load_credentials, SetupError
FIELD={"name":"CRM Lead-custom_blockwise_source_key","doctype":"Custom Field","dt":"CRM Lead","fieldname":"custom_blockwise_source_key","label":"Blockwise source key","fieldtype":"Data","unique":1,"read_only":1,"description":"Read-only immutable namespaced Blockwise source key. Never use email for identity."}
def main():
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true");a=p.parse_args(); user,password=load_credentials(); c=FrappeRestClient(); c.login(user,password); rows=c.list_custom_field("CRM Lead",FIELD["fieldname"])
 if len(rows)>1: raise SetupError("duplicate lead source key fields require review")
 if rows:
  actual=rows[0]
  for key in ("dt","fieldname","fieldtype","unique","read_only"):
   if str(actual.get(key))!=str(FIELD[key]): raise SetupError("existing lead source key field does not match immutable contract")
  print('{"status":"unchanged"}'); return
 if not a.apply: print('{"status":"planned_create","apply_required":true}'); return
 c.create_custom_field(FIELD); print('{"status":"created"}')
if __name__=="__main__": main()