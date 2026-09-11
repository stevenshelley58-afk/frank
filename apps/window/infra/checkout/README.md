# Frank checkout hygiene

One worktree per session, a guard that keeps one session's files out of another
session's commit, and a sweep that retires what is provably finished with. The
rule itself is in [AGENTS.md](../../../../AGENTS.md); this is the component
contract.

## Claim a worktree

```sh
git -C /projects/frank worktree add -b <task> /projects/frank-worktrees/<task> origin/main
```

`/projects/frank-worktrees` is the single parent. It is owned `root:hermes` with
mode `2775`: setgid so a worktree inherits the `hermes` group, group-writable so
every agent account in that group can claim and remove its own, root-owned so a
release can always repair it. `install-checkout-hygiene.sh` creates it, points
`core.hooksPath` at the versioned hooks and verifies the result as a real agent
account.

## The commit guard

`githooks/pre-commit` refuses a commit that would publish a file last modified
before this session started: that file cannot be this session's work. Because
sessions share `/projects/frank`, an unguarded `git add -A` there is how one
session's uncommitted files end up inside another session's commit.

- The session start is recorded once per checkout, in the worktree's own
  administrative directory, the first time the guard runs.
- `githooks/post-checkout` records it at claim time instead, because
  `git worktree add` runs that hook. A claimed worktree therefore has a start
  that predates every edit, and the guard refuses another session's older files
  from the first commit. A session committing its own files is never blocked, and
  neither is the session that originally created a file when it commits later.
- In the shared canonical checkout there is no claim to read, so the first guard
  run records the start and says so; that one commit is not age-checked.
- Escape hatch, for a file deliberately prepared before this session began:
  `FRANK_ALLOW_PRIOR_FILES=1 git commit ...`. The refusal message names it.

## The sweep

`frank-checkout-sweep.sh` removes a checkout only when all three hold:

1. every commit in it is already in the target branch (`origin/main`),
2. nothing tracked is uncommitted,
3. it has been idle for the whole window (24 hours by default).

Everything else is reported with its reason and left alone. Registered worktrees
are removed with `git worktree remove`, so no administrative registration is left
behind; registrations whose directory is already gone are pruned. Merged branches
whose worktree is gone are deleted, or they accumulate silently.

Two signals are deliberately excluded. Idle time comes from the last commit,
floored by the worktree's claim time, never from the directory mtime: reading a
directory updates it, which made months-old snapshots look active. Untracked
files only block removal when they are *not* ignored, because ignored build
output, caches and the banner a harness rewrites into rule and doc files are
tooling, not a person's work.

A checkout whose link into the canonical repository was already deleted is
treated as content that cannot be attributed to a commit. It is removed only when
its tree is exactly a revision already in `origin/main`, proven by building the
tree in a scratch object store so the canonical repository gains no objects.
Anything else is reported, never deleted.

## Retention

`frank-release-prune.sh` bounds release and deploy worktrees (registered
worktrees outside `/projects/frank-worktrees`) to `--keep 3`, which is applied as
newest 3 **plus** the approved revision **plus** the recorded rollback revision:
five retained revisions of source depth, which is more than the rollback path
actually consumes, because rollback restores immutable SHA-tagged images and only
needs the receipt in `/var/lib/frank/release`. A worktree that is dirty, holds
commits not in `origin/main`, or does not sit at the revision its own name
encodes is never removed.

## Triggers

| Trigger | Unit | Command |
| --- | --- | --- |
| Every release | `deploy.sh` (tail) | sweep `--quiet --apply`, then prune `--keep 3 --apply` |
| Hourly | `frank-checkout-sweep.timer` | sweep `--quiet --apply` |
| Weekly backstop | `frank-checkout-prune.timer` | prune `--keep 3 --apply`, then sweep `--hours 24 --report --apply` |

`install-checkout-hygiene.sh` is the single owner of this contract. It creates the
parent, points `core.hooksPath` at the versioned hooks, installs and verifies the
four units, verifies the hook permissions as a real agent account and enables
both timers, so no one has to remember a command. `deploy.sh` runs it on every
release; running it directly is equally complete. All output appends to
`/srv/frank/checkout-hygiene.log`; a run that changed nothing logs one line, and
the kept-checkout detail appears from the weekly backstop rather than from every
hourly run.
