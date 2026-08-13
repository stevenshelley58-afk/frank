# Build state

One line per task. A replacement agent reads this file first and needs nothing else.
Status: READY | IN_PROGRESS | DONE | BLOCKED | BLOCKED-DEP

| id | status | branch | commit | owner | updated |
|---|---|---|---|---|---|
| F0-1 scaffold | DONE | main | d5ae122 | cowork | 2026-08-12 |
| F0-2 deploy frank | DONE | main | HEAD | cowork | 2026-08-12 |
| F0-3 graphify registry | DONE | main | 6cbc25f | cowork | 2026-08-12 |
| F0-4 gitignore | DONE | main | d5ae122 | cowork | 2026-08-12 |
| F0-5 retire legacy VPS path paths | READY | - | - | - | - |
| F1-1 project registry | READY | - | - | - | - |
| F1-2 release contract | BLOCKED-DEP F1-1 | - | - | - | - |
| F1-3 module manifest | BLOCKED-DEP F1-1 | - | - | - | - |
| F1-4 delivery | BLOCKED-DEP F1-2 | - | - | - | - |
| F2-A1 renderer | BLOCKED-DEP F1-2 | - | - | - | - |
| F2-A2 template factory | BLOCKED-DEP F2-A1 | - | - | - | - |
| F2-B1 ad-intelligence | BLOCKED-DEP F1-4 | - | - | - | - |
| F2-B2 prospect-discovery | BLOCKED-DEP F1-4 | - | - | - | - |
| F2-B3 mail | BLOCKED-DEP F1-4 | - | - | - | - |
| F2-B4 outreach | BLOCKED-DEP F2-B2,F2-B3 | - | - | - | - |
| F2-C1 content-factory | BLOCKED-DEP F1-4 | - | - | - | - |
| F3-0 chat | READY | - | - | - | - |
| F3-1 project home | BLOCKED-DEP F3-0 | - | - | - | - |
| F3-2 widget groups | BLOCKED-DEP F3-1 | - | - | - | - |
| F3-3 night watch | BLOCKED-DEP F3-1 | - | - | - | - |
| F3-4 graphify+lake | READY | - | - | - | - |
| B4-1 delete legacy adstudio | READY | - | - | - | - |
| B4-2 consumer boundary | BLOCKED-DEP B4-1,F1-4 | - | - | - | - |
| B4-3 catalogue | BLOCKED-DEP B4-2 | - | - | - | - |
| B4-4 editor | BLOCKED-DEP B4-3 | - | - | - | - |
| B4-5 save | BLOCKED-DEP B4-3 | - | - | - | - |
| B4-6 publish+meta | BLOCKED-DEP B4-5 | - | - | - | - |

## Migration numbers (coordinator assigns, never a worker)
Highest applied: 0013. Next free: 0014.
0014 -> F3-1 project dashboard
0015 -> F3-3 night watch

## Wave 0 gate — PASSED 2026-08-12

- `frank.fail` serves over HTTPS through Caddy to `frank-web` (basic auth, user `steven`).
- `frank-api` is ready: `/v1/system/ready` returns `{"ready":true,"state":"healthy"}`, 14 migrations applied, 69 tables in `frank_domain`.
- Chat responds end to end: turn `019ff728-067a-70bc-86d8-29c4be8bc605` completed,
  streamed `WAVE0-OK` from DeepSeek via Goose ACP, receipt written, agent message persisted.
- Graphify publishes all five projects: frank 10,953 nodes · blockwise 7,224 · elfandwonder 623 · pavone-demo 249 · merrypaws 155.

## F0-5 — retire legacy VPS path paths (mechanical, cheap agent)

40 files still reference `legacy VPS path`. All are container-internal defaults overridden
by env in the dev compose, so nothing is broken today, but the production overlay
`infra/production/docker-compose.app.yml` carries host paths that no longer exist.
Map: `legacy VPS path/repo` -> `/frank/repo` (host source of truth) ·
`legacy VPS path/{infra,static,secrets,workspaces,preview-view}` -> `/frank/deployed/...`.
Compatibility symlinks under `/srv` stay until this lands, then go.

## F0-6 — put the dev compose under version control (cheap agent, needs one decision)

`/frank/deployed/infra/docker-compose.dev.yml` is the file that actually runs the
box and it is not in git, so a replacement agent cannot reproduce the stack from
the repo alone. It was deliberately NOT committed in the Wave 0 commit because it
carries three secrets inline: the Postgres password and two signing keys.

To land it, replace those with `${VAR:?}` references and source them from
`/frank/deployed/infra/.env`. One snag found while checking: `FRANK_DB_PASSWORD`
in `.env` matches the inline value, but `FRANK_SESSION_SIGNING_KEY` and
`FRANK_ENVELOPE_SIGNING_KEY` do NOT. Substituting blindly would rotate them and
invalidate every minted session. Reconcile the two sources first — the compose
comment says these are dev-only fixed keys and production takes them from OpenBao,
so aligning `.env` to the compose values is the likely answer, but confirm before
changing anything.
