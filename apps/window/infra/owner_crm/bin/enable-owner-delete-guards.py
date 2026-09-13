#!/usr/bin/env python3
"""Enable reviewed native safeguards on this dedicated owner-only bench."""
import json, subprocess
expected={
'Owner CRM Sync Lead Delete Guard': "if frappe.session.user == 'crm-sync@blockwise.sale':\n    frappe.throw('Owner lead intake cannot delete CRM Leads', frappe.PermissionError)",
'Owner CRM Sync Contact Delete Guard': "if frappe.session.user == 'crm-sync@blockwise.sale':\n    frappe.throw('Customer sync cannot delete contacts', frappe.PermissionError)"}
cmd=['docker','exec','owner-crm-backend-1','bench','--site','owner.crm.internal','execute','frappe.get_all','--kwargs',json.dumps({'doctype':'Server Script','fields':['name','script','disabled']})]
rows=json.loads(subprocess.check_output(cmd,text=True))
if {r['name']:r['script'] for r in rows if not r['disabled']} != expected: raise SystemExit('Unexpected active native Server Scripts; configuration left unchanged')
subprocess.run(['docker','exec','owner-crm-backend-1','bench','set-config','-g','server_script_enabled','1'],check=True)
subprocess.run(['docker','exec','owner-crm-backend-1','bench','--site','owner.crm.internal','clear-cache'],check=True)
print('Reviewed native owner delete safeguards enabled')
