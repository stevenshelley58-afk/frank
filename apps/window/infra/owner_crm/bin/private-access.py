"""Use existing native Tailscale Serve for private owner apps. Never Funnel."""
import argparse,json,os,subprocess
from pathlib import Path

SERVICES={"8445":"http://127.0.0.1:18081","8446":"http://127.0.0.1:18104"}
def state():
    return json.loads(subprocess.check_output(["tailscale","serve","status","--json"],text=True))
def other_routes(config,host):
    return {"TCP":{k:v for k,v in config.get("TCP",{}).items() if k not in SERVICES},"Web":{k:v for k,v in config.get("Web",{}).items() if k not in {host+":"+p for p in SERVICES}},"AllowFunnel":config.get("AllowFunnel",{})}
def main():
    p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true");args=p.parse_args()
    source=Path(__file__).resolve().parent
    if subprocess.check_output(["git","-C",str(source),"status","--porcelain"],text=True).strip():raise RuntimeError("Clean committed source required")
    revision=subprocess.check_output(["git","-C",str(source),"rev-parse","HEAD"],text=True).strip()
    subprocess.run(["git","-C",str(source),"merge-base","--is-ancestor",revision,"origin/main"],check=True)
    status=json.loads(subprocess.check_output(["tailscale","status","--json"],text=True));host=status.get("Self",{}).get("DNSName","").rstrip(".")
    if status.get("BackendState")!="Running" or host not in status.get("CertDomains",[]):raise RuntimeError("Existing tailnet HTTPS enrollment required")
    before=state()
    for port,target in SERVICES.items():
        key=host+":"+port
        expected={"Handlers":{"/":{"Proxy":target}}}
        if key in before.get("Web",{}) and before["Web"][key]!=expected:raise RuntimeError("Private access port already belongs to another service")
        if port in before.get("TCP",{}) and before["TCP"][port]!={"HTTPS":True}:raise RuntimeError("Private access TCP port is occupied")
        if before.get("AllowFunnel",{}).get(key):raise RuntimeError("Refusing a public Funnel port")
    if args.apply:
        for port,target in SERVICES.items():
            subprocess.run(["tailscale","serve","--bg","--https="+port,target],check=True,capture_output=True,text=True)
        after=state()
        if other_routes(before,host)!=other_routes(after,host):raise RuntimeError("Unrelated native Serve state changed unexpectedly")
        for port,target in SERVICES.items():
            if after.get("Web",{}).get(host+":"+port)!={"Handlers":{"/":{"Proxy":target}}}:raise RuntimeError("Native private route not verified")
    print(json.dumps({"mode":"applied" if args.apply else "preview","crm_url":"https://"+host+":8445","notifications_url":"https://"+host+":8446","tailnet_only":True,"native_app_auth_required":True,"phone_receipt_verified":False}))
if __name__=="__main__":main()
