"""Native Hermes no-agent script: stay quiet on clean runs, retain local receipt."""
import contextlib
import io
import json
import sys
from operate import main

sys.argv = [__file__, "run"]
buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    code = main()
value = json.loads(buffer.getvalue())
summary = value.get("summary", {})
if code or any(summary.get(key, 0) for key in ["held_ambiguous", "held_stale", "held_conflict", "failed"]):
    print(json.dumps(value))
sys.exit(code)
