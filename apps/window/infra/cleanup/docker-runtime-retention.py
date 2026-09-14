#!/usr/bin/env python3
# Bound owned unused image versions; never prune volumes or live dependencies.
import argparse,json,subprocess
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
def main():
    a=argparse.ArgumentParser(); a.add_argument('--apply',action='store_true'); a=a.parse_args()
    containers,images=snapshots()
    candidates=select(images,{x['Image'] for x in containers},protections())
    result={'apply':a.apply,'keep_unused_versions_per_repository':2,'candidates':candidates,'removed':[]}
    if a.apply:
        for tag in candidates:
            current,_=snapshots()
            image=run('docker','image','inspect','--format','{{.Id}}',tag)
            if image in {x['Image'] for x in current}: continue
            subprocess.run(['docker','image','rm',tag],check=True,stdout=subprocess.DEVNULL)
            result['removed'].append(tag)
        subprocess.run(['docker','builder','prune','-af','--filter','until=24h','--max-used-space','2GB'],check=True,stdout=subprocess.DEVNULL)
    print(json.dumps(result,indent=2))
if __name__=='__main__': main()
