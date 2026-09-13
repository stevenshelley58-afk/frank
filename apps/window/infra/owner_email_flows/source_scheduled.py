"""Native Hermes no-agent wrapper. Stay quiet on clean consent bridge runs."""
import contextlib
import io
import json
import sys
from source_operate import main

sys.argv = [__file__, "run"]
buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    code = main()
value = json.loads(buffer.getvalue())
if code or value.get("status") != "ok":
    print(json.dumps(value))
sys.exit(code)
