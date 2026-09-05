"""Deterministic tests for the Frank deployment identity, lock, and validation.

These tests never build, push, deploy, or touch the real production lock or
release state: the deployment lock path is injected via FRANK_DEPLOY_LOCK_FILE,
release state lives in a temporary directory, and external commands (git,
docker, realpath) are stubbed through PATH.
"""

import fcntl
import os
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


if __name__ == "__main__":
    unittest.main()
