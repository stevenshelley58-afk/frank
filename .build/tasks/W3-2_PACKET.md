# W3-2 packet (pre-staged — dispatch after W2 lands)

Goal: TASK W3-2 — Skills page. Lists every skill the running Hermes can see.
For each: name, description (frontmatter of SKILL.md), rendered markdown.
Read-only in this task (editing comes later per plan).

## Skills root (decision already made on the board)
The plan says `~/agent-skills/skills`; on this machine Hermes skills live at
`C:\Users\steve\AppData\Local\hermes\skills` — **read that** (read-only; the plan
forbids WRITING to the skills dir, and it is Hermes' own store). Overridable via
env `FRANK_SKILLS_ROOT` for tests (point tests at a tiny fixture dir).

## Scope
- Allowed: `apps/web/src/app/skills/**` (new), `apps/api/src/routes/skills.ts` (new),
  `apps/web/package.json` (gray-matter, react-markdown), `apps/web/src/lib/skills-api.ts` (new).
- Coordinator-only (hot-file request): `apps/web/src/components/shell/frank-shell.tsx`
  (nav link), `apps/api/src/server.ts` (route registration), `pnpm-lock.yaml`,
  `docs/requirements/registry.json`.
- Node: `export PATH="/c/Users/steve/node22:$PATH"`. Branch: rebuild/wave2.
- Never `git add -A`; never push; commit format W3-2.

## Library
- `gray-matter` (npm, MIT) for frontmatter. **Do not write your own parser.**
- `react-markdown` (already in the stack) for rendering.

## Done-when
- Every skill folder appears with name + description.
- Clicking one shows the rendered markdown.
- A skill with malformed frontmatter shows an error card, not a crash (test with a
  fixture dir containing a broken SKILL.md).
- `GET /v1/skills` returns name/description/path per skill, plus `content` when
  `?path=` asks for one skill's SKILL.md — and a per-skill `frontmatterError` field
  instead of throwing when frontmatter is broken.
- typecheck + fast unit tests green; api-contract count updated (recount from merged
  list if you add routes).

## Pitfalls (this repo)
- CRLF files — patch/write_file only, never sed -i. patch lint noise = false alarm.
- Skills dir is big (many folders) — the page must paginate or lazy-load; never
  read every SKILL.md on the list call (list = folder names + frontmatter name/desc only,
  reading each SKILL.md head; content fetched on demand).
- Never write to the skills dir — tests use a fixture dir via FRANK_SKILLS_ROOT.
