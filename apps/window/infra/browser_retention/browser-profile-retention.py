#!/usr/bin/env python3
"""Remove closed, aged per-capture profiles only; never shared browser state."""
import argparse, datetime, fcntl, json, os, pathlib, re, shutil, stat, subprocess, time
ROOT = pathlib.Path('/srv/hermes/ad-db/browser-home/profile')
RUN = re.compile(r'run-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$', re.I)

def overlaps(a, b):
    return a == b or a in b.parents or b in a.parents

def snapshot():
    refs = set(); browsers = []
    for proc in pathlib.Path('/proc').glob('[0-9]*'):
        try:
            args = (proc/'cmdline').read_bytes().split(b'\0')
            args = [a.decode(errors='replace') for a in args if a]
            if args and any(x in pathlib.Path(args[0]).name.lower() for x in ('chrome', 'chromium')):
                browsers.append(proc.name)
            for a in args:
                a = a.split('=',1)[-1]
                if a.startswith(str(ROOT)): refs.add(pathlib.Path(a))
            for p in [proc/'cwd', *list((proc/'fd').iterdir())]:
                try:
                    target = os.readlink(p).removesuffix(' (deleted)')
                    if target.startswith(str(ROOT)): refs.add(pathlib.Path(target))
                except FileNotFoundError: pass
        except FileNotFoundError: pass
    ids = subprocess.check_output(['docker','ps','-aq'],text=True).split()
    if ids:
        for c in json.loads(subprocess.check_output(['docker','inspect',*ids],text=True)):
            for m in c.get('Mounts',[]):
                if m.get('Source'): refs.add(pathlib.Path(m['Source']).resolve())
    # Other filesystem mounts below/above the profile root, excluding the root filesystem.
    for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
        target = line.split()[4].replace('\\040',' ')
        if target != '/': refs.add(pathlib.Path(target))
    return browsers, refs

def inspect_candidate(p, cutoff, refs):
    if p.is_symlink() or not p.is_dir() or not RUN.fullmatch(p.name): return None
    if p.parent != ROOT or p.resolve() != p: return None
    if any(overlaps(p,x) for x in refs): return None
    latest = 0; allocated = p.stat().st_blocks * 512
    for d, dirs, files in os.walk(p, followlinks=False):
        for name in dirs + files:
            q=pathlib.Path(d)/name; st=q.lstat()
            if stat.S_ISREG(st.st_mode): latest=max(latest,st.st_mtime)
            allocated += st.st_blocks*512
            # os.walk does not follow directory symlinks; rmtree only unlinks them.
    if latest > cutoff: return None
    return {'path':str(p),'allocated_bytes':allocated,'latest_regular_file_mtime':latest,'inode':p.stat().st_ino}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');ap.add_argument('--result');a=ap.parse_args()
    lock=open('/run/lock/ad-radar-browser-retention.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if ROOT.resolve()!=ROOT or ROOT.is_symlink(): raise RuntimeError('Unsafe root')
    result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'root':str(ROOT),'apply':a.apply,'candidates':[],'deleted':[],'freed_allocated_bytes':0}
    browsers,refs=snapshot()
    if browsers: result['blocked']='Browser process active'
    else:
        cutoff=time.time()-86400
        for p in ROOT.iterdir():
            item=inspect_candidate(p,cutoff,refs)
            if item: result['candidates'].append(item)
        if a.apply:
            browsers,refs=snapshot() # batch race guard; no thousands of process scans
            if browsers: result['blocked']='Browser started during plan'
            else:
                for item in result['candidates']:
                    p=pathlib.Path(item['path'])
                    if any(overlaps(p,x) for x in refs) or p.is_symlink() or p.stat().st_ino != item['inode']: continue
                    shutil.rmtree(p)
                    result['deleted'].append(item);result['freed_allocated_bytes']+=item['allocated_bytes']
                    if a.result:
                        out=pathlib.Path(a.result);out.parent.mkdir(parents=True,exist_ok=True)
                        tmp=out.with_suffix('.tmp');tmp.write_text(json.dumps(result));tmp.replace(out)
    if a.result:
        out=pathlib.Path(a.result);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2))
    print(json.dumps({k:(len(v) if isinstance(v,list) else v) for k,v in result.items()}))
if __name__=='__main__': main()
