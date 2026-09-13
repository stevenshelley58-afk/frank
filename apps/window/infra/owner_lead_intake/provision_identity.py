"""Grant the existing CRM sync identity only CRM Lead read/create/write and a server-side delete guard."""
import subprocess,json
NATIVE=r'''import frappe,json
from frappe.permissions import add_permission,update_permission_property
frappe.init(site="owner.crm.internal",sites_path="/home/frappe/frappe-bench/sites");frappe.connect();frappe.set_user("Administrator")
try:
 role="Owner CRM Sync"; user="crm-sync@blockwise.sale"; dt="CRM Lead"; add_permission(dt,role)
 for action in ["read","write","create","delete","submit","cancel","amend","report","export","import","share","print","email"]: update_permission_property(dt,role,0,action,int(action in {"read","write","create"}),validate=False)
 name="Owner CRM Sync Lead Delete Guard"; script="if frappe.session.user == 'crm-sync@blockwise.sale':\\n    frappe.throw('Owner lead intake cannot delete CRM Leads', frappe.PermissionError)"
 if frappe.db.exists("Server Script",name):
  guard=frappe.get_doc("Server Script",name)
  if guard.script != script: raise RuntimeError("CRM Lead deletion guard conflict")
 else: frappe.get_doc({"doctype":"Server Script","name":name,"script_type":"DocType Event","reference_doctype":dt,"doctype_event":"Before Delete","disabled":0,"script":script}).insert()
 frappe.clear_cache();frappe.db.commit();frappe.set_user(user)
 checks={"lead_read":frappe.has_permission(dt,"read"),"lead_create":frappe.has_permission(dt,"create"),"lead_delete":frappe.has_permission(dt,"delete"),"lead_export":frappe.has_permission(dt,"export"),"cross_doctype_export":frappe.has_permission("CRM Note","read")}
 if checks != {"lead_read":True,"lead_create":True,"lead_delete":False,"lead_export":False,"cross_doctype_export":False}: raise RuntimeError("native permission boundary check failed")
 print(json.dumps(checks))
finally: frappe.destroy()
'''
def main():
 result=subprocess.run(["docker","exec","-i","-w","/home/frappe/frappe-bench/sites","owner-crm-backend-1","/home/frappe/frappe-bench/env/bin/python","-"],input=NATIVE,text=True,capture_output=True)
 if result.returncode: raise SystemExit("native Lead permission provisioning failed; inspect Frappe locally")
 print(result.stdout.strip().splitlines()[-1])
if __name__=="__main__":main()