"""Install the committed, paused native Hermes owner-email consent bridge."""
import argparse
import json
import os
from pathlib import Path
import pwd
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
HOME = Path("/home/hermes/.hermes")
TARGET = HOME / "scripts/owner-email-flows"
PYTHON = HOME / "hermes-agent/venv/bin/python"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--enable", action="store_true", help="root-only after controlled recipient acceptance")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("native bridge installation requires root")
    status = subprocess.check_output(["git", "-C", str(ROOT), "status", "--porcelain"], text=True)
    if status.strip():
        raise SystemExit("refuse dirty or untracked source")
    subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", "HEAD", "origin/main"], check=True)
    if TARGET.is_symlink():
        raise SystemExit("refuse symlinked Hermes runtime directory")
    account = pwd.getpwnam("hermes")
    TARGET.mkdir(parents=True, exist_ok=True, mode=0o750)
    os.chown(TARGET, account.pw_uid, account.pw_gid)
    for name in ("customer_sync.py", "mautic_flows.py", "source_adapter.py", "source_operate.py", "source_scheduled.py"):
        relative = "apps/window/infra/owner_email_flows/" + name
        if name == "customer_sync.py":
            relative = "apps/window/infra/owner_crm_sync/customer_sync.py"
        data = subprocess.check_output(["git", "-C", str(ROOT), "show", "HEAD:" + relative])
        path = TARGET / name
        if path.is_symlink():
            raise SystemExit("refuse symlinked Hermes runtime script")
        fd, temporary = tempfile.mkstemp(prefix=".install-", dir=TARGET)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
                os.fchmod(stream.fileno(), 0o640)
                os.fchown(stream.fileno(), account.pw_uid, account.pw_gid)
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)
    state = Path("/srv/hermes/state/owner-email-flows")
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chown(state, account.pw_uid, account.pw_gid)
    code = r'''import json
from cron.jobs import list_jobs, create_job, pause_job, resume_job
name="Owner email consent bridge"
jobs=[job for job in list_jobs(include_disabled=True) if job.get("name")==name]
if len(jobs)>1: raise RuntimeError("duplicate owner email bridge jobs need review")
if jobs:
    job=jobs[0]
    if job.get("script") != "owner-email-flows/source_scheduled.py" or not job.get("no_agent"):
        raise RuntimeError("existing job is not the expected deterministic bridge")
else:
    job=create_job(prompt="",schedule="*/15 * * * *",name=name,deliver="local",script="owner-email-flows/source_scheduled.py",no_agent=True)
job_id=job["id"]
ACTION
print(json.dumps({"job_id":job_id,"no_agent":True,"enabled":ENABLED}))
'''.replace("ACTION", "resume_job(job_id)" if args.enable else "pause_job(job_id, reason='awaiting root controlled email test')").replace("ENABLED", "True" if args.enable else "False")
    result = subprocess.run(["runuser", "-u", "hermes", "--", "env", "HERMES_HOME=" + str(HOME), str(PYTHON), "-c", code], cwd=HOME / "hermes-agent", capture_output=True, text=True)
    if result.returncode:
        raise SystemExit("native Hermes cron activation failed; inspect the native scheduler locally")
    print(result.stdout.strip())
    command = "resume" if args.enable else "pause"
    subprocess.run(["runuser", "-u", "hermes", "--", str(PYTHON), str(TARGET / "source_operate.py"), command], check=True)
    revision = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
    print(json.dumps({"installed_revision": revision, "profile": "default", "model_calls": 0}))


if __name__ == "__main__":
    main()
