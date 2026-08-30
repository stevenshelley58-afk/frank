"""Fail-closed Hermes action dispatch boundary (no local execution)."""
from __future__ import annotations
import json, os, re, urllib.parse, urllib.request
from typing import Any, Mapping
import yaml

class DispatchError(ValueError): pass
_KEY = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
_ID = re.compile(r"^[a-z][a-z0-9_-]{1,127}$")

def _origin(value: str) -> str:
    p=urllib.parse.urlsplit(value)
    if p.scheme not in {"http","https"} or p.username or p.password or p.query or p.fragment or p.path not in {"","/"}: raise DispatchError("Hermes origin is invalid")
    return urllib.parse.urlunsplit((p.scheme,p.netloc,"","",""))

class HermesDispatcher:
    def __init__(self, config_path, *, opener=None, timeout=30):
        self.config_path=config_path; self.opener=opener or urllib.request.urlopen; self.timeout=max(1,min(60,int(timeout)))
    def _actions(self):
        with open(self.config_path, encoding="utf-8") as f: value=yaml.safe_load(f)
        rows=value.get("actions",[]) if isinstance(value,Mapping) else []
        return {str(x.get("id")):x for x in rows if isinstance(x,Mapping) and isinstance(x.get("id"),str)}
    def dispatch(self, *, action_id, target_id, arguments, attestation):
        if not isinstance(attestation,str) or not attestation.strip(): raise DispatchError("operator attestation required")
        action=self._actions().get(action_id)
        if not action or action.get("enabled") is not True: raise DispatchError("action is disabled")
        if target_id not in action.get("target_allowlist",[]): raise DispatchError("target is not allowlisted")
        if not isinstance(arguments,Mapping) or not _KEY.fullmatch(str(arguments.get("idempotency_key",""))): raise DispatchError("idempotency key is required")
        specs=action.get("arguments",{})
        if set(arguments)-set(specs): raise DispatchError("unsupported action argument")
        for key,spec in specs.items():
            if key not in arguments: raise DispatchError("missing action argument")
            if spec.get("type")=="stable_id" and not isinstance(arguments[key],str): raise DispatchError("invalid stable ID argument")
            if spec.get("type")=="revision" and (not isinstance(arguments[key],str) or len(arguments[key])>256): raise DispatchError("invalid revision argument")
            if spec.get("type")=="enum" and arguments[key] not in spec.get("values",[]): raise DispatchError("invalid enum argument")
        origin=_origin(os.environ.get("HERMES_ENDPOINT","")); payload=json.dumps({"action_id":action_id,"target_id":target_id,"arguments":dict(arguments),"operator_attestation":attestation},separators=(",",":"),ensure_ascii=False).encode()
        if len(payload)>128*1024: raise DispatchError("action body exceeds bound")
        req=urllib.request.Request(origin+"/v1/control/actions",data=payload,method="POST",headers={"Content-Type":"application/json","Accept":"application/json"})
        try:
            with self.opener(req,timeout=self.timeout) as response:
                final_url = response.geturl() if hasattr(response, "geturl") else origin + "/v1/control/actions"
                parsed_final = urllib.parse.urlsplit(final_url)
                final_origin = _origin(urllib.parse.urlunsplit((parsed_final.scheme, parsed_final.netloc, "", "", "")))
                if final_origin != origin or parsed_final.path != "/v1/control/actions":
                    raise DispatchError("Hermes redirect is invalid")
                raw=response.read(128*1024+1)
            if len(raw)>128*1024: raise DispatchError("Hermes response exceeds bound")
            result=json.loads(raw.decode())
        except DispatchError: raise
        except Exception as e: raise DispatchError("Hermes is unavailable; action remains a preview") from e
        if not isinstance(result,Mapping): raise DispatchError("Hermes returned invalid receipt")
        return {k:result[k] for k in ("status","receipt_id","rollback_action_id","idempotency_key","preview") if k in result}
