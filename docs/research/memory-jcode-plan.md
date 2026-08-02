# Memory Architecture Plan — "embed every turn" (jcode idea)

> Status: PLAN / GRILL — not built. This is the #4 OSS item: steal jcode's
> "semantic vector memory on every turn" idea, adapted to Frank's architecture.
> Source: `1jehuang/jcode` (see `docs/research/repo-reviews.md`).

## The idea worth stealing

jcode embeds **every turn** into a semantic vector store and recalls on every
turn — 14ms start, memory is always warm. The point isn't jcode's numbers; it's
the *cadence*: memory write + recall happen on the hot path of every exchange,
not as a background afterthought.

## What Frank already has (don't rebuild)

Frank's `@frank/memory` port (FRANK-§7.4, BRAIN-006) already does most of this:

- `recall({ query, scope, topK })` → minimized, relevance-ranked facts, stamped
  `generated-untrusted`. **Already called every turn** in the context-pack
  assembler (`apps/web/src/app/api/chat/route.ts` → `packForTurn`).
- `store({ messages, scope })` → hands turns to the backend (mem0 + Gemini) to
  extract durable facts. **Already called every turn** (fire-and-forget after
  each chat response).
- Backend = self-hosted mem0 on `:8888` (pgvector), one swappable impl behind
  the port. `list/edit/expire/remove` give the BRAIN-006 control surface.

So Frank already reads and writes memory every turn. The gap vs jcode is **not**
cadence — it's three specific things.

## The real gaps (what a build would actually change)

1. **Extraction latency hides recall quality.** `store` is fire-and-forget and
   mem0 extracts asynchronously via Gemini. A fact said 2 turns ago may not be
   recallable yet. jcode embeds synchronously. *Decision needed:* is delayed
   extraction acceptable, or do we want a fast synchronous "working memory"
   buffer that recalls even pre-extraction turns? (Spec §10.1 already names a
   "Turn context / Working state" layer with short retention — this is where it
   would live.)

2. **No turn-level embedding, only extracted-fact embedding.** mem0 stores
   distilled facts, not raw turns. That's *good* for noise, but it means a
   precise "what did I say 3 messages ago" recall depends on Gemini having
   extracted it. *Decision needed:* add a cheap, short-TTL raw-turn vector index
   alongside the distilled-fact index? Adds an index to manage; violates the
   "memory is minimized, not a dump" invariant if wired into recall naively.

3. **Recall isn't measured.** There's no eval proving recall returns the right
   facts. jcode's claim is unverified for Frank. *Decision needed:* build a small
   recall-quality eval (seed known facts, query, measure precision@k) before
   claiming the memory layer works — this is the highest-value, lowest-risk item.

## Recommendation (for the grill)

Don't rebuild jcode. Frank's port is the right shape. Do, in order:

1. **Recall-quality eval** (§3 above) — ~half a day. De-risks everything else.
   If recall is already good, most of the "embed every turn" anxiety dissolves.
2. **Working-memory buffer** (gap 1) ONLY if the eval shows recent-turn recall
   is weak — a short-TTL synchronous buffer feeding recall alongside mem0.
   Maps to spec §10.1's existing "Turn context" layer.
3. **Skip gap 2** (raw-turn index) unless the eval specifically shows distilled
   facts miss precise recent quotes. It fights the minimization invariant.

## Why this is a plan, not a build

It changes the recall hot path that every Frank turn depends on. Wrong move here
degrades every conversation. The eval (item 1) is the safe first step and the
one thing to actually do next; items 2–3 are conditional on what it shows.

## OSS check (per the hard rule)

- **jcode** (1jehuang/jcode) — the idea source; Rust, dropped as a harness for
  Goose, but the "embed every turn" cadence is the steal. 🔴 skip code, 🟢 steal idea.
- **mem0** — already the backend; has its own short-term-memory layer we're not
  using. Check `mem0`'s short-term memory API before building gap-1 buffer by hand.
- **No new repo to adopt** — this is tuning an existing, justified subsystem, not
  a new capability. Logged in repo-reviews.md.
