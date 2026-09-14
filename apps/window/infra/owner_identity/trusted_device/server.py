#!/usr/bin/env python3
"""Fail-closed Tailscale device attestation for the owner edge."""
import argparse, hmac, http.client, ipaddress, json, os, socket, sys
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
TAILNET_RANGES=(ipaddress.ip_network("100.64.0.0/10"),ipaddress.ip_network("fd7a:115c:a1e0::/48")); MAX_WHOIS_BYTES=1024*1024
class ConfigurationError(ValueError): pass
def identifier(value: Any)->str:
 if isinstance(value,bool) or not isinstance(value,(str,int)): raise ConfigurationError("identifier must be a string or integer")
 text=str(value)
 if not text: raise ConfigurationError("identifier must not be empty")
 return text
@dataclass(frozen=True)
class Device: node_id:str; user_id:str; label:str
@dataclass(frozen=True)
class Config: gate_secret:str; proof_secret:str; devices:tuple[Device,...]
def load_config(path:Path)->Config:
 try: parsed=json.loads(path.read_text(encoding="utf-8"))
 except (OSError,json.JSONDecodeError) as exc: raise ConfigurationError("cannot read configuration") from exc
 if not isinstance(parsed,dict): raise ConfigurationError("configuration must be an object")
 gate,proof,rows=parsed.get("gate_secret"),parsed.get("proof_secret"),parsed.get("devices")
 if not isinstance(gate,str) or not gate or not isinstance(proof,str) or not proof: raise ConfigurationError("secrets must be nonempty strings")
 if not isinstance(rows,list): raise ConfigurationError("devices must be a list")
 devices=[]; pairs=set()
 for row in rows:
  if not isinstance(row,dict) or set(row)!={"node_id","user_id","label"}: raise ConfigurationError("each device needs only node_id, user_id and label")
  node_id,user_id,label=identifier(row["node_id"]),identifier(row["user_id"]),row["label"]
  if not isinstance(label,str) or not label: raise ConfigurationError("device label must be a nonempty string")
  if (node_id,user_id) in pairs: raise ConfigurationError("duplicate allowed device")
  pairs.add((node_id,user_id)); devices.append(Device(node_id,user_id,label))
 return Config(gate,proof,tuple(devices))
def validated_tailnet_address(raw:str|None)->str|None:
 if not isinstance(raw,str): return None
 try: address=ipaddress.ip_address(raw)
 except ValueError: return None
 return str(address) if any(address in network for network in TAILNET_RANGES) else None
class UnixHTTPConnection(http.client.HTTPConnection):
 def __init__(self,socket_path:str,timeout:float): super().__init__("localhost",timeout=timeout); self.socket_path=socket_path
 def connect(self)->None:
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); self.sock.settimeout(self.timeout); self.sock.connect(self.socket_path)
def whois(socket_path:str,address:str,timeout:float)->dict[str,Any]:
 conn=UnixHTTPConnection(socket_path,timeout)
 try:
  conn.request("GET","/localapi/v0/whois?addr="+quote(address,safe=":")); response=conn.getresponse(); body=response.read(MAX_WHOIS_BYTES+1)
  if response.status!=200 or len(body)>MAX_WHOIS_BYTES: raise RuntimeError("localapi whois failed")
  parsed=json.loads(body)
  if not isinstance(parsed,dict): raise RuntimeError("localapi whois is not an object")
  return parsed
 finally: conn.close()
def is_allowed(config:Config,record:dict[str,Any])->bool:
 try:
  node,profile=record["Node"],record["UserProfile"]
  if not isinstance(node,dict) or not isinstance(profile,dict): return False
  stable_id,node_user,profile_id=identifier(node["StableID"]),identifier(node["User"]),identifier(profile["ID"])
 except (KeyError,ConfigurationError): return False
 return any(d.node_id==stable_id and d.user_id==node_user and d.user_id==profile_id for d in config.devices)
def trusted_proof(config:Config,remote_address:str|None,lookup:Callable[[str],dict[str,Any]])->str|None:
 address=validated_tailnet_address(remote_address)
 if address is None:return None
 try: record=lookup(address)
 except Exception:return None
 return config.proof_secret if is_allowed(config,record) else None
def serve(config:Config,bind:str,port:int,socket_path:str,timeout:float)->None:
 def lookup(address:str)->dict[str,Any]: return whois(socket_path,address,timeout)
 class Handler(BaseHTTPRequestHandler):
  server_version=""; sys_version=""
  def log_message(self,_format:str,*_args:object)->None:return
  def do_GET(self)->None:
   if self.path!="/verify":self.send_error(404);return
   presented=self.headers.get("X-Frank-Device-Gate")
   if not isinstance(presented,str) or not hmac.compare_digest(presented,config.gate_secret):self.send_response(403);self.send_header("Content-Length","0");self.end_headers();return
   proof=trusted_proof(config,self.headers.get("X-Frank-Device-Address"),lookup);self.send_response(200)
   if proof is not None:self.send_header("X-Frank-Trusted-Device",proof)
   self.send_header("Content-Length","0");self.end_headers()
 httpd=ThreadingHTTPServer((bind,port),Handler);httpd.daemon_threads=True;httpd.serve_forever()
def main()->int:
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--bind",default="172.31.50.1");parser.add_argument("--port",type=int,default=18089);parser.add_argument("--socket",default="/var/run/tailscale/tailscaled.sock");parser.add_argument("--timeout",type=float,default=2.0);parser.add_argument("--config")
 args=parser.parse_args();config_path=args.config or str(Path(os.environ.get("CREDENTIALS_DIRECTORY",""))/"config")
 try:config=load_config(Path(config_path))
 except ConfigurationError:return 2
 serve(config,args.bind,args.port,args.socket,args.timeout);return 0
if __name__=="__main__":sys.exit(main())
