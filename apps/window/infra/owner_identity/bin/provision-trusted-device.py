#!/usr/bin/env python3
"""Provision Authentik trusted-device flow; only the proof digest is persisted."""
from __future__ import annotations
import os, re
try: bootstrap
except NameError: import bootstrap
OWNER="owner"; GROUP="owner-workspace"; HEADER="X-Frank-Trusted-Device"; MARKER="frank_trusted_device_seeded_owner_uid"
def fail(s): raise SystemExit(f"trusted-device: {s}")
def proof_hash():
 v=os.environ.get("OWNER_TRUSTED_DEVICE_PROOF_SHA256","")
 if not re.fullmatch(r"[0-9a-f]{64}",v): fail("OWNER_TRUSTED_DEVICE_PROOF_SHA256 must be a lowercase SHA-256 digest")
 return v
def expressions(expected):
 common=f'''import hmac
from hashlib import sha256
from authentik.core.models import User
EXPECTED="{expected}"
HEADER="{HEADER}"
MARKER="{MARKER}"
def valid_proof():
    r=getattr(request,"http_request",None)
    supplied=r.headers.get(HEADER,"") if r else ""
    return isinstance(supplied,str) and bool(supplied) and hmac.compare_digest(sha256(supplied.encode("utf-8")).hexdigest(),EXPECTED)
def active_owner():
    return User.objects.filter(username="{OWNER}",is_active=True,groups__name="{GROUP}").distinct().first()
'''
 seed=common+'''
flow_plan=request.context.get("flow_plan")
owner=active_owner() if valid_proof() else None
if not flow_plan or not owner: return True
flow_plan.context["pending_user"]=owner
flow_plan.context[MARKER]=str(owner.uid)
return False
'''
 skip=common+'''
flow_plan=request.context.get("flow_plan")
if not flow_plan or not valid_proof(): return True
owner=active_owner(); pending=flow_plan.context.get("pending_user"); seeded_uid=flow_plan.context.get(MARKER)
return not bool(owner and pending and pending.pk and str(owner.uid)==str(pending.uid)==seeded_uid)
'''
 login=common+'''
flow_plan=request.context.get("flow_plan")
if not flow_plan: return False
if MARKER not in flow_plan.context: return True
owner=active_owner(); pending=flow_plan.context.get("pending_user")
return bool(valid_proof() and owner and pending and pending.pk and str(owner.uid)==str(pending.uid)==flow_plan.context.get(MARKER))
'''
 return seed,skip,login
def policy(n,e): return bootstrap.ensure_by_pk("/policies/expression/",{"name":n,"expression":e},f"trusted-device policy: {n}")
def binding(flow,name):
 rows=bootstrap.get(f"/flows/bindings/?target={flow['pk']}&page_size=100")["results"]
 found=[x for x in rows if x.get("stage_obj",{}).get("name")==name]
 if len(found)!=1 or not found[0].get("re_evaluate_policies"): fail(f"expected one run-time-re-evaluated {name} binding")
 return found[0]
def attach(b,p,label,failure_result):
 target=b.get("policybindingmodel_ptr_id")
 if not target: fail(f"{label} has no policy-binding target")
 rows=bootstrap.get(f"/policies/bindings/?target={target}&page_size=100")["results"]
 existing=next((x for x in rows if x.get("policy")==p["pk"]),None)
 wanted={"order":0,"enabled":True,"negate":False,"timeout":30,"failure_result":failure_result}
 if existing:
  drift={k:v for k,v in wanted.items() if existing.get(k)!=v}
  if drift:
   if bootstrap.DRY_RUN: bootstrap.updated.append(f"trusted-device binding: {label} [dry-run]")
   else: bootstrap.call("PATCH",f"/policies/bindings/{existing['pk']}/",drift); bootstrap.updated.append(f"trusted-device binding: {label}")
  else: bootstrap.unchanged.append(f"trusted-device binding: {label}")
  return
 if bootstrap.DRY_RUN: bootstrap.created.append(f"trusted-device binding: {label} [dry-run]"); return
 bootstrap.call("POST","/policies/bindings/",dict(target=target,policy=p["pk"],**wanted)); bootstrap.created.append(f"trusted-device binding: {label}")
def set_all(b,label):
 if b.get("policy_engine_mode")=="all": bootstrap.unchanged.append(f"trusted-device mode: {label}=all"); return
 if bootstrap.DRY_RUN: bootstrap.updated.append(f"trusted-device mode: {label}=all [dry-run]"); return
 bootstrap.call("PATCH",f"/flows/bindings/{b['pk']}/",{"policy_engine_mode":"all"}); bootstrap.updated.append(f"trusted-device mode: {label}=all")
def main():
 flow=bootstrap.find("/flows/instances/","slug","default-authentication-flow")
 if not flow or flow.get("designation")!="authentication": fail("default authentication flow missing")
 seed,skip,login=(policy(n,e) for n,e in zip(("frank-trusted-device-seed-owner","frank-trusted-device-skip-factor","frank-trusted-device-login-guard"),expressions(proof_hash())))
 ident=binding(flow,"default-authentication-identification"); password=binding(flow,"default-authentication-password"); mfa=binding(flow,"default-authentication-mfa-validation"); user_login=binding(flow,"default-authentication-login")
 # Identification was stock-empty at review time. Refuse an unknown policy rather
 # than letting it silently change the meaning of the trusted skip.
 ident_target=ident.get("policybindingmodel_ptr_id")
 ident_rows=bootstrap.get(f"/policies/bindings/?target={ident_target}&page_size=100")["results"]
 known={seed["pk"]}
 if any(row.get("policy") not in known for row in ident_rows): fail("identification has an unexpected stock policy")
 attach(ident,seed,"identification",True); attach(password,skip,"password",True); attach(mfa,skip,"MFA",True); attach(user_login,login,"User Login",False)
 # ALL means an unexpected passing policy can never bypass a false trusted guard.
 set_all(ident,"identification"); set_all(password,"password"); set_all(mfa,"MFA"); set_all(user_login,"User Login")
 print("trusted-device: provisioned flow bindings (proof hash only; no secret printed)")
if __name__=="__main__": raise SystemExit(main())
