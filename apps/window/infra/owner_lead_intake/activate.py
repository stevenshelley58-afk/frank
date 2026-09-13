import argparse,os,pwd,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent;HOME=Path("/home/hermes/.hermes");TARGET=HOME/"scripts/owner-lead-intake";PY=HOME/"hermes-agent/venv/bin/python"
def main():
 p=argparse.ArgumentParser();p.add_argument("--enable",action="store_true");a=p.parse_args();subprocess.run(["git","-C",str(ROOT),"diff","--exit-code","HEAD","--",str(ROOT)],check=True);acct=pwd.getpwnam("hermes");TARGET.mkdir(parents=True,exist_ok=True,mode=0o750);os.chown(TARGET,acct.pw_uid,acct.pw_gid)
 for n in ["lead_intake.py","operate.py","scheduled.py"]:
  data=subprocess.check_output(["git","-C",str(ROOT),"show","HEAD:apps/window/infra/owner_lead_intake/"+n]);q=TARGET/n;q.write_bytes(data);os.chmod(q,0o640);os.chown(q,acct.pw_uid,acct.pw_gid)
 state=Path("/srv/hermes/state/owner-lead-intake");state.mkdir(parents=True,exist_ok=True,mode=0o700);os.chown(state,acct.pw_uid,acct.pw_gid)
 code="""from cron.jobs import list_jobs,create_job,pause_job,resume_job
name='Owner Lead Intake';jobs=[j for j in list_jobs(include_disabled=True) if j.get('name')==name]
if len(jobs)>1:raise RuntimeError('duplicate native job')
job=jobs[0] if jobs else create_job(prompt='',schedule='*/15 * * * *',name=name,deliver='local',script='owner-lead-intake/scheduled.py',no_agent=True)
%s(job['id']%s)
""" % ("resume_job" if a.enable else "pause_job",", reason='awaiting root supervised import'" if not a.enable else "")
 subprocess.run(["runuser","-u","hermes","--","env","HERMES_HOME="+str(HOME),str(PY),"-c",code],cwd=HOME/"hermes-agent",check=True);subprocess.run(["runuser","-u","hermes","--",str(PY),str(TARGET/"operate.py"),"resume" if a.enable else "pause"],check=True)
if __name__=="__main__":main()