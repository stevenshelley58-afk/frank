# Decisions

Append-only. Every non-obvious choice and its reason.

## 2026-08-12 — Frank is a platform, Blockwise is tenant #1
Modules are generic. Project specifics live in packs/<project>/.
Check before every commit: `grep -ri blockwise modules/<name>/` must return nothing.
packs/acme is a deliberately different vertical; every module's tests must pass against it too.

## 2026-08-12 — One release contract, not two
The AdStudio plan defined TemplatePack; the migration plan defined frank.project-release.
Collapsed into one envelope with typed payloads. TemplatePack is a payload type.

## 2026-08-12 — Process ceremony removed, technical spec preserved
Signed freeze hashes, three-party signatures, universe manifests, adversarial verifier
phases and write fences are gone. This box serves ~9 req/day on a 43 MB database.
Every schema, limit, rejection code and acceptance test from the original plans is kept.

## 2026-08-12 — Delete before building
On a dev box, deferring deletion until after replacement is what accumulated 291 GB.

## 2026-08-12 — Graphify indexes the LIVE repos, not staged snapshots
Previously codegraph mounted a staged copy under codegraph-inputs/. Now it mounts
/frank/repo and /projects/* read-only so the graph reflects current working state.
Registry: /frank/deployed/codegraph-inputs/20260812T-multiproject/projects.json
The accepted fead0c4b input set is preserved untouched.

## 2026-08-12 — frank-codegraph-internal network recreated
It was removed by a docker network prune during teardown. Recreated with --internal,
which is what enforces blocked egress for the Graphify supervisor.

## 2026-08-12 — repo file permissions normalised
~2200 files in frank/repo and blockwise/repo-clean were 0600/0700 and unreadable by
UID 10001, which broke the bounded filesystem scan. Made source world-readable.
No .env or secret files were touched.

## 2026-08-12 — Local main rebased onto origin/main before deploying
The two F0 commits sat on a base 165 commits behind `origin/main`, so a deploy from
the local branch would have shipped a tree without the merged rich-chat work.
Rebased onto `f524710`; the F0 commits became `d5ae122` and `6cbc25f`.
The `.gitignore` conflict was resolved as the union of both rule sets.

## 2026-08-12 — One repo on the box: /frank/repo
`/frank/deployed/repo` was a second 1.7 GB clone, one commit behind, used only as a
build context and as the Console Files mount. Two clones means two answers to
"what is deployed". The dev compose now builds `frank-api` and `frank-web` from
`/frank/repo` and mounts it as `/frank/repo-view`, which is already what Graphify
reads. The duplicate is archived, not deleted in place.

## 2026-08-12 — The API owns chat execution, so the API needs the harness config
PR #73 deleted the web-as-harness path. `GOOSE_ACP_URL`, `GOOSE_PROVIDER` and
`GOOSE_MODEL` were still only on `frank-web`, so `chatTurnRuntimeConfig` returned
undefined and every turn answered 503 "Chat execution is not configured."
Those variables now sit on `frank-api` in the dev compose.

## 2026-08-12 — appendChatTurnEvent recursed forever against a transaction
`chat-turn-events.ts` used `typeof db.transaction === 'function'` to decide whether
it needed to open a transaction. A drizzle `PgTransaction` inherits `.transaction()`
— that is how savepoints are opened — so the test was true for both a pool and an
open transaction, and the function recursed, emitting one savepoint per level until
the connection died. Postgres showed `idle in transaction` on `savepoint sp371588`.
Nothing logged it, because every caller dispatches the turn as a floating promise;
the only symptom was a turn stuck in `queued`.
`rollback()` exists only on `PgTransaction`, so that is now the discriminator.

## 2026-08-12 — The Goose adapter spoke a protocol Goose does not implement
`adapters/harness/goose/src/goose-adapter.ts` called `session/create`,
`session/message` and `providers/list`. Goose 1.45 implements standard ACP:
`initialize`, `session/new`, `session/prompt`, `session/set_config_option`,
`session/close`, `session/list`, with output streamed as `session/update`
notifications. Every turn failed `-32601 Method not found`.

Rewritten against the real protocol, verified against the running server. Two
structural changes beyond the renames:

- **One connection per session.** `initialize` is a per-connection handshake and
  `session/update` notifications reach only the socket that created the session.
  The old code opened a socket per RPC, which threw the session away.
- **Inbound requests are answered.** An unanswered agent request would leave the
  turn hanging rather than failing.

ACP has no system-prompt field, so the system prompt is prepended to the first
prompt of a session. A provider or model Goose does not offer is rejected rather
than ignored, so the runner's fallback chain moves on instead of believing it
routed somewhere it did not.

Hardening — resume, steering, thought-chunk surfacing, permission modes — belongs
to F3-0 and is not done here.
