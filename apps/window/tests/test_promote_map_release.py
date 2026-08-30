import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "apps" / "window" / "scripts" / "promote_map_release.py"


def test_repo_root_cli_bootstraps_graph_package_before_argument_work():
    missing = ROOT / "does-not-exist-map-receipt.json"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(missing)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert json.loads(result.stdout) == {
        "status": "failed",
        "error_code": "promotion_rejected",
    }
    assert "ModuleNotFoundError" not in result.stderr
