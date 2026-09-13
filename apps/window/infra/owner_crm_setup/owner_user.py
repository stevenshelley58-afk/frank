"""Provision a native owner login without an invitation or password disclosure."""
import argparse,json,os,secrets,stat
from pathlib import Path
from urllib.parse import quote
from setup_adapter import FrappeRestClient,load_credentials

USER="owner@blockwise.sale"
SECRET=Path("/srv/frank/secrets/owner-crm-login.env")
ROLES=["Sales Manager","Agent Manager","Inbox User","Knowledge Base Editor"]
AGENT_ROLE="Agent"

def _roles(user):
    rows=user.get("roles",[])
    if not isinstance(rows,list) or not all(isinstance(row,dict) and isinstance(row.get("role"),str) for row in rows):
        raise RuntimeError("Frappe returned invalid owner roles")
    return {row["role"] for row in rows}

def _flag(value):
    if value in (1,True,"1"): return True
    if value in (0,False,"0",None): return False
    raise RuntimeError("Frappe returned invalid owner status")

def _owner_user(client):
    rows=client._request("GET","/api/resource/User?filters="+quote(json.dumps({"name":USER}))+"&fields="+quote(json.dumps(["name"]))).get("data",[])
    if not isinstance(rows,list) or len(rows)>1: raise RuntimeError("Dedicated owner identity requires review; left unchanged")
    if not rows: return None
    if rows[0].get("name")!=USER: raise RuntimeError("Dedicated owner identity requires review; left unchanged")
    user=client._request("GET","/api/resource/User/"+quote(USER,safe="")).get("data")
    if not isinstance(user,dict): raise RuntimeError("Frappe returned invalid owner identity")
    return user

def _owner_agent(client):
    filters=json.dumps([["user","=",USER]],separators=(",",":"))
    fields=json.dumps(["name","user","agent_name","is_active"],separators=(",",":"))
    rows=client._request("GET","/api/resource/HD%20Agent?filters="+quote(filters)+"&fields="+quote(fields)).get("data",[])
    if not isinstance(rows,list) or len(rows)>1: raise RuntimeError("Dedicated owner HD Agent requires review; left unchanged")
    if not rows: return None
    agent=rows[0]
    if not isinstance(agent,dict) or agent.get("name")!=USER or agent.get("user")!=USER or not isinstance(agent.get("agent_name"),str) or not agent["agent_name"].strip():
        raise RuntimeError("Dedicated owner HD Agent requires review; left unchanged")
    _flag(agent.get("is_active")); return agent

def _validate_owner(user):
    if user.get("name")!=USER or not _flag(user.get("enabled")) or user.get("user_type")!="System User" or not set(ROLES).issubset(_roles(user)):
        raise RuntimeError("Existing owner identity requires review; left unchanged")

def _create_agent(client,user):
    name=user.get("full_name")
    if not isinstance(name,str) or not name.strip(): raise RuntimeError("Existing owner identity requires review; left unchanged")
    agent=client._request("POST","/api/resource/HD%20Agent",body={"user":USER,"agent_name":name.strip(),"is_active":1}).get("data")
    if not isinstance(agent,dict) or agent.get("name")!=USER or agent.get("user")!=USER: raise RuntimeError("Frappe did not create the native owner HD Agent")

def main():
    p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true");args=p.parse_args()
    u,pw=load_credentials();client=FrappeRestClient();client.login(u,pw)
    try:
        user=_owner_user(client); agent=_owner_agent(client)
        if user is not None: _validate_owner(user)
        if agent is not None and user is None: raise RuntimeError("Dedicated owner HD Agent requires review; left unchanged")
        if not args.apply:
            print(json.dumps({"mode":"preview","owner_user_exists":user is not None,"hd_agent_exists":agent is not None,"would_create_owner_user":user is None,"would_create_hd_agent":agent is None,"agent_role_missing_requires_review":bool(user and agent and AGENT_ROLE not in _roles(user)),"invitation_will_send":False,"password_changed":False}));return
        created_user=user is None
        if user is None:
            if SECRET.exists():
                st=SECRET.lstat()
                if not stat.S_ISREG(st.st_mode) or SECRET.is_symlink() or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600: raise RuntimeError("Unsafe owner login secret")
                values=dict(line.split("=",1) for line in SECRET.read_text().splitlines() if "=" in line)
                password=values.get("OWNER_CRM_PASSWORD","")
                if not password: raise RuntimeError("Unsafe owner login secret")
            else:
                password=secrets.token_urlsafe(36)
                fd=os.open(SECRET,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
                with os.fdopen(fd,"w") as f:f.write("OWNER_CRM_USERNAME="+USER+"\nOWNER_CRM_PASSWORD="+password+"\n")
            client._request("POST","/api/resource/User",body={"email":USER,"first_name":"Steven","enabled":1,"user_type":"System User","send_welcome_email":0,"new_password":password,"roles":[{"role":r} for r in ROLES]})
            user=_owner_user(client)
            if user is None: raise RuntimeError("Frappe did not create the dedicated owner identity")
            _validate_owner(user)
        created_agent=agent is None
        if agent is None: _create_agent(client,user)
        elif AGENT_ROLE not in _roles(user) or not _flag(agent.get("is_active")):
            raise RuntimeError("Existing owner HD Agent requires review; left unchanged")
        user=_owner_user(client); agent=_owner_agent(client)
        if user is None or agent is None or AGENT_ROLE not in _roles(user) or not _flag(agent.get("is_active")): raise RuntimeError("Native owner Helpdesk reconciliation did not verify")
        print(json.dumps({"status":"applied","owner_user_created":created_user,"hd_agent_created":created_agent,"native_roles_verified":True,"native_hd_agent_verified":True,"password_changed":False,"invitation_sent":False}))
    finally:client.logout();client.close()

if __name__=="__main__":main()
