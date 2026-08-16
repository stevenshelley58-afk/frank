#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
compose_file="$script_dir/compose.yml"
config_merger="$script_dir/merge-hermes-config.py"

command -v python3 >/dev/null 2>&1 || { echo "test: python3 is required" >&2; exit 1; }
python3 - "$compose_file" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text(encoding="utf-8")
bootstrap = Path(sys.argv[1]).with_name("bootstrap-hermes.sh").read_text(encoding="utf-8")
instance_bootstrap = Path(sys.argv[1]).with_name("bootstrap-instance.sh").read_text(encoding="utf-8")
merger = Path(sys.argv[1]).with_name("merge-hermes-config.py").read_text(encoding="utf-8")
assert "127.0.0.1:${INFISICAL_HOST_PORT:-18082}:8080" in text
assert '"0.0.0.0:' not in text
assert '":::' not in text
assert re.search(r"image:\s+infisical/infisical:v0\.162\.14@sha256:[0-9a-f]{64}", text)
assert re.search(r"image:\s+postgres:16-alpine@sha256:[0-9a-f]{64}", text)
assert re.search(r"image:\s+redis:7\.4-alpine@sha256:[0-9a-f]{64}", text)
assert "name: infisical_pg_data" in text
assert "name: infisical_redis_data" in text
assert "internal: true" not in text
assert "loopback-only publication" in text
assert "ports:" in text
assert text.count("env_file:") == 1, "only backend may receive the complete Infisical env file"
assert "      - frank" not in text
assert "  frank:" not in text
assert 'POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER is required}' in text
assert 'POSTGRES_DB: ${POSTGRES_DB:?POSTGRES_DB is required}' in text
assert 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}' in text
assert 'REDIS_PASSWORD: ${REDIS_PASSWORD:?REDIS_PASSWORD is required}' in text
assert "HERMES_CONNECTIONS_INFISICAL_TOKEN" not in bootstrap
assert "login_response" not in bootstrap
assert "emit-once" not in bootstrap
assert 'role_slug="admin"' in bootstrap
assert 'api POST "/api/v1/projects/$project_id/roles"' not in bootstrap
assert 'built-in $role_slug project role' in bootstrap
assert 'api PATCH "/api/v1/projects/$project_id/memberships/identities/$identity_id"' in bootstrap
assert 'api POST "/api/v1/projects/$project_id/memberships/identities/$identity_id"' not in bootstrap
assert 'api POST \'/api/v2/folders\'' in bootstrap
assert 'INFISICAL_SECRET_PATH must be one safe top-level folder' in bootstrap
assert 'another project denied. Broker scope enforcement is verified after activation.' in bootstrap
assert 'for denied_kind in path environment project' not in bootstrap
assert "HERMES_CONNECTIONS_INFISICAL_URL=" not in bootstrap
assert "HERMES_CONNECTIONS_INFISICAL_PROJECT_ID=" not in bootstrap
assert "HERMES_CONNECTIONS_INFISICAL_ENVIRONMENT=" not in bootstrap
assert "HERMES_CONNECTIONS_INFISICAL_SECRET_PATH=" not in bootstrap
assert "plugins.entries.connections-agent.settings" in merger
deploy = Path(sys.argv[1]).with_name("deploy.sh").read_text(encoding="utf-8")
assert "backend did not become healthy within 180 seconds" in deploy
assert "backend became unhealthy during startup" in deploy
assert "/api/v1/admin/bootstrap" in instance_bootstrap
assert ".instance-bootstrap-token" in instance_bootstrap
assert 'rm -f -- "$token_file"' in instance_bootstrap
assert "identity.credentials.token" not in instance_bootstrap
assert "print(admin_token" not in instance_bootstrap
for key in ("enabled", "frank_url", "infisical_url", "infisical_project_id", "infisical_environment", "secret_path", "resend_secret_name"):
    assert f'"{key}"' in merger
print("static policy checks passed")
PY

for file in "$script_dir"/*.sh; do
  bash -n "$file"
done
echo "shell syntax checks passed"

tmp_config_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_config_dir"' EXIT
if python3 -c 'import ruamel.yaml' >/dev/null 2>&1; then
python3 - "$config_merger" "$tmp_config_dir/config.yaml" <<'PY'
from pathlib import Path
import hashlib
import subprocess
import sys

from ruamel.yaml import YAML

merger, config_path = sys.argv[1:]
config = Path(config_path)
config.write_text(
    """model:\n  provider: preserved\nplugins:\n  entries:\n    unrelated:\n      settings:\n        keep: yes\n    connections-agent:\n      settings:\n        old_value: preserved\n        infisical_url: old\n""",
    encoding="utf-8",
)
command = [
    sys.executable,
    merger,
    "--config", str(config),
    "--enabled", "true",
    "--frank-url", "http://127.0.0.1:18080",
    "--infisical-url", "http://127.0.0.1:18082",
    "--project-id", "project-id",
    "--environment", "production",
    "--secret-path", "/hermes",
    "--resend-secret-name", "RESEND_API_KEY",
]
subprocess.run(command, check=True)
first_hash = hashlib.sha256(config.read_bytes()).digest()
subprocess.run(command, check=True)
second_hash = hashlib.sha256(config.read_bytes()).digest()
assert first_hash == second_hash, "second merge was not byte-idempotent"

yaml = YAML(typ="safe")
document = yaml.load(config.read_text(encoding="utf-8"))
assert document["model"]["provider"] == "preserved"
assert document["plugins"]["entries"]["unrelated"]["settings"]["keep"] == "yes"
settings = document["plugins"]["entries"]["connections-agent"]["settings"]
assert settings["old_value"] == "preserved"
assert settings == {
    "old_value": "preserved",
    "infisical_url": "http://127.0.0.1:18082",
    "enabled": True,
    "frank_url": "http://127.0.0.1:18080",
    "infisical_project_id": "project-id",
    "infisical_environment": "production",
    "secret_path": "/hermes",
    "resend_secret_name": "RESEND_API_KEY",
}
print("Hermes config merge preservation/idempotence checks passed")
PY
else
  echo "ruamel.yaml unavailable in system python3; merge behavior is deferred to the selected Hermes venv"
fi

fake_hermes_python="$tmp_config_dir/hermes-python"
printf '%s\n' '#!/usr/bin/env bash' 'if [[ "$1" == "-c" && "$2" == "import ruamel.yaml" ]]; then exit 0; fi' 'exit 77' >"$fake_hermes_python"
chmod 0700 -- "$fake_hermes_python"
resolved_python="$(HERMES_PYTHON="$fake_hermes_python" bash "$script_dir/resolve-hermes-python.sh")"
[[ "$resolved_python" == "$fake_hermes_python" ]] || { echo "Hermes Python explicit selection failed" >&2; exit 1; }
if HERMES_PYTHON="$tmp_config_dir/missing-python" bash "$script_dir/resolve-hermes-python.sh" >/dev/null 2>&1; then
  echo "Hermes Python resolver did not fail closed for a missing explicit interpreter" >&2
  exit 1
fi
echo "Hermes Python selection/fail-closed checks passed"

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$script_dir"/*.sh
  echo "shellcheck passed"
else
  echo "shellcheck unavailable; bash syntax checks passed"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  INFISICAL_ENV_FILE="$script_dir/infisical.env.example" \
    docker compose --project-name infisical --env-file "$script_dir/infisical.env.example" -f "$compose_file" config --quiet
  echo "compose syntax check passed"
else
  echo "Docker Compose unavailable; static and shell checks passed"
fi
