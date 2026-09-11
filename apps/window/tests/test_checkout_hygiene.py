"""Checkout hygiene: the commit guard, the sweep and the release retention bound.

These tests exercise the real scripts against scratch repositories. They never
touch /projects/frank: the sweep and the prune take their roots from the
environment, which is also what lets them be tested at all.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "window"
CHECKOUT = APP / "infra" / "checkout"
GITHOOKS = CHECKOUT / "githooks"
PRE_COMMIT = GITHOOKS / "pre-commit"
POST_CHECKOUT = GITHOOKS / "post-checkout"
SWEEP = CHECKOUT / "frank-checkout-sweep.sh"
PRUNE = CHECKOUT / "frank-release-prune.sh"
INSTALLER = CHECKOUT / "install-checkout-hygiene.sh"

GIT_IDENTITY = {
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.invalid",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
    # A CI or host configuration must not change what these tests observe.
    "GIT_TERMINAL_PROMPT": "0",
}

GUARD_ENV = "FRANK_ALLOW_PRIOR_FILES"


def run(args, cwd=None, env=None, check=True):
    merged = dict(os.environ)
    merged.update(GIT_IDENTITY)
    if env:
        merged.update(env)
    result = subprocess.run(
        [str(arg) for arg in args],
        cwd=None if cwd is None else str(cwd),
        env=merged,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise AssertionError(f"{args} failed ({result.returncode}): {result.stderr}")
    return result


def commit(repo, message, when=None):
    env = {}
    if when is not None:
        env = {"GIT_AUTHOR_DATE": f"@{when} +0000", "GIT_COMMITTER_DATE": f"@{when} +0000"}
    run(["git", "-C", repo, "commit", "-qm", message], env=env)
    return run(["git", "-C", repo, "rev-parse", "HEAD"]).stdout.strip()


def init_repo(path, when=None):
    path.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q", "-b", "main", path])
    (path / ".gitignore").write_text("__pycache__/\n*.pyc\n", encoding="utf-8")
    (path / "README.md").write_text("base\n", encoding="utf-8")
    run(["git", "-C", path, "add", "-A"])
    return commit(path, "base", when=when)


class ScratchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="frank-checkout-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)


class HookPermissionTest(unittest.TestCase):
    def test_every_hook_and_script_is_executable_in_git(self):
        for name in ("pre-commit", "post-checkout"):
            path = GITHOOKS / name
            self.assertTrue(path.is_file(), name)
            self.assertTrue(os.access(path, os.X_OK), f"{name} is not executable on disk")
        # Git stores the executable bit; a 100644 hook is skipped without a word.
        tracked = [PRE_COMMIT, POST_CHECKOUT, SWEEP, PRUNE, INSTALLER]
        listing = run(["git", "-C", ROOT, "ls-files", "-s", "--", *(p.relative_to(ROOT) for p in tracked)]).stdout
        modes = {}
        for line in listing.splitlines():
            if not line.strip():
                continue
            meta, path = line.split("\t", 1)
            modes[path] = meta.split()[0]
        self.assertEqual(len(modes), len(tracked), listing)
        for path, mode in modes.items():
            self.assertEqual(mode, "100755", f"{path} is committed as {mode}")

    def test_installer_pins_an_absolute_hooks_path_and_verifies_traversal(self):
        installer = INSTALLER.read_text(encoding="utf-8")
        # An absolute path resolves the same in the canonical checkout and in every
        # worktree, so a worktree branched from an older revision cannot lose it.
        self.assertIn('core.hooksPath "$HOOKS_DIR"', installer)
        self.assertIn('HOOKS_DIR="$CANONICAL/apps/window/infra/checkout/githooks"', installer)
        # A hook that is executable but unreachable is the same as no hook at all.
        self.assertIn("runuser -u", installer)
        self.assertIn("not traversable by", installer)
        self.assertIn("the commit guard would silently never run", installer)

    def test_installer_records_the_session_parent_mode_and_ownership(self):
        installer = INSTALLER.read_text(encoding="utf-8")
        self.assertIn('install -d -o root -g "$GROUP" -m 2775 -- "$SESSION_PARENT"', installer)
        self.assertIn('GROUP="${FRANK_CHECKOUT_GROUP:-hermes}"', installer)

    def test_the_release_path_installs_hygiene_and_enables_its_timers(self):
        deploy = (APP / "deploy.sh").read_text(encoding="utf-8")
        self.assertIn('bash "$host_app/infra/checkout/install-checkout-hygiene.sh"', deploy)
        installer = INSTALLER.read_text(encoding="utf-8")
        self.assertIn("systemctl enable --now frank-checkout-sweep.timer frank-checkout-prune.timer", installer)
        # One owner: the hygiene installer installs and verifies its own units.
        for unit in (
            "frank-checkout-sweep.service",
            "frank-checkout-sweep.timer",
            "frank-checkout-prune.service",
            "frank-checkout-prune.timer",
        ):
            self.assertIn(unit, installer)
        self.assertIn("systemd-analyze verify", installer)
        # The control-plane installer keeps its own timers disabled on a direct
        # run; hygiene does not go through that release-evidence gate.
        control_plane = (APP / "infra" / "control_plane" / "install.sh").read_text(encoding="utf-8")
        self.assertNotIn("systemctl enable", control_plane)

    def test_an_immutable_release_verifies_the_hygiene_inputs_it_reads(self):
        # deploy.sh reads the hygiene scripts from the canonical checkout even on
        # an immutable deploy, so they belong to the verified closure.
        control_plane = (APP / "infra" / "control_plane" / "install.sh").read_text(encoding="utf-8")
        self.assertEqual(control_plane.count("apps/window/infra/checkout"), 2)


class CommitGuardTest(ScratchTest):
    """The guard runs in the shared canonical checkout, which has no claim."""

    def setUp(self):
        super().setUp()
        self.repo = self.tmp / "canonical"
        init_repo(self.repo)
        run(["git", "-C", self.repo, "config", "core.hooksPath", str(GITHOOKS)])

    def guard(self, cwd, env=None):
        return run([PRE_COMMIT], cwd=cwd, env=env, check=False)

    def stage(self, repo, path):
        run(["git", "-C", repo, "add", "--", str(path)])

    def test_first_run_records_the_session_start_and_says_so(self):
        before = int(time.time())
        result = self.guard(self.repo)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("recorded session start", result.stderr)
        marker = self.repo / ".git" / "frank-session-start"
        self.assertTrue(marker.is_file(), "the session start must be recorded once")
        started = marker.read_text().strip()
        self.assertTrue(started.isdigit(), started)
        self.assertGreaterEqual(int(started), before - 1)
        # Recorded once: a second run does not move it.
        self.assertEqual(self.guard(self.repo).returncode, 0)
        self.assertEqual(marker.read_text().strip(), started)

    def test_allows_a_file_the_session_touched(self):
        self.guard(self.repo)  # records the session start
        (self.repo / "own.txt").write_text("this session's work\n", encoding="utf-8")
        self.stage(self.repo, "own.txt")
        result = self.guard(self.repo)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_refuses_a_file_last_modified_before_the_session(self):
        self.guard(self.repo)  # records the session start
        foreign = self.repo / "another-session.txt"
        foreign.write_text("someone else's work in progress\n", encoding="utf-8")
        old = time.time() - 3600
        os.utime(foreign, (old, old))
        self.stage(self.repo, "another-session.txt")
        result = self.guard(self.repo)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("another-session.txt", result.stderr)
        self.assertIn("last modified before this session started", result.stderr)
        # The escape hatch is reported, not hidden.
        self.assertIn(GUARD_ENV, result.stderr)

    def test_the_session_s_own_file_passes_while_the_swept_file_is_refused(self):
        self.guard(self.repo)
        own = self.repo / "own.txt"
        own.write_text("mine\n", encoding="utf-8")
        foreign = self.repo / "swept.txt"
        foreign.write_text("theirs\n", encoding="utf-8")
        old = time.time() - 3600
        os.utime(foreign, (old, old))
        self.stage(self.repo, "own.txt")
        self.stage(self.repo, "swept.txt")
        result = self.guard(self.repo)
        self.assertEqual(result.returncode, 1)
        self.assertIn("swept.txt", result.stderr)
        self.assertNotIn("own.txt", result.stderr)

    def test_escape_hatch_allows_a_deliberate_exception(self):
        self.guard(self.repo)
        foreign = self.repo / "deliberate.txt"
        foreign.write_text("deliberate\n", encoding="utf-8")
        old = time.time() - 3600
        os.utime(foreign, (old, old))
        self.stage(self.repo, "deliberate.txt")
        result = self.guard(self.repo, env={GUARD_ENV: "1"})
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_a_deletion_publishes_no_content_and_is_not_refused(self):
        self.guard(self.repo)
        run(["git", "-C", self.repo, "rm", "-q", "README.md"])
        result = self.guard(self.repo)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_an_unreadable_index_refuses_instead_of_passing_silently(self):
        self.guard(self.repo)  # records the session start
        # An empty file is not a valid index; the guard cannot see what would be
        # published, so it must say so rather than allow the commit.
        broken = self.tmp / "broken-index"
        broken.write_bytes(b"")
        result = self.guard(self.repo, env={"GIT_INDEX_FILE": str(broken)})
        self.assertEqual(result.returncode, 1)
        self.assertIn("no readable staged file list", result.stderr)
        self.assertIn(GUARD_ENV, result.stderr)


class ClaimedWorktreeGuardTest(ScratchTest):
    """A claimed worktree records its start at claim time, before any edit."""

    def setUp(self):
        super().setUp()
        self.repo = self.tmp / "canonical"
        init_repo(self.repo)
        run(["git", "-C", self.repo, "config", "core.hooksPath", str(GITHOOKS)])
        self.worktree = self.tmp / "worktrees" / "task"
        run(["git", "-C", self.repo, "worktree", "add", "-q", "-b", "task", self.worktree, "main"])

    def guard(self, env=None):
        return run([PRE_COMMIT], cwd=self.worktree, env=env, check=False)

    def test_the_claim_records_the_start_before_the_first_edit(self):
        marker = self.repo / ".git" / "worktrees" / "task" / "frank-session-start"
        self.assertTrue(marker.is_file(), "git worktree add must record the claim")
        claim = int(marker.read_text().strip())
        self.assertEqual(claim, int(run(["stat", "-c", "%W", self.repo / ".git" / "worktrees" / "task"]).stdout.strip()))

    def test_allows_the_author_s_own_file_committed_later(self):
        own = self.worktree / "author.txt"
        own.write_text("the author's own work\n", encoding="utf-8")
        os.utime(own, (time.time(), time.time()))  # edited after the claim
        run(["git", "-C", self.worktree, "add", "author.txt"])
        result = self.guard()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_refuses_a_file_that_predates_the_claim(self):
        swept = self.worktree / "swept.txt"
        swept.write_text("another session's work\n", encoding="utf-8")
        old = time.time() - 3600
        os.utime(swept, (old, old))
        run(["git", "-C", self.worktree, "add", "swept.txt"])
        result = self.guard()
        self.assertEqual(result.returncode, 1)
        self.assertIn("swept.txt", result.stderr)
        self.assertIn("/projects/frank-worktrees/<task>", result.stderr)

    def test_an_unwritable_marker_refuses_instead_of_passing_silently(self):
        marker = self.repo / ".git" / "worktrees" / "task" / "frank-session-start"
        marker.unlink()
        admin = marker.parent
        original = admin.stat().st_mode
        os.chmod(admin, 0o500)
        self.addCleanup(os.chmod, admin, original)
        if os.geteuid() == 0:
            # root ignores the mode; the guard's own check is what is being tested.
            self.skipTest("running as root, where a read-only directory is still writable")
        result = self.guard()
        self.assertEqual(result.returncode, 1)
        self.assertIn("cannot record this session", result.stderr)
        self.assertIn(GUARD_ENV, result.stderr)


class SweepTest(ScratchTest):
    def setUp(self):
        super().setUp()
        self.canonical = self.tmp / "canonical"
        init_repo(self.canonical)
        self.parent = self.tmp / "worktrees"
        self.parent.mkdir()

    def sweep(self, *args):
        return run(
            ["bash", SWEEP, *args],
            cwd=self.tmp,
            env={
                "FRANK_CHECKOUT_CANONICAL": str(self.canonical),
                "FRANK_CHECKOUT_SESSION_PARENT": str(self.parent),
                "FRANK_CHECKOUT_TARGET": "main",
                "FRANK_CHECKOUT_LEGACY_ROOTS": "",
            },
            check=False,
        )

    def claim(self, name, revision="main", branch=None):
        path = self.parent / name
        args = ["git", "-C", self.canonical, "worktree", "add", "-q"]
        if branch:
            args += ["-b", branch]
        else:
            args += ["--detach"]
        args += [path, revision]
        run(args)
        return path

    def test_removes_a_merged_clean_idle_worktree(self):
        path = self.claim("finished", branch="finished")
        result = self.sweep("--hours", "0", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("removed worktree", result.stdout)
        self.assertFalse(path.exists())
        # The registration goes with it: nothing stale is left in the repository.
        self.assertNotIn("finished", run(["git", "-C", self.canonical, "worktree", "list"]).stdout)

    def test_keeps_a_worktree_with_commits_not_in_the_target_branch(self):
        path = self.claim("in-progress", branch="in-progress")
        (path / "work.txt").write_text("unmerged\n", encoding="utf-8")
        run(["git", "-C", path, "add", "work.txt"])
        commit(path, "unmerged work")
        result = self.sweep("--hours", "0", "--report", "--apply")
        self.assertIn("commit(s) not in main", result.stdout)
        self.assertTrue(path.exists())

    def test_keeps_a_worktree_with_uncommitted_tracked_changes(self):
        path = self.claim("dirty", branch="dirty")
        (path / "README.md").write_text("half-finished\n", encoding="utf-8")
        result = self.sweep("--hours", "0", "--report", "--apply")
        self.assertIn("uncommitted tracked file(s)", result.stdout)
        self.assertTrue(path.exists())

    def test_ignores_regenerable_artifacts_but_not_real_untracked_work(self):
        artifact_only = self.claim("artifacts", branch="artifacts")
        cache = artifact_only / "__pycache__"
        cache.mkdir()
        (cache / "module.pyc").write_text("cache\n", encoding="utf-8")
        result = self.sweep("--hours", "0", "--apply")
        self.assertFalse(artifact_only.exists(), result.stdout)

        real_work = self.claim("untracked", branch="untracked")
        (real_work / "notes.md").write_text("a person wrote this\n", encoding="utf-8")
        result = self.sweep("--hours", "0", "--report", "--apply")
        self.assertIn("untracked file(s) that are not regenerable", result.stdout)
        self.assertTrue(real_work.exists())

    def test_a_fresh_claim_is_never_treated_as_idle(self):
        path = self.claim("just-claimed", branch="just-claimed")
        result = self.sweep("--hours", "24", "--report", "--apply")
        self.assertIn("active 0h ago", result.stdout)
        self.assertTrue(path.exists())

    def test_reports_a_leftover_it_cannot_prove_and_deletes_nothing(self):
        orphan = self.parent / "leftover"
        orphan.mkdir()
        (orphan / ".git").write_text(f"gitdir: {self.canonical}/.git/worktrees/leftover\n", encoding="utf-8")
        (orphan / "README.md").write_text("unfinished work\n", encoding="utf-8")
        (orphan / "scratch.txt").write_text("more\n", encoding="utf-8")
        result = self.sweep("--hours", "0", "--report", "--apply")
        self.assertIn("cannot be read by git", result.stdout)
        self.assertTrue(orphan.exists())
        self.assertIn("0 checkout(s)", result.stdout)

    def test_removes_a_leftover_that_is_exactly_a_committed_revision(self):
        orphan = self.parent / "pristine"
        run(["git", "-C", self.canonical, "worktree", "add", "-q", "--detach", orphan, "main"])
        # Exactly what an earlier removal that skipped `git worktree remove` leaves.
        shutil.rmtree(self.canonical / ".git" / "worktrees" / "pristine")
        self.assertIn(f"gitdir: {self.canonical}", (orphan / ".git").read_text(encoding="utf-8"))
        result = self.sweep("--hours", "0", "--apply")
        self.assertIn("removed leftover", result.stdout)
        self.assertFalse(orphan.exists())

    def test_deletes_a_merged_branch_whose_worktree_is_gone(self):
        run(["git", "-C", self.canonical, "branch", "already-merged", "main"])
        result = self.sweep("--hours", "0", "--apply")
        self.assertIn("removed merged branch already-merged", result.stdout)
        self.assertEqual(run(["git", "-C", self.canonical, "branch", "--list", "already-merged"]).stdout.strip(), "")

    def test_keeps_an_unmerged_branch(self):
        path = self.claim("keep-branch", branch="keep-branch")
        (path / "work.txt").write_text("unmerged\n", encoding="utf-8")
        run(["git", "-C", path, "add", "work.txt"])
        commit(path, "unmerged work")
        run(["git", "-C", self.canonical, "worktree", "remove", "--force", path])
        self.sweep("--hours", "0", "--apply")
        self.assertNotEqual(run(["git", "-C", self.canonical, "branch", "--list", "keep-branch"]).stdout.strip(), "")

    def test_a_quiet_run_that_changes_nothing_logs_one_line(self):
        result = self.sweep("--quiet", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len([line for line in result.stdout.splitlines() if line.strip()]), 1, result.stdout)

    def test_a_quiet_run_that_changes_something_logs_the_events(self):
        self.claim("finished", branch="finished")
        result = self.sweep("--hours", "0", "--quiet", "--apply")
        self.assertIn("removed worktree", result.stdout)
        self.assertIn("reclaimed", result.stdout)

    def test_a_dry_run_removes_nothing(self):
        path = self.claim("finished", branch="finished")
        result = self.sweep("--hours", "0")
        self.assertIn("would remove worktree", result.stdout)
        self.assertTrue(path.exists())


class ReleasePruneTest(ScratchTest):
    def setUp(self):
        super().setUp()
        self.canonical = self.tmp / "canonical"
        now = int(time.time())
        # Three revisions with distinct, increasing commit times.
        self.revisions = [init_repo(self.canonical, when=now - 3000)]
        for index, age in enumerate((2000, 1000)):
            (self.canonical / f"file{index}.txt").write_text(f"{index}\n", encoding="utf-8")
            run(["git", "-C", self.canonical, "add", "-A"])
            self.revisions.append(commit(self.canonical, f"commit {index}", when=now - age))
        self.releases = self.tmp / "releases"
        self.releases.mkdir()
        self.session_parent = self.tmp / "worktrees"
        self.session_parent.mkdir()
        self.release_env = self.tmp / "release-state"
        self.release_env.mkdir()

    def prune(self, *args):
        return run(
            ["bash", PRUNE, *args],
            cwd=self.tmp,
            env={
                "FRANK_CHECKOUT_CANONICAL": str(self.canonical),
                "FRANK_CHECKOUT_SESSION_PARENT": str(self.session_parent),
                "FRANK_CHECKOUT_TARGET": "main",
                "FRANK_RELEASE_ENV": str(self.release_env),
            },
            check=False,
        )

    def release_worktree(self, revision, root=None):
        """A release worktree named for the revision it sits on."""
        path = (root or self.releases) / f"release-{revision[:12]}"
        path.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "-C", self.canonical, "worktree", "add", "-q", "--detach", path, revision])
        return path

    def newest_release_worktree(self):
        return self.release_worktree(self.revisions[-1])

    def test_bounds_retention_and_keeps_the_newest(self):
        oldest = self.release_worktree(self.revisions[0])
        middle = self.release_worktree(self.revisions[1])
        newest = self.newest_release_worktree()
        result = self.prune("--keep", "1", "--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(newest.exists())
        self.assertFalse(middle.exists(), result.stdout)
        self.assertFalse(oldest.exists(), result.stdout)

    def test_protects_the_serving_and_rollback_revisions(self):
        oldest = self.release_worktree(self.revisions[0])
        middle = self.release_worktree(self.revisions[1])
        newest = self.newest_release_worktree()
        (self.release_env / "approved-sha").write_text(self.revisions[0] + "\n", encoding="utf-8")
        (self.release_env / "rollback-receipt.env").write_text(
            f"previous_sha={self.revisions[1]}\n", encoding="utf-8"
        )
        result = self.prune("--keep", "1", "--apply")
        self.assertIn("serving revision", result.stdout)
        self.assertIn("rollback revision", result.stdout)
        self.assertTrue(oldest.exists(), "the serving revision keeps its worktree")
        self.assertTrue(middle.exists(), "the rollback revision keeps its worktree")
        self.assertTrue(newest.exists())

    def test_never_removes_a_worktree_with_uncommitted_changes(self):
        dirty = self.release_worktree(self.revisions[0])
        newest = self.newest_release_worktree()
        (dirty / "README.md").write_text("mid-release edit\n", encoding="utf-8")
        result = self.prune("--keep", "1", "--apply")
        self.assertIn("uncommitted tracked changes", result.stdout)
        self.assertTrue(dirty.exists())
        self.assertTrue(newest.exists())

    def test_never_removes_a_worktree_not_at_the_revision_its_name_encodes(self):
        # Named for the newest revision, actually sitting on the oldest one.
        root = self.tmp / "opt" / "releases"
        root.mkdir(parents=True)
        mislabelled = root / f"release-{self.revisions[2][:12]}"
        run(["git", "-C", self.canonical, "worktree", "add", "-q", "--detach", mislabelled, self.revisions[0]])
        newest = self.newest_release_worktree()
        result = self.prune("--keep", "1", "--apply")
        self.assertIn("not at the revision its name encodes", result.stdout)
        self.assertTrue(mislabelled.exists())
        self.assertTrue(newest.exists())

    def test_never_removes_a_release_worktree_with_unmerged_commits(self):
        path = self.release_worktree(self.revisions[0])
        (path / "work.txt").write_text("unmerged\n", encoding="utf-8")
        run(["git", "-C", path, "add", "work.txt"])
        commit(path, "unmerged release work")
        newest = self.newest_release_worktree()
        result = self.prune("--keep", "1", "--apply")
        self.assertIn("commit(s) not in main", result.stdout)
        self.assertTrue(path.exists())
        self.assertTrue(newest.exists())

    def test_a_dry_run_removes_nothing(self):
        oldest = self.release_worktree(self.revisions[0])
        newest = self.newest_release_worktree()
        result = self.prune("--keep", "1")
        self.assertIn("would remove release worktree", result.stdout)
        self.assertTrue(oldest.exists())
        self.assertTrue(newest.exists())


if __name__ == "__main__":
    unittest.main()
