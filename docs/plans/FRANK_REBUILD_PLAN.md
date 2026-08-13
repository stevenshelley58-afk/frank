# Frank rebuild — build plan

**Read this entire file before touching anything.** You have no memory of prior
conversations. Everything you need is here.

---

## 0. What you are building

Frank is a **window**, not an agent.

There is a separate program on this machine called **Hermes** that does all the
thinking: it reads skills, calls tools, remembers things, and picks models.
Frank does not do any of that. Frank shows you what Hermes and the factories
are doing, and it signs releases.

If you find yourself writing code in Frank that loads a skill, calls a model,
stores a memory, or drives an agent — **stop. That is a bug, not a feature.**

### The boundary, stated once

| Job | Who |
|---|---|
| Thinking, skills, tools, memory, model choice | Hermes |
| Running long multi-step jobs (factories) | Frank's runner |
| Showing anything to a human | Frank |
| Signing and delivering releases | Frank |
| Storing chat history, memory, agent state | Hermes |
| Storing factory runs, layouts, releases | Frank's database |

### Paths (translated for this machine — local repo is `C:\Dev\Frank`)

```
C:\Dev\Frank              Frank's repo — this is what you edit (plan writes /projects/frank)
/projects/blockwise       another project — DO NOT EDIT
/projects/<other>         other projects — DO NOT EDIT
/frank/deployed/infra     docker compose + Caddy config for the running stack (VPS)
~/agent-skills/skills     the shared skill library (markdown, read by agents) — on this
                          machine: C:\Users\steve\AppData\Local\hermes\skills
/home/codex/.hermes       Hermes itself — DO NOT EDIT (here: C:\Users\steve\AppData\Local\hermes)
```

---

## 1. Hard rules

Violating any of these means your work is rejected and reverted.

1. **Never edit anything under Hermes' own directory.** That is Hermes. It is
   updated by its own tool.
2. **Never edit any project other than the Frank repo** unless a task explicitly
   says to.
3. **Never put a model call in a code path that must produce the same answer
   twice.** Rendering, hashing, validating, measuring — plain code only.
4. **Never delete a database table that has rows in it.** Rename it to
   `legacy_<name>` instead and say so in your commit.
5. **Never hardcode a model name.** Ask for `frank-planner`, `frank-coder` or
   `frank-bulk`. A file somewhere else decides what those mean.
6. **Never store in Frank something Hermes already stores.** If Frank's database
   were deleted, everything except factory runs and releases must be
   rebuildable from Hermes and the filesystem.
7. **Never leave uncommitted work.** Commit at every point where the code
   compiles, minimum once an hour.
8. **Never force-push. Never merge your own work. Never deploy.**
9. **Never write a new library for something that exists.** Search npm, check
   the licence, check the last release date. If the last release is over a year
   old, do not use it — find another.
10. **If a rule blocks you, say which rule, why it blocks you, and what you
    would do instead. Then stop and wait.** Do not work around it.

---

## 2. How to work

### Before every task

```bash
cd C:\Dev\Frank
git fetch origin
git status                      # must be clean
cat .build/STATE.md             # find your task
```

### Claim a task

Edit `.build/STATE.md`, change your task's row to `IN_PROGRESS`, put your name
in the owner column, and commit **that one line change only**.

Then work on the wave integration branch (AG-0 designates it; Wave 1 =
`rebuild/wave1`). AG-0 (the orchestrator) maintains the board and applies
hot-file changes; agents commit their own paths only.

### Commit format — use this exactly

```
<TASK-ID>: <one line saying what changed>

Status: in-progress | complete
Done: <what now works that did not before>
Next: <the exact next thing to do>
Files: <every path you touched>
```

### Finish a task

1. Run the verification listed in the task. All must pass (or be covered by the
   wave gate for shared-tree work).
2. Report done to AG-0 with the commit hashes.
3. Commit and let AG-0 push. **Do not merge.**

### If you get stuck

Write what happened into `.build/tasks/<TASK-ID>.md` under a heading
`## BLOCKED`, report to AG-0, stop.

### Files only the coordinator may edit

```
packages/contracts/src/index.ts
apps/api/src/main.ts
apps/web/src/components/shell/frank-shell.tsx
infra/docker-compose.dev.yml
pnpm-lock.yaml
drizzle migration journal
```

If you need a change in one of these, write the exact change you want into
`.build/tasks/<TASK-ID>.md` under `## HOT-FILE REQUEST`, and continue with the
rest of your work; AG-0 applies hot-file changes.

---

## 3. Verification — run these before claiming any task is done

```bash
cd C:\Dev\Frank
PATH="/c/Users/steve/node22:$PATH" pnpm install --frozen-lockfile
PATH="/c/Users/steve/node22:$PATH" pnpm typecheck
PATH="/c/Users/steve/node22:$PATH" pnpm test
PATH="/c/Users/steve/node22:$PATH" pnpm build
```

If a task adds database changes, also run the migration/db tests for
`adapters/storage/postgres`.

**A skipped test does not count as a passing test.** If you skip a test, the
task is not done.

---

## WAVE 1 — Make Frank smaller

Frank currently contains a large amount of code that duplicates Hermes. It all
comes out before anything new goes in.

**After Wave 1, Frank must have fewer lines of code than it does now.** If it
does not, something has gone wrong — stop and report.

---

### W1-1 · Delete the harness layer

**Depends on:** nothing
**Allowed:** `adapters/harness/**`, `packages/kernel/src/harness-broker*`, `apps/api/src/routes/harness-control*`, `apps/api/src/services/chat-turn-runner*`, `apps/api/src/services/chat-turn-config*`
**Forbidden:** everything else

Frank no longer drives agents directly. Hermes does.

**Delete these directories and files entirely:**

```
adapters/harness/
packages/kernel/src/harness-broker.ts
packages/kernel/src/harness-broker.test.ts
apps/api/src/routes/harness-control.ts
apps/api/src/routes/harness-control.test.ts
apps/api/src/services/chat-turn-runner.ts
apps/api/src/services/chat-turn-config.ts
```

**Then:**

1. Run `grep -rn "harness" apps/ packages/ adapters/ --include='*.ts' | grep -v node_modules`
2. For every remaining reference, delete the code that uses it. Do not comment
   it out. Do not leave a stub. (This includes `packages/contracts/src/harness.ts`
   and `harness-control.ts`, which define `AgentHarnessAdapter`; the
   coordinator removes their `index.ts` exports.)
3. Any route that returns a harness result should be deleted, not emptied.

**Done when:**
- [ ] `grep -ri "harnessbroker\|GooseAdapter\|AgentHarnessAdapter" apps packages adapters` returns nothing
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] The diff shows more lines deleted than added

---

### W1-2 · Delete the memory system

**Depends on:** nothing (can run at the same time as W1-1)
**Allowed:** `packages/memory/**`, `apps/api/src/routes/brain.ts`, `apps/web/src/app/api/memory/**`, migrations
**Forbidden:** everything else

Hermes has memory. Frank must not.

**Delete:**

```
packages/memory/
apps/api/src/routes/brain.ts
apps/web/src/app/api/memory/
```

**Database:** there are five tables in the `public` schema:
`brain_assertions`, `brain_entities`, `brain_links`, `brain_memories`,
`brain_sources`. Row counts on 2026-08-13 (prod DB frank-frank-db-1): all 0.

1. Count the rows in each: `select count(*) from public.brain_memories;` etc.
   (All 0 on prod; verified by AG-0.)
2. Write the counts into your commit message.
3. Add a **new** migration (do not edit an existing one) that renames each table
   to `legacy_brain_*`. Do not drop them. Migration number: **0014** (leased by
   AG-0). Do NOT edit `migrations/meta/` (the journal) — file a hot-file request
   with the exact journal entry instead.

**Done when:**
- [ ] `grep -ri "brain_\|frank/memory" apps packages` returns nothing
- [ ] A new migration file exists that renames, not drops
- [ ] Row counts are recorded in the commit message
- [ ] `pnpm typecheck && pnpm test && pnpm build` all pass (covered by wave gate)

---

### W1-3 · Delete the mission and workbench runners

**Depends on:** nothing
**Allowed:** `apps/api/src/services/workbench/**`, `apps/api/src/routes/missions.ts`, `apps/api/src/routes/workbench*.ts`, `apps/web/src/app/api/missions/**`, `apps/web/src/app/api/workbenches/**`, `apps/web/src/app/api/worktrees/**`
**Forbidden:** everything else

Replaced by Hermes task boards plus the factory runner in Wave 4.

**Delete every file in the allowed list.** Then remove every import of them.

Tables to rename (not drop) in a new migration — check row counts first and
record them (verified 2026-08-13: NO mission_*/workbench_*/worktree_* tables
exist in prod public schema; write conditional renames via
`to_regclass(...) IS NOT NULL`):

```
anything named mission_*, workbench_*, worktree_*   (from migrations 0009 etc.)
```

Migration number: **0015** (leased by AG-0). Do NOT edit `migrations/meta/`
(the journal) — file a hot-file request with the exact journal entry instead.
Do NOT edit `apps/api/src/main.ts` or `apps/api/src/server.ts` — file hot-file
requests listing the exact imports/wiring to remove.

**Done when:**
- [ ] Those directories no longer exist
- [ ] `grep -ri "workbenchrunner\|missionorchestrator" apps packages` returns nothing
- [ ] Row counts recorded in the commit message
- [ ] All four verification commands pass (covered by wave gate)

---

### W1-4 · Delete the Console, files, previews and explorer modules

**Depends on:** nothing
**Allowed:** `apps/web/src/app/console/**`, `apps/web/src/lib/explorer-fs.ts`, `apps/web/src/app/api/explorer/**`, `apps/web/src/app/api/previews/**`, `apps/web/src/lib/files*.ts`, `apps/web/src/lib/worktrees*.ts`
**Forbidden:** `apps/web/src/components/shell/**`

These are replaced by two much smaller pages in Wave 3.

**Delete every file in the allowed list**, plus their tests.

Remove the corresponding navigation entries. If removing a nav entry requires
editing `frank-shell.tsx` or `living-frame.tsx`, note: `living-frame.tsx` is
editable by you; `frank-shell.tsx` is coordinator-only — write a
`## HOT-FILE REQUEST` into your task file with the exact lines to remove and
continue.

**Done when:**
- [ ] Those routes return 404
- [ ] `grep -ri "explorer-fs\|FRANK_EXPLORER_ROOT\|FRANK_PREVIEWS_ROOT" apps packages` returns nothing
- [ ] All four verification commands pass (covered by wave gate)

---

### W1-5 · Delete stale paths and dead config

**Depends on:** W1-1, W1-2, W1-3, W1-4 all DONE
**Allowed:** any file containing the string `/srv/frank`
**Forbidden:** `.env` files, anything under Hermes' own directory

The machine was reorganised. Roughly 40 files still refer to paths that no
longer exist.

Replace exactly these, everywhere:

```
/srv/frank/repo          →  /projects/frank
/srv/frank/infra         →  /frank/deployed/infra
/srv/frank/static        →  /frank/deployed/static
/srv/frank/secrets       →  /frank/deployed/secrets
/srv/frank/workspaces    →  /frank/deployed/workspaces
/srv/frank               →  /frank/deployed
```

Apply the longest match first. Do not touch any `.env` file.

**Done when:**
- [ ] `grep -rn "/srv/frank" . --exclude-dir=node_modules --exclude-dir=.git` returns nothing
- [ ] All four verification commands pass

---

### WAVE 1 GATE

Do not start Wave 2 until all of these are true:

- [ ] W1-1 to W1-5 all `DONE` in `.build/STATE.md`
- [ ] `git diff --stat <wave-1-start-sha>..HEAD` shows **more deletions than insertions**
- [ ] `pnpm typecheck && pnpm test && pnpm build` pass on the integration branch
- [ ] The site still loads and the existing chat still replies

---

## WAVE 2 — Frank's chat becomes Hermes

### W2-1 · Add the Hermes client

**Depends on:** Wave 1 gate
**Allowed:** `packages/hermes-client/**` (new), `apps/api/src/routes/chat*.ts`
**Forbidden:** `apps/web/**`

Hermes runs an OpenAI-compatible web service. Frank calls it and passes the
answer straight through.

**Create `packages/hermes-client/`** with one exported function:

```ts
// Sends a message to a Hermes profile and streams the reply back.
// It must NOT interpret, summarise, filter or store anything.
export async function* chat(opts: {
  profile: string;        // "hub", "blockwise", etc.
  sessionKey: string;     // scopes Hermes' memory to this conversation
  message: string;
}): AsyncIterable<{ type: 'text' | 'tool' | 'done' | 'error'; content: string }>
```

Read the request/response shape from Hermes' own documentation at
https://hermes-agent.nousresearch.com/docs — **do not guess it.** Use the
`openai` npm package as the transport; the endpoint is OpenAI-compatible.

Configuration comes from environment variables:

```
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=<from the environment, never hardcoded>
```

**Rewrite `apps/api/src/routes/chat-turns.ts`** so that submitting a turn calls
`chat()` and streams the result. Delete everything that referenced the old
runner.

**Do not** store the message text in Frank's database. Store only: turn id,
profile, session key, status, started, finished. The words live in Hermes.

**Done when:**
- [ ] `POST /v1/chat/turns` with a message returns a streamed reply from Hermes
- [ ] Frank's database contains no message text
- [ ] Killing the Hermes service makes the endpoint return a clear error, not hang
- [ ] All four verification commands pass

---

### W2-2 · Point the chat UI at it

**Depends on:** W2-1
**Allowed:** `apps/web/src/components/chat/**`
**Forbidden:** `apps/api/**`

Replace the chat UI with `assistant-ui` (npm: `assistant-ui/react`, MIT).
Do not build message bubbles, streaming, tool-call rendering or markdown
yourself — that library already does all of it.

The chat always talks to the **`hub`** profile unless a project is selected,
in which case it talks to that project's profile.

**Done when:**
- [ ] Typing a message produces a streamed reply
- [ ] Tool calls made by Hermes are visible in the transcript
- [ ] Reloading the page restores the conversation (read back from Hermes, not from Frank)
- [ ] All four verification commands pass

---

## WAVE 3 — Two small pages that make the box usable

### W3-1 · Files page

**Depends on:** Wave 2
**Allowed:** `apps/web/src/app/files/**`, `apps/api/src/routes/files.ts` (new)
**Forbidden:** anything that writes to disk

A read-only browser for `/projects` (locally: `C:\Dev\projects` or repo
`projects/` — AG-0 to confirm root at dispatch). The owner cannot use a
terminal.

Use `react-arborist` (npm, MIT) for the tree. Use `react-markdown` + `shiki`
for viewing file contents.

API: one endpoint, `GET /v1/files?path=...`, which:
- resolves the path
- **rejects anything that resolves outside the root** — test this
- rejects any path containing `..`
- returns a directory listing or a file's contents
- refuses files over 2 MB
- never returns `.env` files or anything matching `*secret*`, `*key*`, `*token*`

**Done when:**
- [ ] You can browse the root in a browser and read a file
- [ ] `GET /v1/files?path=/etc/passwd` returns 403
- [ ] `GET /v1/files?path=/root/../etc/passwd` returns 403
- [ ] `GET /v1/files?path=/root/.env` returns 403
- [ ] There is a test for each of those three cases
- [ ] All four verification commands pass

---

### W3-2 · Skills page

**Depends on:** Wave 2
**Allowed:** `apps/web/src/app/skills/**`, `apps/api/src/routes/skills.ts` (new)
**Forbidden:** writing to the skills library

Lists every skill in the skills library. For each: its name, its description
(from the frontmatter at the top of `SKILL.md`), and the rendered markdown.

Read-only in this task. Editing comes later.

Parse frontmatter with `gray-matter` (npm, MIT). Do not write your own parser.

**Done when:**
- [ ] Every skill folder appears with its name and description
- [ ] Clicking one shows the rendered markdown
- [ ] A skill with malformed frontmatter shows an error card, not a crash
- [ ] All four verification commands pass

---

## WAVE 4 — The factory runner and the trace viewer

This is the most important wave. Read all of it before starting.

A **factory** is a long-running job: something goes in, many steps happen, a
checked result comes out. Examples: turning a source ad into a template pack,
scanning ads, researching a company, writing a blog post.

A **trace** is the complete record of one run, shown visually. The owner cannot
read code, so the trace is how he understands his own system.

---

### W4-1 · The database tables

**Depends on:** Wave 3
**Allowed:** migrations, `adapters/storage/postgres/src/schema/factory.ts` (new)
**Forbidden:** any existing schema file

Create exactly three tables. Ask the coordinator for the migration number —
**do not pick one yourself.**

```
factory_run
  id                uuid primary key
  factory           text not null        -- "ad-templates"
  input             jsonb not null       -- what was given to it
  status            text not null        -- queued|running|passed|failed|quarantined
  started_at        timestamptz
  finished_at       timestamptz
  cost_usd          numeric(10,6) not null default 0
  error_code        text

factory_step
  id                uuid primary key
  run_id            uuid not null references factory_run(id) on delete cascade
  seq               integer not null     -- order within the run
  stage             text not null        -- "extract" | "build" | "review" | ...
  attempt           integer not null     -- 1, 2, 3...
  rung              integer not null     -- 1=free checks .. 5=strong model
  model_alias       text                 -- "frank-bulk" — null for free checks
  model_actual      text                 -- what the gateway really used
  tokens_in         integer
  tokens_out        integer
  cost_usd          numeric(10,6) not null default 0
  duration_ms       integer
  verdict           text                 -- pass|fail|escalate
  unique (run_id, seq)

factory_piece
  id                uuid primary key
  step_id           uuid not null references factory_step(id) on delete cascade
  kind              text not null        -- prompt|output|render|defects
  origin            text                 -- for prompt pieces: skill|input|defects|contract
  content           jsonb                -- small things inline
  blob_path         text                 -- big things (images) on disk
  sha256            text not null
```

**Done when:**
- [ ] A new migration exists using the number the coordinator gave you
- [ ] Migration/db tests pass
- [ ] Deleting a run deletes its steps and pieces

---

### W4-2 · The runner

**Depends on:** W4-1
**Allowed:** `apps/api/src/factories/runner/**` (new)
**Forbidden:** any specific factory's code

One runner. Every factory uses it. It must not know anything about ads.

Use **`pg-boss`** (npm, MIT) for the queue. Do not write a queue.

The runner reads a factory definition and executes it:

```yaml
# an example definition — factories/<name>/factory.yaml
name: Ad templates
input:
  source_ad: image
stages:
  - id: extract
    rung: 2
  - id: build
    rung: 2
    loops: true
    max_attempts: 8
  - id: render
    deterministic: true       # runs code, never a model
  - id: review
    ladder: standard
  - id: sign
artefact: image
skill: ad-template-design
delivers_to: [blockwise]
```

**The escalation ladder — implement exactly this, and share it across all factories:**

```
rung 1  deterministic checks     no model, free, ALWAYS RUNS FIRST
rung 2  cheapest model           frank-bulk
rung 3  second cheap model       frank-bulk, independent — BOTH must agree to pass
rung 4  middle model             frank-planner — ONLY the disputed items, not a fresh review
rung 5  strong model             escalate — ONLY a defect that survived two fix attempts
rung 6  stop                     after max_attempts, mark quarantined and STOP
```

**Rule that must never bend:** on exhaustion the run is marked `quarantined`.
It must never lower the standard in order to produce a result.

Every model call must write a `factory_step` row **and** its `factory_piece`
rows before the next step begins. If the process dies, the trace so far must
still be readable.

Prompts must be assembled from labelled parts so the origin can be recorded:

```ts
buildPrompt([
  { origin: 'skill',    text: skillMarkdown },
  { origin: 'input',    text: describeInput(input) },
  { origin: 'defects',  text: previousDefects },
  { origin: 'contract', text: outputSchema },
])
```

**Done when:**
- [ ] A fake test factory with three stages runs end to end
- [ ] Every step and piece is written before the next step starts
- [ ] Killing the process mid-run leaves a readable partial trace
- [ ] A run that fails 8 times ends `quarantined`, never `passed`
- [ ] Prompt pieces have their `origin` recorded
- [ ] All four verification commands pass

---

### W4-3 · The trace viewer

**Depends on:** W4-2
**Allowed:** `apps/web/src/app/tools/**`
**Forbidden:** `apps/api/**`

Four panels. This is the feature the owner asked for by name.

**Top — the flow.** Use `reactflow` (npm, MIT). One node per stage. Loops drawn
as a loop back to the same node with the attempt count on it. Colour: green
passed, amber looped, red failed. Running cost shown along the top.

**Left — the attempts list.** Every step in order. Each row: attempt number,
stage, verdict, cost. Click to select.

**Centre — the artefact.** Whatever the step produced.
- If the factory's `artefact` is `image`: show the rendered image, with any
  defects drawn as boxes on top of it using their coordinates.
- If `text`: show the text.
- Never show a summary of what happened. Show the thing itself.

**Right — the prompt, colour-coded by origin.** This is the most important
panel. Each piece of the prompt gets a coloured left border and a label:

```
skill     aqua     "from your rules"
input     blue     "from the input"
defects   orange   "from the previous attempt"
contract  grey     "required format"
```

**Plus a compare mode:** pick any two attempts, show them side by side. Use
`react-compare-slider` for images and `react-diff-viewer-continued` for text.
Do not write a diff algorithm.

**Plus a cost breakdown table:** stage, rung, model, number of calls, cost.

**Done when:**
- [ ] A completed run renders all four panels
- [ ] A run still in progress renders without errors
- [ ] Clicking an attempt changes the centre and right panels
- [ ] Prompt pieces are visibly coloured by origin with a legend
- [ ] Compare mode works for two attempts
- [ ] The cost table adds up to the run's total
- [ ] It works at 390px wide as well as full screen
- [ ] All four verification commands pass

---

### W4-4 · The tools page

**Depends on:** W4-3
**Allowed:** `apps/web/src/app/tools/**`, `apps/api/src/routes/factories.ts` (new)

A list of every factory. For each: name, description, a Start button, and its
recent runs with status and cost. Clicking a run opens the trace.

The Start form is generated from the factory's `input` declaration. Do not
hand-write a form per factory.

**Done when:**
- [ ] Every factory with a `factory.yaml` appears automatically
- [ ] Starting one creates a queued run and the page shows it
- [ ] Adding a new factory folder makes it appear with no code change
- [ ] All four verification commands pass

---

## WAVE 5 — The first real factory

### W5-1 · Write the skill first

**Depends on:** Wave 4
**Allowed:** the ad-template-design skill folder in the skills library
**Forbidden:** any code

**No code in this task.** Write markdown.

Create `ad-template-design/SKILL.md` with frontmatter `name` and `description`,
then sections covering: what makes a good ad template, the exact required sizes
(Feed 1080×1350, Story 1080×1920), safe zones, text limits, what gets rejected,
and how Story differs from Feed — **Story is a redesign, never a crop or a
stretch of Feed.**

Put detail in `references/`.

**Done when:**
- [ ] The skill appears on Frank's skills page
- [ ] An agent given only this skill and one real source ad produces a layout
      description the owner agrees is close
- [ ] That output is saved into the skill folder as an example

---

### W5-2 · The contracts

**Depends on:** W5-1
**Allowed:** `packages/template-pack-contract/**` (new)

Two schemas, using `zod` (already a dependency).

`TemplatePack` — what Frank delivers. Must contain both layouts, a shared list
of the fields a customer fills in, geometry per layout, font files with their
hashes, and a signature. Must **not** contain: executable code, HTML, external
URLs, private source images, prompts, or rejected candidates.

`AdDocument` — what a customer's ad looks like while being edited.

Write a test fixture for each of these failure cases, and make each one fail
with a distinct error code: missing Story layout, mismatched field keys,
invalid geometry, wrong font hash, external URL present, bad signature, text
too long.

**Done when:**
- [ ] Both schemas exist and are exported
- [ ] Every listed failure case has a fixture and a distinct error code
- [ ] The same input always produces the same hash
- [ ] All four verification commands pass

---

### W5-3 · The renderer

**Depends on:** W5-2
**Allowed:** `packages/ad-renderer/**` (new)
**Forbidden:** any model call, any network call

**Write the test before the renderer.**

Turns an `AdDocument` into a PNG. Byte-identical output from identical input.

Use **`satori`** to produce SVG, then the **resvg Rust binary** to produce PNG.
Do **not** use the `resvg/resvg-js` npm package — it has had no stable release
since March 2024.

Non-negotiable settings:
- fonts loaded from files committed in this package, passed as buffers
- system fonts disabled
- no network access at render time
- exact output sizes: 1080×1350 and 1080×1920

**First commit must be the golden test:** three fixture documents, their
expected SHA-256 hashes committed to the repo, and a test that fails if any
hash changes.

**Done when:**
- [ ] The golden test exists and passes
- [ ] Rendering the same fixture twice in separate processes gives the same hash
- [ ] The PNG contains no timestamp or metadata chunks
- [ ] Changing a font file changes the hash (proves fonts are pinned)
- [ ] All four verification commands pass

---

### W5-4 · The ad-templates factory

**Depends on:** W5-3
**Allowed:** `apps/api/src/factories/ad-templates/**` (new)

Now assemble it: `factory.yaml`, the stage handlers, and the delivery step.

Stages: extract the customer fields from the source ad → build a layered
layout → render it → review it → correct it → repeat until it passes or hits
8 attempts. Feed and Story run as **two independent loops** with separate
histories, and both must pass.

The review step returns structured defects only:

```json
{ "decision": "pass|correct|escalate|reject",
  "confidence": 0.0,
  "defects": [{ "code": "stable_code", "severity": "critical|major|minor",
                "placement": "feed|story", "box": {}, "evidence": "short reason" }] }
```

Never prose. The next step is code and needs structure.

**Done when:**
- [ ] One real source ad produces a pack with both layouts
- [ ] The trace shows the rendered candidate at every attempt with defects boxed
- [ ] Prompts in the trace are colour-coded by origin
- [ ] A run that cannot pass ends `quarantined`
- [ ] The cost breakdown shows most calls landed on rungs 1–3
- [ ] All four verification commands pass

---

## WAVE 6 — Signing and delivery

### W6-1 · Sign a pack

**Depends on:** Wave 5
**Allowed:** `packages/release-signing/**` (new)

Use `@noble/ed25519` (npm, MIT). Do not write crypto.

Canonical JSON (sorted keys) → hash → sign. The signing key comes from the
environment and is never logged, never returned by an API, never committed.

**Done when:**
- [ ] Signing then verifying the same pack succeeds
- [ ] Changing one byte makes verification fail
- [ ] The key does not appear in any log line — there is a test for this
- [ ] All four verification commands pass

---

### W6-2 · The releases page

**Depends on:** W6-1
**Allowed:** `apps/web/src/app/releases/**`, `apps/api/src/routes/releases.ts` (new)

Lists every signed release: what it was, when, its fingerprint, where it was
sent, and whether the receiver confirmed. Clicking one shows the pack contents
and links back to the run that produced it.

**Done when:**
- [ ] Every release appears with its fingerprint
- [ ] Clicking through reaches the originating trace
- [ ] All four verification commands pass

---

## WAVE 7 — The hub

### W7-1 · Project pages and widgets

**Depends on:** Wave 6
**Allowed:** `apps/web/src/app/projects/**`, `apps/api/src/routes/projects.ts`

Use `react-grid-layout` (npm, MIT) for the canvas. Do not write drag-and-resize.

A widget is a folder containing a manifest, a React view, a data function, and
a test. A widget that throws must render a small error card with a Retry
button — **it must never break the page.** There is a test for this.

Start with six: waiting on you · running now · recent results · open chats ·
project status · data health.

**Done when:**
- [ ] A project page renders its widgets
- [ ] Layout can be edited and saved, and reloads the same
- [ ] A deliberately broken widget shows an error card and its neighbours still work
- [ ] It renders at 390px wide
- [ ] Keyboard navigation reaches every control
- [ ] All four verification commands pass

---

## WAVE 8 — The graph and the discovery layer

### W8-1 · The graph page

**Depends on:** Wave 7
**Allowed:** `apps/web/src/app/graph/**`

Use `sigma` + `graphology` (npm, MIT). Compute the layout on the server and
send positions — do not lay out 20,000 edges in the browser.

Two layers, switchable: code (from the existing CodeGraph service) and
knowledge (from Hermes' memory).

**Done when:**
- [ ] Both layers render and can be switched
- [ ] 20,000 edges pan and zoom without freezing
- [ ] Clicking a node shows everything connected to it
- [ ] All four verification commands pass

---

### W8-2 · The discovery job

**Depends on:** W8-1
**Allowed:** `apps/api/src/discovery/**` (new)

A nightly job that reads across **all** projects' memories and proposes
connections nobody has made. Four searches, all running on rung 1 or 2:

1. **Same idea, different words** — vector similarity across project boundaries
2. **Shared rare things** — entities appearing in two projects, weighted so
   common ones score near zero
3. **Surprisingly often together** — pairs appearing together far more than
   chance explains
4. **The missing link** — A connects to B, B connects to C, A and C never
   connected. Only this one may use a model, and only on the top 50 candidates.

Each proposal gets a score and appears in the hub as a suggestion with
**yes / no / later**. The answer adjusts the weight of whichever search
produced it. A proposal rejected three times is never shown again.

**Done when:**
- [ ] The job runs nightly and writes proposals
- [ ] Each of the four searches produces at least one proposal on real data
- [ ] Answering yes or no changes that search's weight
- [ ] The job never runs during a chat request
- [ ] Total nightly cost is under $0.10 — there is a test asserting the cap
- [ ] All four verification commands pass

---

## Appendix A — Libraries to use

Do not write your own version of any of these.

| Job | Package | Licence |
|---|---|---|
| Chat UI | assistant-ui/react | MIT |
| Dashboard grid | react-grid-layout | MIT |
| Flow diagram | reactflow | MIT |
| Graph | sigma + graphology | MIT |
| File tree | react-arborist | MIT |
| Markdown | react-markdown + shiki | MIT |
| Frontmatter | gray-matter | MIT |
| Image compare | react-compare-slider | MIT |
| Text diff | react-diff-viewer-continued | MIT |
| Queue | pg-boss | MIT |
| Signing | @noble/ed25519 | MIT |
| Schemas | zod | MIT |
| SVG layout | satori | MIT |
| SVG → PNG | resvg **Rust binary** | MPL |
| Model access | openai (pointed at the gateway) | Apache |

Before adding anything not on this list: check its licence, check its last
release date. If it has not shipped in over a year, do not use it.

## Appendix B — Things that look right and are wrong

| Do not use | Why |
|---|---|
| resvg/resvg-js | No stable release since March 2024 |
| zed-industries/agent-client-protocol | Superseded; dead since October 2025 |
| Any MCP server from servers-archived | Postgres, GitHub, Slack, Redis — all archived |
| Watchtower | Discontinued |
| MinIO | Archived April 2026 |
| Self-hosted Sentry | Not open source |
| Iceberg / Lakekeeper / OpenFGA | Deliberately cut. Do not reintroduce. |
| A second memory system | Hermes has one |
| A second scheduler | Hermes has one |

## Appendix C — When you disagree with this plan

Say so. Write which task, what you would do instead, and why. Then stop and
wait for an answer.

Do not silently do something different, and do not do it the way the plan says
if you believe the plan is wrong. Both are worse than asking.
