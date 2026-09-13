#!/usr/bin/env python3
"""Archive a restore-proven snapshot before upstream tracked-demo cleanup."""
import argparse, json, os, re, shutil, stat, subprocess
from pathlib import Path
ROOT=Path('/srv/frank/backups/owner-crm')
ARCHIVE=Path('/srv/frank/legacy_archive/owner-crm-native-demo')
def bench(method,kwargs=None):
    args=['docker','exec','owner-crm-backend-1','bench','--site','owner.crm.internal','execute',method]
    if kwargs is not None: args += ['--kwargs',json.dumps(kwargs)]
    result=subprocess.run(args,check=True,capture_output=True,text=True)
    if method=='crm.demo.api.clear_demo_data': return None
    return json.loads(result.stdout) if result.stdout.strip() else []

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0: raise SystemExit('root required')
    defaults=bench('frappe.get_all',{'doctype':'DefaultValue','fields':['defkey','defvalue'],'filters':{'defkey':['like','crm_demo%']}})
    if not any(x['defkey']=='crm_demo_data_created' and x['defvalue']=='1' for x in defaults):
        run=(ROOT/'LATEST').read_text().strip(); dest=ARCHIVE/run
        if args.apply and (dest/'cleanup-scope.json').is_file():
            scope=json.loads((dest/'cleanup-scope.json').read_text())
            leads=bench('frappe.get_all',{'doctype':'CRM Lead','fields':['name']})
            mirrors=bench('frappe.get_all',{'doctype':'Contact','fields':['name','custom_blockwise_profile_uuid'],'filters':{'custom_blockwise_profile_uuid':['is','set']}})
            if {x['name'] for x in leads} != set(scope['protected_leads']) or sorted(mirrors,key=lambda x:x['name'])!=sorted(scope['protected_mirrors'],key=lambda x:x['name']): raise SystemExit('post-cleanup scope mismatch')
            result={'native_demo_removed':True,'protected_leads':len(leads),'protected_customer_mirrors':len(mirrors),'archive':str(dest)}
            receipt=dest/'cleanup-receipt.json'
            if not receipt.exists():
                fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'w') as stream: json.dump(result,stream)
            print(json.dumps(result));return
        print(json.dumps({'native_demo_present':False}));return
    tracked=json.loads(next(x['defvalue'] for x in defaults if x['defkey']=='crm_demo_leads'))
    leads=bench('frappe.get_all',{'doctype':'CRM Lead','fields':['name','email','custom_blockwise_prospect_source_uuid']})
    demo=[x for x in leads if x['name'] in tracked]
    if len(demo)!=len(tracked) or any(not (x.get('email') or '').endswith('@example.com') or x.get('custom_blockwise_prospect_source_uuid') for x in demo):
        raise SystemExit('native demo identity drift; no cleanup')
    protected=[x['name'] for x in leads if x['name'] not in tracked]
    mirrors=bench('frappe.get_all',{'doctype':'Contact','fields':['name','custom_blockwise_profile_uuid'],'filters':{'custom_blockwise_profile_uuid':['is','set']}})
    if not args.apply:
        print(json.dumps({'tracked_demo_leads':len(demo),'protected_leads':len(protected),'protected_customer_mirrors':len(mirrors)}));return
    run=(ROOT/'LATEST').read_text().strip()
    if not re.fullmatch(r'local-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}',run): raise SystemExit('invalid backup selector')
    backup=ROOT/run
    if backup.is_symlink() or not backup.is_dir(): raise SystemExit('unsafe backup')
    receipt=json.loads((backup/'drill-receipt.json').read_text())
    drill=receipt.get('restore_drill',{})
    if not drill.get('custom_fields_match') or not drill.get('config',{}).get('encrypted_credentials_roundtrip_verified') or drill.get('cleanup')!='verified and completed': raise SystemExit('restore-proven archive required')
    subprocess.run(['sha256sum','-c','SHA256SUMS'],cwd=backup,check=True,capture_output=True)
    ARCHIVE.mkdir(parents=True,exist_ok=True,mode=0o700)
    if ARCHIVE.is_symlink(): raise SystemExit('unsafe archive root')
    dest=ARCHIVE/run
    if not dest.exists(): shutil.copytree(backup,dest)
    if dest.is_symlink(): raise SystemExit('unsafe existing archive')
    subprocess.run(['sha256sum','-c','SHA256SUMS'],cwd=dest,check=True,capture_output=True)
    manifest={'defaults':defaults,'protected_leads':protected,'protected_mirrors':mirrors}
    scope=dest/'cleanup-scope.json'
    if scope.exists():
        if json.loads(scope.read_text()) != manifest: raise SystemExit('archived cleanup scope drifted')
    else:
        fd=os.open(scope,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as stream: json.dump(manifest,stream)
    bench('crm.demo.api.clear_demo_data')
    remaining=bench('frappe.get_all',{'doctype':'CRM Lead','fields':['name']})
    aftermirrors=bench('frappe.get_all',{'doctype':'Contact','fields':['name','custom_blockwise_profile_uuid'],'filters':{'custom_blockwise_profile_uuid':['is','set']}})
    if {x['name'] for x in remaining} != set(protected) or sorted(mirrors,key=lambda x:x['name'])!=sorted(aftermirrors,key=lambda x:x['name']): raise SystemExit('post-cleanup mismatch; preserved recovery archive')
    result={'native_demo_removed':True,'protected_leads':len(protected),'protected_customer_mirrors':len(mirrors),'archive':str(dest)}
    fd=os.open(dest/'cleanup-receipt.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream: json.dump(result,stream)
    print(json.dumps(result))
if __name__=='__main__':main()
