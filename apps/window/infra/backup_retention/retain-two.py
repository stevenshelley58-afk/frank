#!/usr/bin/env python3
"""Keep two complete verified backup sets per declared series; unknown files stay untouched."""
import argparse,fcntl,gzip,hashlib,json,os,re,shutil,subprocess,sys,time
from pathlib import Path
STAMP=r'\d{8}T\d{6}Z'
SERIES={
 'product':('/srv/blockwise/product/backups/encrypted',STAMP,'product'),
 'customer-crm':('/srv/blockwise/crm/deploy/backups',STAMP,'crm'),
 'owner-crm':('/srv/frank/backups/owner-crm',r'local-'+STAMP+r'-[a-f0-9]+','owner-crm'),
 'owner-marketing':('/srv/frank/backups/owner-marketing',r'local-'+STAMP,'marketing'),
 'frank-full':('/srv/frank/backups/full-state',r'\d{8}T\d{4,6}Z','manifest'),
 'central-hermes':('/home/hermes/ad-radar-backups/central-hermes',STAMP,'manifest'),
 'research':('/srv/blockwise/backups/research',r'.*\d{8}.*','manifest'),
 'legacy-product':('/srv/blockwise/backups/product',r'.+','manifest'),
 'legacy-hermes':('/srv/blockwise/backups/hermes',STAMP,'manifest'),
}
REQUIRED={
 'product':{'database.dump.age','globals.sql.age','row-counts.json.age','storage.tar.gz.age','storage.sha256.age','METADATA'},
 'crm':{'database.sql.gz.age','sites.tar.gz.age','frappe.tar.gz.age','row-counts.json.age','METADATA'},
 'marketing':{'mautic.sql.gz','frank_owner_marketing_config.tar.gz','frank_owner_marketing_media.tar.gz','ntfy-sqlite.tar.gz','private-config.tar.gz'},
}
KEYS={'product':'/etc/blockwise/product-backup.agekey','crm':'/etc/blockwise/crm-backup.agekey'}
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def validate(p,kind,decrypt=True):
 if not p.is_dir() or p.is_symlink():raise ValueError('not an ordinary directory')
 for root,ds,fs in os.walk(p):
  if any((Path(root)/n).is_symlink() for n in ds+fs):raise ValueError('symlink within backup')
 manifest=next((p/n for n in ('SHA256SUMS','SHA256SUMS.txt') if (p/n).is_file()),None)
 if not manifest:raise ValueError('missing checksum manifest')
 entries={}
 for line in manifest.read_text().splitlines():
  m=re.fullmatch(r'([a-fA-F0-9]{64}) [ *](.+)',line)
  if not m:raise ValueError('unsupported checksum line')
  rel=Path(m[2]);f=p/rel
  if rel.is_absolute() or '..' in rel.parts or not f.resolve().is_relative_to(p.resolve()):raise ValueError('unsafe checksum path')
  if not f.is_file() or digest(f)!=m[1].lower():raise ValueError('checksum mismatch')
  entries[rel.as_posix().removeprefix('./')]=m[1]
 if not entries:raise ValueError('empty manifest')
 required=REQUIRED.get(kind,set())
 if not required.issubset(entries):raise ValueError('incomplete backup coverage')
 if kind=='owner-crm':
  receipt=json.loads((p/'receipt.json').read_text())
  required=set(receipt['native'].values())|{'custom-fields.json','public-files.members','private-files.members'}
  if not required.issubset(entries):raise ValueError('incomplete CRM receipt')
 if kind in KEYS and decrypt:
  for n in entries:
   if n.endswith('.age'):
    subprocess.run(['age','-d','-i',KEYS[kind],str(p/n)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True)
 return {'manifest_sha256':digest(manifest),'coverage':sorted(entries)}
def snapshot(p):return [(str(f.relative_to(p)),f.lstat().st_size,f.lstat().st_mtime_ns,f.lstat().st_ino) for f in sorted(p.rglob('*'))]
def protected_paths():
 ids=subprocess.check_output(['docker','ps','-aq'],text=True).split()
 refs=[]
 if ids:
  for c in json.loads(subprocess.check_output(['docker','inspect',*ids],text=True)):
   refs.extend({'path':m['Source'],'ancestor':True} for m in c.get('Mounts',[]) if m['Type']=='bind')
 for proc in Path('/proc').glob('[0-9]*'):
  for f in [proc/'cwd',*list((proc/'fd').glob('*'))]:
   try:refs.append(os.readlink(f))
   except OSError:pass
 for line in Path('/proc/self/mountinfo').read_text().splitlines():refs.append(line.split()[4].replace('\\040',' '))
 return refs
def is_protected(p,refs):
 s=str(p)
 for ref in refs:
  r=ref['path'] if isinstance(ref,dict) else ref
  if r==s or r.startswith(s+'/') or (isinstance(ref,dict) and r!='/' and s.startswith(r.rstrip('/')+'/')):return True
 return False
def run_series(root,pattern,kind,apply=False,refs=(),decrypt=True):
 if not root.exists():return {'status':'absent','kept':[],'deleted':[]}
 if root.resolve()!=root or root.is_symlink():raise ValueError('root path is redirected')
 matched=sorted([p for p in root.iterdir() if p.is_dir() and re.fullmatch(pattern,p.name)],key=lambda p:p.name,reverse=True)
 # Fewer than three sets cannot justify deleting anything or expensive archive rechecks.
 if len(matched)<=2:return {'status':'at_or_below_limit','kept':[str(p) for p in matched],'deleted':[]}
 valid=[];invalid=[]
 for p in matched:
  try:valid.append((p,validate(p,kind,decrypt),snapshot(p)))
  except (ValueError,OSError,subprocess.CalledProcessError,KeyError) as e:invalid.append({'path':str(p),'reason':str(e)[:150]})
 keep=valid[:2];out={'status':'checked','kept':[str(x[0]) for x in keep],'invalid_retained':invalid,'deleted':[],'planned':[],'protected':[]}
 if len(keep)<2:return out
 # Only delete covered older copies; this deliberately retains different backup kinds.
 for p,proof,state in valid[2:]:
  if not all(set(proof['coverage']).issubset(k[1]['coverage']) for k in keep):
   # Native CRM dump names include timestamps. Receipt field names, not filenames, establish equal scope.
   if kind!='owner-crm':out['protected'].append({'path':str(p),'reason':'different recovery coverage'});continue
  if is_protected(p,refs):out['protected'].append({'path':str(p),'reason':'mounted or open'});continue
  out['planned'].append(str(p))
  if apply:
   assert p.parent==root and p.resolve().parent==root and not p.is_symlink()
   if snapshot(p)!=state or any(snapshot(k[0])!=k[2] for k in keep):raise ValueError('backup changed after verification')
   if is_protected(p,protected_paths()):raise ValueError('backup became busy')
   shutil.rmtree(p);out['deleted'].append(str(p))
 return out
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');ap.add_argument('--series',choices=list(SERIES));args=ap.parse_args()
 with open('/run/lock/vps-backup-retention.lock','w') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:print('retention already running');return
  refs=protected_paths();result={'keep':2,'apply':args.apply,'time':time.time(),'series':{}}
  for name,(root,pattern,kind) in SERIES.items():
   if args.series and name!=args.series:continue
   try:result['series'][name]=run_series(Path(root),pattern,kind,args.apply,refs)
   except Exception as e:result['series'][name]={'error':str(e)[:180],'status':'retained_on_error'}
  print(json.dumps(result,indent=2))
  if any('error' in x for x in result['series'].values()):sys.exit(1)
if __name__=='__main__':main()
