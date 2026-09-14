#!/usr/bin/env python3
"""Host-only retention for terminal, published template draft raster media."""
import argparse, collections, fcntl, hashlib, json, os, re, sqlite3, subprocess, time
from pathlib import Path
from urllib.parse import unquote
RUNS=Path('/home/hermes/.hermes/tool_runs/ad-template-generator')
STORAGE=Path('/var/lib/docker/volumes/blockwise-product-storage-data/_data/blockwise/blockwise/workspace-artifacts')
STATE='file:/home/hermes/.hermes/state.db?mode=ro'
EVIDENCE=Path('/srv/cleanup-evidence/ephemeral-cleanup-20260914')
TERMINAL={'completed','failed','cancelled','discarded'}
MEDIA={'.png','.jpg','.jpeg','.webp'}

def digest(p):
    with open(p,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def sql(query):
    return json.loads(subprocess.check_output(['docker','exec','blockwise-product-product-db-1','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','blockwise','-Atc',query],text=True))

def live():
    templates=sql("select coalesce(json_agg(x order by template_id),'[]') from (select template_id,library_review_run_id,template_json from public.ad_templates where library_status='active')x")
    assets=sql("select coalesce(json_agg(x order by storage_path),'[]') from (select a.storage_path from public.ad_template_assets_direct a join public.ad_templates t using(template_id) where t.library_status='active')x")
    if not templates or not assets:raise RuntimeError('empty live library; refusing cleanup')
    paths=[]
    for row in assets:
        rel=unquote(row['storage_path']);p=STORAGE/rel
        if rel.startswith('/') or '..' in Path(rel).parts or p.is_symlink() or not p.resolve().is_relative_to(STORAGE):raise RuntimeError('unsafe asset path')
        files=[p] if p.is_file() else list(p.glob('*'))
        if not files or any(not f.is_file() or f.is_symlink() for f in files):raise RuntimeError('missing/ambiguous live asset')
        paths.extend(files)
    return templates,{str(p):digest(p) for p in sorted(set(paths))}

def states():
    with sqlite3.connect(STATE,uri=True) as db:
        rows=db.execute("select run_id,status from tool_runs where tool_id='ad-template-generator'").fetchall()
    if any(s not in TERMINAL for _,s in rows):raise RuntimeError('nonterminal generator work exists; refusing cleanup')
    return dict(rows)

def eligible(relative,best):
    parts=relative.parts
    if relative.suffix.lower() not in MEDIA or not parts:return False
    if parts[0]=='reusable-validation':return True
    if parts[0]=='iterations':return len(parts)>2 and parts[1]!=f'{best:02d}' and parts[1]!=str(best)
    if parts[0]=='previews':return not re.match(r'iteration-0*'+str(best)+r'[-.]',parts[-1])
    return False

def plan(run,best):
    remove=[];keep=[]
    for base,dirs,files in os.walk(run,followlinks=False):
        if any((Path(base)/d).is_symlink() for d in dirs):raise RuntimeError('symlink in run')
        for name in files:
            p=Path(base)/name
            if p.is_symlink():raise RuntimeError('symlink in run')
            (remove if eligible(p.relative_to(run),best) else keep).append(p)
    return remove,keep

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');args=ap.parse_args()
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    with open('/run/template-draft-retention.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        templates,assets=live();status=states();remove=[];protected={};skipped=[]
        for rid in sorted({t['library_review_run_id'] for t in templates}):
            if not isinstance(rid,str) or not re.fullmatch(r'trun_[0-9a-f]{32}',rid):raise RuntimeError('invalid published run id')
            run=RUNS/rid;checkpoint=run/'exact-clone-checkpoint.json'
            if not run.is_dir() or run.is_symlink() or not checkpoint.is_file():raise RuntimeError('published source package missing')
            c=json.loads(checkpoint.read_text());best=c.get('bestIteration')
            if status.get(rid)!='completed' or c.get('accepted') is not True or not isinstance(best,int) or best<1:
                skipped.append({'run':rid,'reason':'not completed accepted checkpoint'});continue
            files=list(run.rglob('*'));latest=max((p.stat().st_mtime for p in files if p.is_file()),default=time.time())
            if time.time()-latest<86400:skipped.append({'run':rid,'reason':'less than 24h settled'});continue
            drop,keep=plan(run,best)
            if not (run/'final/artifact.json').is_file():raise RuntimeError('editable final artifact missing')
            protected.update({str(p):digest(p) for p in keep})
            remove.extend({'path':str(p),'bytes':p.stat().st_size,'sha256':digest(p),'mtime_ns':p.stat().st_mtime_ns} for p in drop)
        record={'policy':'terminal-published-draft-raster-v1','apply':args.apply,'created_at':time.time(),'active_templates':len(templates),'active_assets':len(assets),'active_asset_hashes':assets,'protected_hashes':protected,'planned_files':remove,'planned_bytes':sum(x['bytes'] for x in remove),'skipped':skipped,'deleted_files':0,'deleted_bytes':0}
        path=EVIDENCE/('template-results.json' if args.apply else 'template-dry-run.json')
        # Persist history separately: later no-op timer runs must not erase evidence.
        receipt=EVIDENCE/('template-'+str(time.time_ns())+'.json')
        def save():
            payload=json.dumps(record,indent=2);path.write_text(payload);receipt.write_text(payload)
        save()
        if args.apply:
            fresh,freshassets=live()
            if fresh!=templates or freshassets!=assets:raise RuntimeError('library changed during planning')
            states()
            for item in remove:
                p=Path(item['path'])
                if p.is_symlink() or p.stat().st_mtime_ns!=item['mtime_ns'] or digest(p)!=item['sha256']:raise RuntimeError('draft changed during cleanup')
                p.unlink();record['deleted_files']+=1;record['deleted_bytes']+=item['bytes']
            current,currentassets=live()
            if current!=templates or currentassets!=assets:raise RuntimeError('published library changed; investigate')
            if any(not Path(p).is_file() or digest(p)!=h for p,h in protected.items()):raise RuntimeError('protected source package changed; investigate')
            record['verified_published_assets_unchanged']=True;record['verified_protected_files_unchanged']=True;save()
        print(json.dumps({k:v for k,v in record.items() if k not in {'active_asset_hashes','protected_hashes','planned_files'}}))

if __name__=='__main__':main()
