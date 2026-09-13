import contextlib,io,json,sys
from operate import main
sys.argv=[__file__,"run"];b=io.StringIO()
with contextlib.redirect_stdout(b):main()
v=json.loads(b.getvalue());
if v.get("status") not in {"ok","paused"}:print(json.dumps(v))