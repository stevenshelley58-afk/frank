from pathlib import Path
import json, subprocess
ROOT=Path("/srv/hermes/owner-crm-sync")
def _run(params, **kwargs):
 mode=params.get("mode","preview")
 if mode not in {"preview","apply"}: raise RuntimeError("mode must be preview or apply")
 out=subprocess.run([str(ROOT/"connector.py"),mode],check=False,capture_output=True,text=True,timeout=120)
 return out.stdout
def register(ctx):
 ctx.register_tool(name="owner_crm_contact_sync",toolset="owner-crm",schema={"name":"owner_crm_contact_sync","description":"Preview or apply deterministic Blockwise Contact projection.","parameters":{"type":"object","properties":{"mode":{"enum":["preview","apply"]}},"required":["mode"],"additionalProperties":False}},handler=_run,description="Owner CRM Contact sync.")
