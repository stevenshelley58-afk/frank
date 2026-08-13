# W1-5 packet (pre-staged — dispatch after W1-3 lands and batch-1 reports are reconciled)

Goal: TASK W1-5 — Replace stale /srv/frank paths repo-wide (string replacement, no logic).

Depends: W1-1, W1-2, W1-3, W1-4 all committed on rebuild/wave1.

ENV: C:\Dev\Frank (git-bash /c/Dev/Frank). FIRST: `cd /c/Dev/Frank && git branch --show-current` (rebuild/wave1) `&& git status --short`.
Node: `export PATH="/c/Users/steve/node22:$PATH"` before pnpm/npx.
Shared-tree: you are the ONLY agent in the tree — still commit explicit paths only; never push/pull/rebase/merge; never touch .build/; commit per logical unit; final commit Status: complete.

REPLACEMENTS — apply in this exact order (longest match first):
1. /srv/frank/repo       → /projects/frank
2. /srv/frank/infra      → /frank/deployed/infra
3. /srv/frank/static     → /frank/deployed/static
4. /srv/frank/secrets    → /frank/deployed/secrets
5. /srv/frank/workspaces → /frank/deployed/workspaces
6. /srv/frank            → /frank/deployed

FILE SELECTION:
- `grep -rl "/srv/frank" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.build` → the file list. (~50 files after W1-1..W1-4.)
- NEVER touch: any .env file (pattern *.env, .env.*), node_modules, .git.
- This includes docs (.md), scripts (.sh), compose (.yml), TS code, tests, .plan/*.md. Replace strings everywhere per plan.

MECHANICS (line-ending safety — CRITICAL):
- Do NOT use sed -i (mangles CRLF). Write a small Python or Node script that:
  - takes the file list from grep,
  - for each file: read BYTES, apply the 6 ordered replacements as BYTES (b'/srv/frank/repo' → b'/projects/frank', ...), write BYTES back,
  - prints per-file counts of replacements made.
- Byte-level replacement preserves CRLF/LF exactly and cannot corrupt content.
- You may keep the script in /tmp (or delete after use) — do NOT commit it.
- Sample Python (run with system python 3.11 — `python --version`; available as `python`):
  ```python
  import subprocess, sys
  reps = [(b'/srv/frank/repo', b'/projects/frank'), (b'/srv/frank/infra', b'/frank/deployed/infra'), (b'/srv/frank/static', b'/frank/deployed/static'), (b'/srv/frank/secrets', b'/frank/deployed/secrets'), (b'/srv/frank/workspaces', b'/frank/deployed/workspaces'), (b'/srv/frank', b'/frank/deployed')]
  files = subprocess.check_output(['grep','-rl','/srv/frank','.','--exclude-dir=node_modules','--exclude-dir=.git','--exclude-dir=.build']).decode().splitlines()
  total = 0
  for f in files:
      if '.env' in f: continue
      b = open(f,'rb').read(); n = 0
      for old,new in reps: n += b.count(old); b = b.replace(old,new)
      if n: open(f,'wb').write(b); total += n; print(f'{n:3d}  {f}')
  print('TOTAL', total)
  ```

DONE-WHEN:
- `grep -rn "/srv/frank" . --exclude-dir=node_modules --exclude-dir=.git` → NOTHING.
- Commit all files in one commit (they're all the same logical change) with the exact commit format.

HANDOFF: files changed (count), total replacements, done-when grep proof (run it), commit hash.
