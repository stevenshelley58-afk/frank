"""Deterministic tests for the Frank deployment identity, lock, and validation.

These tests never build, push, deploy, or touch the real production lock or
release state: the deployment lock path is injected via FRANK_DEPLOY_LOCK_FILE,
release state lives in a temporary directory, and external commands (git,
docker, realpath) are stubbed through PATH.
"""

import fcntl
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

WINDOW_DIR = Path(__file__).resolve().parent.parent
DEPLOY_SH = WINDOW_DIR / "deploy.sh"
DEPLOY_LIB = WINDOW_DIR / "deploy_lib.sh"
COMPOSE_FILE = WINDOW_DIR / "docker-compose.yml"

CANDIDATE = "b" * 40
OTHER = "a" * 40
PREVIOUS = "c" * 40

GIT_STUB = r"""#!/usr/bin/env bash
if [[ -n "${FRANK_TEST_STUB_LOG:-}" ]]; then printf '%s\n' "git $*" >> "$FRANK_TEST_STUB_LOG"; fi
case " $* " in
  *" rev-parse HEAD "*)
    printf '%s\n' "${FRANK_TEST_GIT_SHA:-}"; exit 0 ;;
  *" diff --quiet "*)
    [[ "${FRANK_TEST_GIT_DIRTY:-0}" == "1" ]] && exit 1
    exit 0 ;;
  *" merge-base --is-ancestor "*)
    [[ "${FRANK_TEST_GIT_UNPUSHED:-0}" == "1" ]] && exit 1
    exit 0 ;;
esac
exit 0
"""

REALPATH_STUB = r"""#!/usr/bin/env bash
# deploy.sh only uses realpath for the canonical-repository check.
printf '%s\n' /projects/frank
"""

DOCKER_STUB = r"""#!/usr/bin/env bash
if [[ -n "${FRANK_TEST_STUB_LOG:-}" ]]; then printf '%s\n' "docker $*" >> "$FRANK_TEST_STUB_LOG"; fi
if [[ "$1 $2" == "compose config" ]]; then
  if [[ "$*" == *"--format json"* ]]; then
    [[ -n "${FRANK_TEST_COMPOSE_JSON:-}" ]] && cat "$FRANK_TEST_COMPOSE_JSON"
    exit 0
  fi
  exit 0
fi
if [[ "$1 $2" == "image inspect" ]]; then
  if [[ "$*" == *"RepoDigests"* ]]; then
    printf '%s\n' "${FRANK_TEST_REPO_DIGESTS:-[]}"
    exit 0
  fi
  if [[ "$*" == *"--format"* ]]; then
    printf '%s\n' "${FRANK_TEST_IMAGE_LABEL:-}"
    exit 0
  fi
  [[ "${FRANK_TEST_IMAGE_MISSING:-0}" == "1" ]] && exit 1
  exit 0
fi
if [[ "$1" == "inspect" ]]; then
  if [[ "$2" == "frank-agenttrail" ]]; then
    printf '%s\n' "${FRANK_TEST_RUNNING_TRAIL_IMAGE:-}"
    exit 0
  fi
  printf '%s\n' "${FRANK_TEST_RUNNING_WINDOW_IMAGE:-}"
  exit 0
fi
exit 0
"""


class DeployDeterminismTest(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.lock_file = self.root / "frank-deploy.lock"
        self.release_dir = self.root / "release"
        self.repo_dir = self.root / "repo"
        self.repo_dir.mkdir()
        self.stub_log = self.root / "stub.log"
        self.write_stub("git", GIT_STUB)
        self.write_stub("realpath", REALPATH_STUB)
        self.write_stub("docker", DOCKER_STUB)

    def write_stub(self, name, body):
        path = self.bin_dir / name
        path.write_text(body)
        path.chmod(0o755)

    def deploy_env(self, **overrides):
        env = dict(os.environ)
        env["PATH"] = f"{self.bin_dir}:{env.get('PATH', '')}"
        env["FRANK_DEPLOY_LOCK_FILE"] = str(self.lock_file)
        env["FRANK_REPO"] = str(self.repo_dir)
        env["FRANK_TEST_STUB_LOG"] = str(self.stub_log)
        env["FRANK_TEST_GIT_SHA"] = CANDIDATE
        for key, value in overrides.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        return env

    def run_deploy(self, **overrides):
        return subprocess.run(
            ["bash", str(DEPLOY_SH)],
            env=self.deploy_env(**overrides),
            capture_output=True,
            text=True,
            timeout=60,
        )

    def run_lib(self, script, **overrides):
        full_script = (
            "set -euo pipefail\n"
            f"source {DEPLOY_LIB}\n"
            f"{script}\n"
        )
        return subprocess.run(
            ["bash", "-c", full_script],
            env=self.deploy_env(**overrides),
            capture_output=True,
            text=True,
            timeout=60,
        )

    def stub_calls(self):
        if not self.stub_log.exists():
            return []
        return [
            line
            for line in self.stub_log.read_text().splitlines()
            if line.startswith("docker ")
        ]

    # --- script hygiene ---------------------------------------------------

    def test_shell_scripts_pass_bash_syntax_check(self):
        for path in (DEPLOY_SH, DEPLOY_LIB):
            result = subprocess.run(
                ["bash", "-n", str(path)], capture_output=True, text=True
            )
            self.assertEqual(
                result.returncode, 0, f"bash -n {path}: {result.stderr}"
            )

    def test_compose_never_names_mutable_tag_as_identity(self):
        text = COMPOSE_FILE.read_text()
        self.assertIn("image: frank-window:${FRANK_WINDOW_IMAGE_TAG:?", text)
        self.assertIn("image: frank-agenttrail:${FRANK_AGENTTRAIL_IMAGE_TAG:?", text)
        self.assertNotIn("frank-window:current", text)
        self.assertNotIn("frank-agenttrail:current", text)

    # --- (a) exclusive deployment lock ------------------------------------

    def test_concurrent_deploy_rejected_immediately_while_lock_held(self):
        self.lock_file.write_text("")
        with open(self.lock_file, "r+") as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_deploy(FRANK_DEPLOY_DRY_RUN="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "another Frank deployment is in progress", result.stderr
        )
        # The lock is acquired before any other command runs.
        self.assertFalse(self.stub_log.exists())

    def test_lock_file_created_private_and_acquirable_when_free(self):
        result = self.run_deploy(FRANK_DEPLOY_DRY_RUN="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("dry-run ok", result.stdout)
        self.assertEqual(self.lock_file.stat().st_mode & 0o777, 0o600)

    # --- dry-run identity preflight ---------------------------------------

    def test_dry_run_exports_immutable_tags_and_skips_docker(self):
        result = self.run_deploy(FRANK_DEPLOY_DRY_RUN="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"for {CANDIDATE}", result.stdout)
        self.assertEqual(self.stub_calls(), [])

    def test_dry_run_refuses_unpushed_revision(self):
        result = self.run_deploy(FRANK_DEPLOY_DRY_RUN="1", FRANK_TEST_GIT_UNPUSHED="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unpushed Frank revision", result.stderr)

    def test_dry_run_refuses_uncommitted_revision(self):
        result = self.run_deploy(FRANK_DEPLOY_DRY_RUN="1", FRANK_TEST_GIT_DIRTY="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("uncommitted Frank revision", result.stderr)

    # --- (b) image tag / SHA disagreement ---------------------------------

    def test_tag_not_encoding_candidate_sha_is_refused(self):
        refused = self.run_lib(
            f"frank_verify_tag_encodes_sha frank-window:current {CANDIDATE}"
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("does not encode candidate revision", refused.stderr)

        accepted = self.run_lib(
            f"frank_verify_tag_encodes_sha frank-window:{CANDIDATE} {CANDIDATE}"
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)

    def test_compose_resolved_current_tag_is_refused(self):
        current_fixture = self.root / "compose-current.json"
        current_fixture.write_text(
            '{"services": {'
            '"frank-window": {"image": "frank-window:current"},'
            '"frank-agenttrail": {"image": "frank-agenttrail:current"}}}'
        )
        refused = self.run_lib(
            f"frank_verify_compose_images {CANDIDATE}",
            FRANK_TEST_COMPOSE_JSON=str(current_fixture),
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("compose still names mutable tag", refused.stderr)

        good_fixture = self.root / "compose-good.json"
        good_fixture.write_text(
            '{"services": {'
            f'"frank-window": {{"image": "frank-window:{CANDIDATE}"}},'
            f'"frank-agenttrail": {{"image": "frank-agenttrail:{CANDIDATE}"}}'
            '}}'
        )
        accepted = self.run_lib(
            f"frank_verify_compose_images {CANDIDATE}",
            FRANK_TEST_COMPOSE_JSON=str(good_fixture),
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)

    def test_missing_built_image_is_refused(self):
        refused = self.run_lib(
            f"frank_verify_image_exists frank-window:{CANDIDATE}",
            FRANK_TEST_IMAGE_MISSING="1",
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("is missing", refused.stderr)

    # --- (c) image revision label disagreement ----------------------------

    def test_image_label_disagreement_is_refused(self):
        refused = self.run_lib(
            f"frank_verify_image_label frank-window:{CANDIDATE} {CANDIDATE}",
            FRANK_TEST_IMAGE_LABEL=OTHER,
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn(
            f"label {OTHER} != candidate revision {CANDIDATE}", refused.stderr
        )

        accepted = self.run_lib(
            f"frank_verify_image_label frank-window:{CANDIDATE} {CANDIDATE}",
            FRANK_TEST_IMAGE_LABEL=CANDIDATE,
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)

    # --- (d) approved-SHA disagreement ------------------------------------

    def test_approved_sha_disagreement_is_detected(self):
        self.release_dir.mkdir()
        approved = self.release_dir / "approved-sha"
        approved.write_text(OTHER + "\n")
        refused = self.run_lib(
            f"frank_verify_approved_sha {CANDIDATE} {approved}"
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn(
            f"approved-sha disagreement: recorded {OTHER} != candidate {CANDIDATE}",
            refused.stderr,
        )

        approved.write_text(CANDIDATE + "\n")
        accepted = self.run_lib(
            f"frank_verify_approved_sha {CANDIDATE} {approved}"
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)

    def test_approved_sha_write_is_atomic_and_verified(self):
        self.release_dir.mkdir()
        result = self.run_lib(
            f"frank_write_approved_sha {CANDIDATE} {self.release_dir} && "
            f"frank_verify_approved_sha {CANDIDATE} {self.release_dir / 'approved-sha'}"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        written = self.release_dir / "approved-sha"
        self.assertEqual(written.read_text(), CANDIDATE + "\n")
        self.assertEqual(written.stat().st_mode & 0o777, 0o644)

    def test_approved_sha_write_refuses_non_revision(self):
        self.release_dir.mkdir()
        result = self.run_lib(
            f"frank_write_approved_sha frank-window:current {self.release_dir}"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.release_dir / "approved-sha").exists())

    def test_invalid_approved_sha_file_is_refused(self):
        self.release_dir.mkdir()
        approved = self.release_dir / "approved-sha"
        approved.write_text("frank-window:current\n")
        result = self.run_lib(f"frank_read_approved_sha {approved}")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid approved-sha file", result.stderr)

    # --- (e) rollback preserves the previous known-good image --------------

    def test_rollback_receipt_records_previous_sha_and_digests(self):
        self.release_dir.mkdir()
        (self.release_dir / "approved-sha").write_text(PREVIOUS + "\n")
        result = self.run_lib(
            f"frank_record_rollback_receipt {self.release_dir} {self.repo_dir}",
            FRANK_TEST_RUNNING_WINDOW_IMAGE=f"sha256:{'d' * 64}",
            FRANK_TEST_RUNNING_TRAIL_IMAGE=f"sha256:{'e' * 64}",
            FRANK_TEST_REPO_DIGESTS='["registry.example/frank@sha256:deadbeef"]',
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = (self.release_dir / "rollback-receipt.env").read_text()
        self.assertIn(f"previous_sha={PREVIOUS}", receipt)
        self.assertIn(f"previous_window_image=sha256:{'d' * 64}", receipt)
        self.assertIn("registry.example/frank@sha256:deadbeef", receipt)

    def test_rollback_never_retags_or_deletes_previous_image(self):
        self.release_dir.mkdir()
        (self.release_dir / "rollback-receipt.env").write_text(
            f"previous_sha={PREVIOUS}\n"
            f"previous_window_image=sha256:{'d' * 64}\n"
            "previous_window_digests=[]\n"
            "previous_trail_image=\n"
            "previous_trail_digests=\n"
        )
        (self.root / "prev-window-compose.yml").write_text("services: {}\n")
        (self.root / "prev-caddy-compose.yml").write_text("services: {}\n")
        result = self.run_lib(
            "frank_restore_previous_runtime "
            f"{self.release_dir} "
            f'"{self.root / "prev-window-compose.yml"}:frank-window" '
            f'"{self.root / "prev-caddy-compose.yml"}:frank-caddy"'
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"revision {PREVIOUS}", result.stderr)
        self.assertIn(f"image sha256:{'d' * 64}", result.stderr)
        calls = self.stub_calls()
        self.assertTrue(
            any(
                f"compose -f {self.root / 'prev-window-compose.yml'} up -d frank-window"
                in call
                for call in calls
            ),
            calls,
        )
        self.assertTrue(
            any(
                f"compose -f {self.root / 'prev-caddy-compose.yml'} up -d frank-caddy"
                in call
                for call in calls
            ),
            calls,
        )
        self.assertTrue(
            all(" rmi " not in call and not call.startswith("docker tag ") for call in calls),
            calls,
        )


    def make_immutable_repo(self):
        repo = self.root / "immutable-repo"
        repo.mkdir()
        copied = [
            "Dockerfile", "docker-compose.yml", "Caddyfile", "deploy_lib.sh",
            "infra/mini_builder", "infra/memory", "infra/control_plane",
            "infra/cleanup", "infra/discovery", "infra/evaluations",
            "infra/retention", "scripts", "graph",
        ]
        target = repo / "apps" / "window"
        target.mkdir(parents=True)
        for relative in copied:
            source = WINDOW_DIR / relative
            destination = target / relative
            if source.is_dir():
                shutil.copytree(source, destination)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        shutil.copytree(WINDOW_DIR.parents[1] / "governance" / "control-plane", repo / "governance" / "control-plane")
        subprocess.run(["git", "init", "-b", "main", str(repo)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.name", "Frank Test"], check=True)
        submodules = {
            "agenttrail": {
                "package.json": "agenttrail-pinned\n",
                "bin/agenttrail.mjs": "agenttrail-bin\n",
                "public/index.html": "agenttrail-public\n",
            },
            "archify": {"archify/bin/archify.mjs": "archify-pinned\n"},
        }
        self.submodule_pins = {}
        for name, files in submodules.items():
            source_repo = self.root / f"{name}-source"
            source_repo.mkdir()
            subprocess.run(["git", "init", "-b", "main", str(source_repo)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(source_repo), "config", "user.email", "test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(source_repo), "config", "user.name", "Frank Test"], check=True)
            for relative, content in files.items():
                output = source_repo / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(content)
            subprocess.run(["git", "-C", str(source_repo), "add", "."], check=True)
            subprocess.run(["git", "-C", str(source_repo), "commit", "-m", "pinned"], check=True, capture_output=True)
            self.submodule_pins[name] = subprocess.check_output(["git", "-C", str(source_repo), "rev-parse", "HEAD"], text=True).strip()
            subprocess.run([
                "git", "-c", "protocol.file.allow=always", "-C", str(repo),
                "submodule", "add", str(source_repo), f"apps/window/vendor/{name}",
            ], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-m", "fixture"], check=True, capture_output=True)
        candidate = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        origin = self.root / "origin.git"
        subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(repo), "remote", "add", "origin", str(origin)], check=True)
        subprocess.run(["git", "-C", str(repo), "push", "-u", "origin", "main"], check=True, capture_output=True)
        return repo, candidate

    def immutable_env(self, repo, package_base):
        tripwire_bin = self.root / "immutable-bin"
        tripwire_bin.mkdir(exist_ok=True)
        docker = tripwire_bin / "docker"
        docker.write_text("#!/usr/bin/env bash\nprintf 'docker invoked\n' >> \"$FRANK_DOCKER_TRIPWIRE\"\nexit 99\n")
        docker.chmod(0o755)
        env = dict(os.environ)
        env.update({
            "PATH": f"{tripwire_bin}:/usr/bin:/bin",
            "FRANK_DOCKER_TRIPWIRE": str(self.root / "docker-tripwire.log"),
            "FRANK_REPO": str(repo),
            "FRANK_TEST_CANONICAL_REPO": str(repo),
            "FRANK_IMMUTABLE_PACKAGE_BASE": str(package_base),
            "FRANK_DEPLOY_LOCK_FILE": str(self.root / "immutable.lock"),
            "FRANK_DEPLOY_DRY_RUN": "1",
        })
        return env

    def test_immutable_package_excludes_dirty_mini_and_cleans_up(self):
        repo, candidate = self.make_immutable_repo()
        sentinel = repo / "apps/window/web/mini/immutable-test-sentinel.txt"
        sentinel.parent.mkdir(parents=True)
        sentinel.write_text("must not be archived\n")
        package_base = self.root / "packages"
        script = (
            f'package="$(frank_create_immutable_package {repo} {candidate})"\n'
            'test -f "$package/apps/window/Dockerfile"\n'
            'test ! -e "$package/apps/window/web/mini/immutable-test-sentinel.txt"\n'
            'frank_cleanup_immutable_package "$package"\n'
            'test ! -e "$package"\n'
        )
        env = self.immutable_env(repo, package_base)
        result = subprocess.run(
            ["bash", "-c", "set -euo pipefail\nsource %s\n%s" % (DEPLOY_LIB, script)],
            env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_immutable_package_uses_parent_pinned_submodule_bytes(self):
        repo, candidate = self.make_immutable_repo()
        agenttrail = repo / "apps/window/vendor/agenttrail"
        (agenttrail / "package.json").write_text("dirty-worktree-bytes\n")
        subprocess.run(["git", "-C", str(agenttrail), "add", "package.json"], check=True)
        subprocess.run(["git", "-C", str(agenttrail), "commit", "-m", "later head"], check=True, capture_output=True)
        self.assertNotEqual(
            subprocess.check_output(["git", "-C", str(agenttrail), "rev-parse", "HEAD"], text=True).strip(),
            self.submodule_pins["agenttrail"],
        )
        package_base = self.root / "packages"
        script = (
            f'package="$(frank_create_immutable_package {repo} {candidate})"\n'
            'grep -Fxq agenttrail-pinned "$package/apps/window/vendor/agenttrail/package.json"\n'
            'grep -Fxq archify-pinned "$package/apps/window/vendor/archify/archify/bin/archify.mjs"\n'
            'frank_cleanup_immutable_package "$package"\n'
        )
        result = subprocess.run(
            ["bash", "-c", "set -euo pipefail\nsource %s\n%s" % (DEPLOY_LIB, script)],
            env=self.immutable_env(repo, package_base), capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(package_base.iterdir()) if package_base.exists() else False)

    def test_immutable_package_missing_pinned_submodule_object_fails_and_cleans(self):
        repo, candidate = self.make_immutable_repo()
        agenttrail = repo / "apps/window/vendor/agenttrail"
        shutil.rmtree(agenttrail)
        shutil.rmtree(repo / ".git/modules/apps/window/vendor/agenttrail")
        agenttrail.mkdir()
        subprocess.run(["git", "init", "-b", "main", str(agenttrail)], check=True, capture_output=True)
        package_base = self.root / "packages"
        result = subprocess.run(
            ["bash", "-c", f"set -euo pipefail\nsource {DEPLOY_LIB}\nfrank_create_immutable_package {repo} {candidate}"],
            env=self.immutable_env(repo, package_base), capture_output=True, text=True, timeout=60,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pinned submodule object is unavailable", result.stderr)
        self.assertFalse(any(package_base.iterdir()) if package_base.exists() else False)

    def test_immutable_dry_run_initializes_real_context_without_docker(self):
        repo, candidate = self.make_immutable_repo()
        sentinel = repo / "apps/window/web/mini/uncommitted.txt"
        sentinel.parent.mkdir(parents=True)
        sentinel.write_text("Verdent-owned dirty file\n")
        package_base = self.root / "packages"
        env = self.immutable_env(repo, package_base)
        result = subprocess.run(
            ["bash", str(DEPLOY_SH), "--revision", candidate],
            env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"dry-run ok: identity and preflight validation passed for {candidate}", result.stdout)
        self.assertFalse((self.root / "docker-tripwire.log").exists())
        self.assertFalse(any(package_base.iterdir()) if package_base.exists() else False)

    def test_immutable_dry_run_rejects_canonical_hook_mismatch_before_live_work(self):
        repo, candidate = self.make_immutable_repo()
        hook = repo / "apps/window/infra/memory/expose.sh"
        hook.write_text(hook.read_text() + "\n# mismatched host hook\n")
        package_base = self.root / "packages"
        result = subprocess.run(
            ["bash", str(DEPLOY_SH), "--revision", candidate],
            env=self.immutable_env(repo, package_base), capture_output=True, text=True, timeout=60,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical host-hook inputs differ", result.stderr)
        self.assertFalse(any(package_base.iterdir()) if package_base.exists() else False)

    def test_immutable_revision_rejects_invalid_commit(self):
        repo, _ = self.make_immutable_repo()
        result = subprocess.run(
            ["bash", "-c", f"source {DEPLOY_LIB}; frank_resolve_immutable_revision {repo} {'d' * 40}"],
            env=dict(os.environ), capture_output=True, text=True, timeout=60,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid immutable revision", result.stderr)

    def test_immutable_cleanup_refuses_unsafe_path(self):
        package_base = self.root / "packages"
        unsafe = package_base / "keep-me"
        unsafe.mkdir(parents=True)
        result = self.run_lib(
            f"frank_cleanup_immutable_package {unsafe}",
            FRANK_IMMUTABLE_PACKAGE_BASE=str(package_base),
            PATH=os.environ["PATH"],
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(unsafe.is_dir())
        self.assertIn("unsafe immutable package path", result.stderr)

    def test_deploy_keeps_caddy_validation_and_approval_write_in_release_order(self):
        text = DEPLOY_SH.read_text()
        caddy_command = 'docker run --rm \\\n  --env-file "$caddy_secret_file" \\\n  --volume "$FRANK_CADDYFILE:/etc/caddy/Caddyfile:ro"'
        self.assertIn(caddy_command, text)
        self.assertNotIn('--volume "$app/Caddyfile:/etc/caddy/Caddyfile:ro"', text)
        canary = text.index("https://frank.fail/mini-frank/")
        write = text.index('frank_write_approved_sha "$candidate_sha" "$release_dir"')
        verify = text.index('frank_verify_approved_sha "$candidate_sha" "$release_dir/approved-sha"')
        self.assertLess(canary, write)
        self.assertLess(write, verify)
        self.assertEqual(text.count('echo "deployed $candidate_sha"'), 1)

    def test_immutable_path_invokes_each_verified_canonical_hook_once(self):
        deploy = DEPLOY_SH.read_text()
        memory = (WINDOW_DIR / "infra" / "memory" / "expose.sh").read_text()
        installer = (WINDOW_DIR / "infra" / "control_plane" / "install.sh").read_text()
        post_deploy = (WINDOW_DIR / "infra" / "control_plane" / "post-deploy.sh").read_text()
        self.assertEqual(deploy.count('bash "$host_app/infra/memory/expose.sh"'), 1)
        self.assertEqual(deploy.count('bash "$host_app/infra/control_plane/install.sh"'), 1)
        self.assertEqual(deploy.count('post_deploy_hook="$host_app/infra/control_plane/post-deploy.sh"'), 1)
        self.assertEqual(deploy.count('bash "$app/infra/memory/expose.sh"'), 1)
        self.assertEqual(deploy.count('bash "$app/infra/control_plane/install.sh"'), 1)
        self.assertEqual(deploy.count('post_deploy_hook="$app/infra/control_plane/post-deploy.sh"'), 1)
        self.assertLess(deploy.index("frank_verify_canonical_host_inputs"), deploy.index('install -d -m 0700 -- "$secret_dir"'))
        for hook in (memory, installer, post_deploy):
            self.assertIn("FRANK_EXPECTED_REVISION", hook)
            self.assertIn("canonical", hook)
            self.assertIn("--end-of-options", hook)

    def test_empty_immutable_revision_is_rejected_before_deploy_work(self):
        result = subprocess.run(["bash", str(DEPLOY_SH), "--revision", ""], env=self.deploy_env(), capture_output=True, text=True, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--revision requires a commit", result.stderr)
        self.assertFalse(self.stub_log.exists())

if __name__ == "__main__":
    unittest.main()
