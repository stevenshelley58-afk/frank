#!/usr/bin/env python3
# Bound owned unused image versions; never prune volumes or live dependencies.
import argparse,json,subprocess,re,fcntl,time
from datetime import datetime,timezone
from pathlib import Path
REPOS={'blockwise-app','blockwise-homepage-preview','blockwise-process-preview','blockwise-crm-app','frank-window','frank-agenttrail','frank-owner-marketing-mautic'}
def run(*args):
    return subprocess.check_output(args,text=True).strip()
def snapshots():
    ids=run('docker','ps','-aq').split()
    containers=json.loads(run('docker','inspect',*ids)) if ids else []
    ids=run('docker','image','ls','-aq').split()
    images=json.loads(run('docker','image','inspect',*sorted(set(ids)))) if ids else []
    return containers,images
def select(images,used,protected_text):
    groups={}
    for img in images:
        for tag in img.get('RepoTags') or []:
            repo,version=tag.rsplit(':',1)
            if repo in REPOS:
                groups.setdefault(repo,[]).append((img['Created'],tag,img['Id']))
    remove=[]
    for repo,entries in groups.items():
        unused=sorted([x for x in entries if x[2] not in used],reverse=True)
        keep_ids=list(dict.fromkeys(x[2] for x in unused))[:2]
        for _,tag,i in unused:
            version=tag.rsplit(':',1)[1]
            if i in keep_ids or tag in protected_text or version in protected_text or version in ('current','latest'):
                continue
            remove.append(tag)
    return sorted(set(remove))
def protections():
    text=''
    roots=['/etc/systemd/system','/var/lib/frank/release','/srv/frank/secrets','/srv/blockwise/product','/srv/hermes/secrets']
    for root in roots:
        for p in Path(root).rglob('*'):
            if p.is_file() and p.stat().st_size<1024*1024:
                text+=p.read_text(errors='ignore')
    for root in ['/srv/blockwise/releases/product','/srv/frank/releases']:
        if Path(root).exists():
            text+=' '.join(p.name for p in Path(root).iterdir())
    return text

PREVIEW_RE=re.compile(r'^blockwise-(?:homepage|process|email)-preview-[a-f0-9]{7,40}$')
def preview_reason(c,now,merged,claimed):
    if not PREVIEW_RE.fullmatch(c['Name'].lstrip('/')): return 'outside preview allowlist'
    if c.get('Mounts'): return 'has persistent or bind mounts'
    created=datetime.fromisoformat(c['Created'].replace('Z','+00:00')).timestamp()
    if now-created<86400: return 'review younger than 24 hours'
    sha=(c['Config'].get('Labels') or {}).get('org.opencontainers.image.revision','')
    if not re.fullmatch('[a-f0-9]{40}',sha): return 'missing full source revision'
    if sha in claimed: return 'source worktree still exists'
    if sha not in merged: return 'source revision not merged to main'
    return None
def preview_state(containers):
    claimed=set()
    all_containers,_=snapshots()
    routing=''
    for c in all_containers:
        if 'caddy' not in c['Name']: continue
        for mount in c.get('Mounts',[]):
            if mount['Destination']=='/etc/caddy/Caddyfile':
                routing+=Path(mount['Source']).read_text()
    for c in containers:
        if c['Name'].lstrip('/') in routing:
            claimed.add((c['Config'].get('Labels') or {}).get('org.opencontainers.image.revision',''))

    for block in run('git','-C','/projects/blockwise','worktree','list','--porcelain').split('\n\n'):
        lines=dict(x.split(' ',1) for x in block.splitlines() if ' ' in x)
        path=lines.get('worktree','')
        if path and Path(path).exists() and not path.startswith('/srv/blockwise/releases/') and path!='/projects/blockwise':
            claimed.add(lines.get('HEAD',''))
    merged=set()
    for c in containers:
        if not PREVIEW_RE.fullmatch(c['Name'].lstrip('/')): continue
        sha=(c['Config'].get('Labels') or {}).get('org.opencontainers.image.revision','')
        if re.fullmatch('[a-f0-9]{40}',sha) and subprocess.run(['git','-C','/projects/blockwise','merge-base','--is-ancestor',sha,'main'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
            merged.add(sha)
    return merged,claimed

def main():
    a=argparse.ArgumentParser(); a.add_argument('--apply',action='store_true'); a=a.parse_args()
    lock=open('/run/lock/frank-docker-retention.lock','w')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    free_before=__import__('shutil').disk_usage('/').free
    containers,images=snapshots()
    merged,claimed=preview_state(containers)
    preview_rows=[]
    for c in containers:
        if not PREVIEW_RE.fullmatch(c['Name'].lstrip('/')): continue
        reason=preview_reason(c,time.time(),merged,claimed)
        row={'name':c['Name'].lstrip('/'),'reason':reason,'removed':False}
        if a.apply and reason is None:
            fresh=json.loads(run('docker','inspect',c['Id']))[0]
            m,k=preview_state([fresh])
            if preview_reason(fresh,time.time(),m,k) is None:
                run('docker','stop',c['Id'])
                run('docker','rm',c['Id'])
                row['removed']=True
        preview_rows.append(row)
    containers,images=snapshots()
    candidates=select(images,{x['Image'] for x in containers},protections())
    result={'apply':a.apply,'keep_unused_versions_per_repository':2,'candidates':candidates,'removed':[],'previews':preview_rows}
    if a.apply:
        for tag in candidates:
            current,_=snapshots()
            image=run('docker','image','inspect','--format','{{.Id}}',tag)
            if image in {x['Image'] for x in current}: continue
            subprocess.run(['docker','image','rm',tag],check=True,stdout=subprocess.DEVNULL)
            result['removed'].append(tag)
        result['cache_native_output']=run('docker','builder','prune','-af','--max-used-space','2GB')
    result['filesystem_free_delta_bytes']=__import__('shutil').disk_usage('/').free-free_before
    print(json.dumps(result,indent=2))
if __name__=='__main__': main()
