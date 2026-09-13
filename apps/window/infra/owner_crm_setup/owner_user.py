"""Provision a native owner login without an invitation or password disclosure."""
import argparse,json,os,secrets,stat
from pathlib import Path
from urllib.parse import quote
from setup_adapter import FrappeRestClient,load_credentials

USER="owner@blockwise.sale"
SECRET=Path("/srv/frank/secrets/owner-crm-login.env")
ROLES=["Sales Manager","Agent Manager","Inbox User","Knowledge Base Editor"]

def main():
    p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true");args=p.parse_args()
    u,pw=load_credentials();client=FrappeRestClient();client.login(u,pw)
    try:
        rows=client._request("GET","/api/resource/User?filters="+quote(json.dumps({"name":USER}))+"&fields="+quote(json.dumps(["name","enabled","user_type"]))).get("data",[])
        if rows:
            user=client._request("GET","/api/resource/User/"+quote(USER,safe=""))["data"]
            existing={r["role"] for r in user.get("roles",[])}
            if not user.get("enabled") or user.get("user_type")!="System User" or not set(ROLES).issubset(existing):
                raise RuntimeError("Existing owner identity requires review; left unchanged")
            print(json.dumps({"owner_user_exists":True,"native_roles_verified":True,"password_changed":False}));return
        if not args.apply:
            print(json.dumps({"mode":"preview","owner_user_exists":False,"roles":ROLES,"invitation_will_send":False}));return
        if SECRET.exists():
            st=SECRET.lstat()
            if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600: raise RuntimeError("Unsafe owner login secret")
            values=dict(line.split("=",1) for line in SECRET.read_text().splitlines() if "=" in line)
            password=values["OWNER_CRM_PASSWORD"]
        else:
            password=secrets.token_urlsafe(36)
            fd=os.open(SECRET,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,"w") as f:f.write("OWNER_CRM_USERNAME="+USER+"\nOWNER_CRM_PASSWORD="+password+"\n")
        client._request("POST","/api/resource/User",body={"email":USER,"first_name":"Steven","enabled":1,"user_type":"System User","send_welcome_email":0,"new_password":password,"roles":[{"role":r} for r in ROLES]})
        print(json.dumps({"owner_user_created":True,"invitation_sent":False,"password_stored_privately":True,"mfa_enrolled":False}))
    finally:client.logout();client.close()

if __name__=="__main__":main()
