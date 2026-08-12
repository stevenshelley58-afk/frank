# FRANK.MY — Free Overnight Answers, Private by Default

**Working name:** `frank.my` — placeholder, final name TBD (this file keeps its original name until the name lands; rename then). Tagline direction worth keeping regardless of name: *"Frank answers. Free, private, overnight."*

**Status:** Draft v2 — decisions from Steven applied (price $300, $20/day budget, 3-slot concurrency + $20 unlock, Resend, 90-day retention, chat-pattern-not-chatpack, no cost display, pricing-scout automation). 2026-08-09.
**Relationship to FRANK:** Standalone product built as a *clone of Frank's patterns* (broker seams, compose infra, contracts-first), not on Frank's runtime — see §9. Designed to graduate into a Frank customer cell (ADR-015) later.

---

## 1. What this is

A free web app where anyone can hand a real problem to serious AI horsepower and get a considered answer back within 24 hours. No signup. No email flows. No lead capture. They give an email address and a PIN; the answer comes back as a link; the PIN decrypts it in their browser. The operator (Steven) cannot read their thread even if he wanted to — and the code is open source so anyone can verify that, or run their own.

Three quiet monetisation surfaces, all optional, none pushed: a **tip button** on the delivered answer, a **$20 "more slots" unlock** for power users who want more than 3 jobs open at once (§7.3), and a **"book Steven" button** — $300 USD flat to get Steven personally on your problem, refunded if he can't solve it. None of them gate the core loop: every answer is free, full depth, forever.

The 24-hour window is not an apology; it is the product. Slowness buys three things at once: **depth** (a multi-pass research pipeline instead of a single chat completion), **cost** (batch APIs run at 50% off across every major provider), and **calm** (no engagement loops, no streaming dopamine, no reason to hang around the site). Like dropping film at a darkroom: come back tomorrow, your answer is developed.

### 1.1 Principles (the non-negotiables)

1. **Free forever.** The core loop never costs money and never requires an account.
2. **Private by default.** Thread content is end-to-end encrypted against the stored data; the operator cannot decrypt it. Sharing with Steven is a deliberate, per-thread, opt-in act — never a default, never required.
3. **No growth machinery.** One transactional email per answer ("it's ready"). No newsletter, no drip, no retargeting, no analytics on content, no dark patterns. This is not lead gen; the booking button just sits there.
4. **Slow on purpose.** Up to 24h, usually much faster. The queue is honest about its state.
5. **Open source, self-hostable.** `git clone`, `docker compose up`, bring your own API keys. The privacy claims are auditable.
6. **Real value or nothing.** Max-depth answers: researched, cited, red-teamed before delivery. If the pipeline can't produce something genuinely useful, it says so plainly rather than padding.

---

## 2. The experience

### 2.1 First visit

Single page. A chat composer (the UI is an async 1:1 message thread — chatpack-*shaped*, built by us, see §9.3), one system message at the top explaining the deal in ~4 lines, and a composer that says *"Tell Frank your problem. Take your time — detail helps."* People can share as much or as little as they want: generous paste limit (~50k characters), and the composer offers a few **optional intake nudges** — static prompts, no model call — that pull the answer-shaping facts out of them: *"What does solved look like?" · "What have you tried?" · "Constraints — time, money, tools?"* Better inputs are the cheapest quality lever the pipeline has.

On first send, an inline sheet collects:

- **Email** — "only used to tell you when your answer is ready." An explicit **"no email — I'll check back"** mode skips even this: they bookmark their thread link and the page shows queue status. In that mode the service holds zero PII.
- **PIN** — chosen by them, minimum 4 digits but the UI nudges toward a 6+ character word-PIN ("a short word and two digits beats 4 digits — it's what encrypts your answer"). Shown once with a plain-language line: *"Your PIN encrypts this thread. We never see it. If you lose it, nobody — including us — can recover your answer."*

The browser then generates the thread's cryptographic material (§4), encrypts the message, and submits. The confirmation screen shows the **claim link** ("bookmark this — it plus your PIN is your answer") and, if email was given, sends a **confirm-to-queue email** (double opt-in; the job does not enter the queue, and costs nothing, until the click — this is also the main spam gate, §6).

### 2.2 The wait

The thread page (claim link) shows honest status: *queued → running (started 02:14) → ready*. Estimated window, position-free (no false precision). If the daily budget is exhausted (§5.6), it says so plainly: *"Today's free capacity is used up — your job runs in tonight's batch."*

### 2.3 Delivery

One email: subject **"Your answer is ready"**, body = the claim link and nothing else of substance. Content never appears in email. They open the link, type their PIN, and the thread decrypts in the browser: the answer rendered as clean markdown — direct recommendation up front, then reasoning, sources, assumptions made, and "what I'd watch out for."

Every answer ends with a small transparency footer: which models ran, how many web searches, what sources were used. (No cost figures anywhere — decided: the product just says *free*, and the economics stay backstage.) Under it, three quiet options:

- **Tip** — Stripe payment link, pay-what-you-want. One line: *"Always free. Tips keep it that way."*
- **Book Steven — $300** — links to the booking page (§7).
- **Share this thread with Steven** — the opt-in feedback loop (§8).
- **Tell a friend** — copies frank.my with a one-line toast. The only growth mechanic in the product; content is never shareable, only the service.

**Tip and Book Steven also live on the main page** (app bar: quiet "Tip" text button + solid "Book Steven" pill) so neither depends on reaching an answer first. Quiet retention, nothing more: the answer footer says *"yours for 90 days · reply anytime"* — no streaks, no notifications, no re-engagement email.

And the composer stays open: **follow-ups are just more messages in the thread**, each one a new overnight job with the prior thread as context. "Ask another" is the natural next message, not a separate flow.

### 2.4 After the answer — the repeat-use engine

The rule stays absolute: **every answer is complete and self-contained.** Nothing below is ever needed to get full value from what was asked. What follows the answer exists because a good answer naturally opens doors, and pointing at them honestly is more value, not less.

**Worth asking next.** The pipeline's synthesis stage also drafts 2–4 follow-up briefs (near-zero marginal cost — a few hundred extra output tokens in the same batch call). Each renders as a one-liner the reader can expand: the suggested question, then two or three sentences on *what Frank would dig into*, then a **value line** — what the answer would be worth to them, stated as outcome, never features ("you'll know by week 3 whether it's working, not week 12"). One tap pre-fills the composer; they edit or send. The section header carries the promise inline: *each is a free overnight answer.* This is the single biggest repeat driver: the product tells you, specifically and honestly, what it can do for you next.

**The bigger picture.** Triage and synthesis watch for a genuinely larger project behind the question — a system, not an answer ("turn your card-terminal data into a regulars engine"). When one exists, the answer ends with one quiet card: what the project is, why it compounds, its value in one line, then two equal paths: **"Break it into steps — free"** (pre-fills a DIY-roadmap request) and **"Or book Steven."** Hard rule: the card appears *only when the project is real* — the red-team pass strikes boilerplate bigger-pictures. An empty slot on most answers is what makes the card credible when it shows. This is the organic bridge from free answers to the $300 booking: scoped by the work itself, never pitched.

**The check-back voice.** Answers end with a doing instruction, not a goodbye: *"If you do one thing, do X — then reply with what happened."* Assumptions sections already invite correction. Return visits come from the answer being a live collaboration, not from notifications — of which there are none.

**Sharing the answer.** Owner-initiated only, and dead simple: **Share → Copy answer link.** The client mints a fresh key, re-encrypts a read-only snapshot of that Q+A, and produces a link that opens by itself (key in the fragment). The copy states it plainly: *"When you share the link, it's visible to whoever has it. Your thread stays private."* Recipients see the question, the full answer, a *Shared from a frank.my thread* banner, and one closing line: *"Got a problem of your own? Ask anything — free."* The shared answer is the entire marketing engine: real proof of value, passed hand to hand by the person it helped. Share links are revocable and expire with the thread's retention. The share sheet also holds the two quieter intents: *Send a copy to Steven* (feedback) and *Just share frank.my*.

### 2.5 Edge cases in the experience

- **Lost PIN:** unrecoverable by design; the thread page says so and offers "start a new thread." (The confirmation screen warned them at set time.)
- **Lost email/link:** the claim link was shown at submission for bookmarking; the delivery email re-carries it. If both are gone, the thread is gone — same as the PIN story, and the FAQ says so.
- **Needs clarification:** batch jobs can't ask mid-run. The plan stage (§5.2) instead answers under explicit, stated assumptions — the answer opens with "I assumed X and Y; if that's wrong, reply and tomorrow's answer will correct course."
- **Urgent/crisis content:** triage (§6.4) short-circuits the batch — crisis messages get an immediate, gentle, resource-pointing reply rather than a 24h wait; disallowed content gets a polite immediate refusal. Nothing else jumps the queue.
- **Job failure:** bounded retries; if the pipeline truly fails, an honest "it broke, it's been re-queued at no cost to you" status. Expired batch requests are free (provider-side), so failure costs nothing.

---

## 3. What we promise — and the exact honest wording

Privacy claims destroy trust when they overreach. These are the claims the product makes, worded so every one of them is true:

> **"Your thread is encrypted with keys only you hold."** Stored messages and answers are ciphertext. The decryption key is derived *in your browser* from your claim link + PIN. Neither is ever sent to the server. We cannot read your stored thread — not for debugging, not under pressure, not if we wanted to.
>
> **"To answer you, an AI has to read your question."** At processing time your message is decrypted *inside the worker's memory only* and sent to the model provider over TLS. It is never written to disk, database, or logs in plaintext, and the working copy is destroyed when the job completes. Model providers we route to must contractually not train on API data (§5.5). This is the honest limit of any service that computes on your data — and because the code is open source, you can check it, or run your own copy where even this step is yours.
>
> **"Email is for one thing."** If you give one, it receives exactly one kind of message: "your answer is ready." Delete your thread and the address goes with it. Use no-email mode and we hold no PII at all.

**What Steven can see:** job counts, timing, per-job cost, model mix, error rates, tips, bookings — operational numbers only, never content. **What Steven can read:** only threads explicitly shared with him (§8).

---

## 4. Privacy architecture

### 4.1 Key material (per thread)

All client-side, libsodium in the browser:

1. **Link token `T`** — 128-bit random, lives only in the URL fragment (`frank.my/t/<id>#<T>`). Fragments are never sent in HTTP requests, so the server never sees `T`.
2. **Salt `S`** — 128-bit random, stored server-side with the thread (public-safe).
3. **PIN `P`** — user-chosen, never transmitted.
4. **Seed** = Argon2id(`P`, `S`) with aggressive parameters (64 MiB, t=3) — makes each PIN guess cost ~1s.
5. **Thread keypair** `(U_priv, U_pub)` = X25519 keypair derived from HKDF(Seed, `T`). **`U_pub` is stored server-side; `U_priv` exists only transiently in the browser after the user enters their PIN.**

### 4.2 Data flows

- **Every message body** (the user's and Frank's) is stored as a **sealed box to `U_pub`**. Only someone holding link + PIN can derive `U_priv` and open the thread. This is the "can't read it even if I wanted to" property, and it is literally true for data at rest.
- **Job submission:** the client *additionally* seals (new message + decrypted thread history as context) to the **worker's public key `W_pub`** into a `jobs` row. The worker holds `W_priv` (in OpenBao/env on the VPS, never in the DB), decrypts in memory, runs the pipeline, seals the answer to `U_pub`, writes it to the thread, and **deletes the job ciphertext**. The client can package thread history because it has plaintext locally after decryption — the server never needs to decrypt anything.
- **Delivery email** carries the claim link (with `#T`). Email content never includes thread content.
- **Deletion:** a delete button on the thread purges messages, keys, salt, email — everything. Answers also age out by default retention (propose 90 days, §12).

### 4.3 Threat model (plain language)

| Scenario | What they get | Why |
|---|---|---|
| Database or backup leaks | Ciphertext, `U_pub`, salts, email addresses | Messages need `T` (never stored) + PIN. 128-bit `T` alone makes brute force infeasible. Emails are the one real PII exposure — minimised by no-email mode and deletion. |
| Your delivery email is intercepted/compromised | The claim link (`T`) but not the PIN | Attacker can attempt offline PIN guessing at ~1s/guess (Argon2id). A 4-digit PIN falls in hours; a 6+ char word-PIN is effectively safe. This is why the UI nudges word-PINs. Honest FAQ entry, not fine print. |
| Server actively compromised / malicious operator *at runtime* | Plaintext of jobs **in flight** (not stored history) | The worker must decrypt jobs to process them. Open source + verifiable deploys keep this honest; paranoid users self-host. |
| Model provider | Plaintext of the jobs routed to them | Unavoidable to compute. Mitigated by the provider privacy floor (§5.5): no-training-by-default terms, limited retention. |
| Steven reading stored threads | Nothing | No `T`, no PIN, no `U_priv`. This is the design's whole point. |

### 4.4 Design decisions worth stating

- **PIN alone is not the crypto** — the link token is. A 4-digit PIN as sole protection would be theatre (10,000 guesses). PIN + high-entropy link token means the DB leak case is solid and the email-interception case degrades gracefully with PIN strength. This is the standard two-factor pattern: something you received (link) + something you know (PIN).
- **No accounts, no password resets, no recovery** — by design. Recovery paths are backdoors. The copy owns this loudly.
- **The original "share your PIN with me" idea is replaced** — see §8. Sharing a PIN would unlock the *whole thread forever* including future messages, train users to hand secrets over chat, and put Steven in possession of user keys (a liability, not an asset). The consent-share flow achieves the same goal with none of that.

---

## 5. The answer engine — max depth, model-agnostic, cost-solved

The engine goes **max depth on every job** and stays affordable through four levers that multiply together: **batch APIs** (50% off at every major provider — the 24h promise makes this free money), **an escalation cascade** (frontier models only touch the tokens that deserve them), **prompt caching** (shared system prompts at 0.1× on re-reads, stacking with batch), and **capped tool use** (web searches are the sneaky dominant cost; the planner budgets them).

### 5.1 Model-agnostic router (the "clone of Frank" part)

A small `packages/router` module — Frank's Model Broker (ADR-009) in miniature, and its first real-world dogfood:

- **`models.yaml`** — a versioned price/capability table: provider, model, batch input/output $ per MTok, context, tool support, privacy class. Kept current by the **pricing scout** (§5.7) — prices moved three times this year already; Sonnet 5 goes from $2/$10 to $3/$15 on 1 Sep 2026.
- **Route policy per pipeline stage:** each stage declares *requirements* (capability floor, privacy floor, max $/job share); the router picks the cheapest qualifying model and provider, with a fallback chain. Swap providers by editing YAML, not code — LiteLLM (or plain per-provider adapters behind one interface) handles API normalization, exactly the ADR-009 split.
- **Batch everywhere:** every stage runs through the provider's batch endpoint. All three majors discount 50% and resolve well inside the 24h window (Anthropic: most batches < 1 hour).

### 5.2 Pipeline stages (all batched)

1. **Triage & plan** — cheap model (Haiku 4.5 / Gemini Flash-Lite class). Classifies safety and domain, extracts the *actual* problem, decomposes into 2–6 research questions, decides whether current-world info is needed (web on/off), states the assumptions it will answer under, and sets the job's difficulty class → budget envelope (§5.6).
2. **Research fan-out** — one batched request per research question on a cheap model with **web search capped** (`max_uses` ≈ 4–6) and web-fetch for pasted URLs. Output: structured notes with citations, confidence, and dissenting sources. Skipped entirely when triage says the problem is self-contained (a surprising share of real problems are).
3. **Synthesis** — the answer gets written **once, by the best model the job deserves**: Sonnet 5 drafts; a cheap judge scores the draft against the plan ("would a smart generalist pay for this?"); drafts that fall short escalate to **Opus 5 or Fable 5** for a rewrite with the same notes. Expect ~⅓ of jobs to escalate — that's the cascade paying for itself: frontier prices on a minority of jobs, frontier quality wherever it matters. Hard-class jobs (triage-flagged) skip straight to the frontier model.
4. **Red-team** — a different model from the drafter checks: factual claims vs. notes, hallucinated citations, missed angles, safety, and the "so what" test (is there an actionable recommendation up front?). One bounded revision loop.
5. **Package & deliver** — render, add assumptions + sources + transparency footer, seal to `U_pub`, email "it's ready."

### 5.3 What the majors cost today (batch prices, verified 9 Aug 2026)

| Provider | Model | Batch in / out ($/MTok) | Role in pipeline |
|---|---|---|---|
| Anthropic | Fable 5 | 5.00 / 25.00 | Escalation ceiling (hardest jobs) |
| Anthropic | Opus 5 | 2.50 / 12.50 | Escalation synthesis |
| Anthropic | Sonnet 5 | 1.00 / 5.00 *(→1.50/7.50 from 1 Sep)* | Default synthesis + red-team |
| Anthropic | Haiku 4.5 | 0.50 / 2.50 | Triage, research, judging |
| OpenAI | gpt-5.6-sol | 2.50 / 15.00 | Alt escalation |
| OpenAI | gpt-5.6-terra | 1.00 / 6.00 | Alt synthesis / cross-check red-team |
| OpenAI | gpt-5.6-luna | 0.10 / 0.60 | Alt research |
| Google | Gemini 3.6 Flash | 0.75 / 3.75 | Alt synthesis |
| Google | Gemini 3.5 Flash-Lite | 0.15 / 1.25 | Alt triage/research |
| DeepSeek | V4-Flash | 0.14 / 0.28 (no batch needed) | **Excluded from default routing** — privacy floor (§5.5); optional self-host/eco lane later |

Anthropic's web search tool: **$10 per 1,000 searches** plus tokens; works inside batches. Search results bill as input tokens — this, not model choice, is where careless pipelines bleed money, hence the per-stage caps.

### 5.4 Worked cost, one max-depth job

Typical job: plan 5k in / 1k out (Haiku); research 3 questions × 5 searches, ~60k in / 5k out total (Haiku); synthesis 35k in / 6k out (Sonnet); red-team 15k in / 2k out (Haiku/Sonnet mix):

| Stage | Cost |
|---|---|
| Triage & plan | ~$0.005 |
| Research (15 searches $0.15 + tokens ~$0.045) | ~$0.20 |
| Synthesis (Sonnet draft) | ~$0.065 |
| Red-team + revision margin | ~$0.03 |
| **Typical job, no escalation** | **~$0.30** |
| Same job escalated to Opus 5 rewrite | +$0.16 → ~$0.46 |
| Same job escalated to Fable 5 rewrite | +$0.33 → ~$0.63 |
| Self-contained job (no web) on Sonnet | **~$0.10** |

**Planning figures: median ≈ $0.20–0.30, p95 ≤ $0.80, hard ceiling $1.00/job** (the envelope, enforced — a job that would exceed it delivers what it has with an honest note). Inside the fixed **$20/day** budget that's roughly **60–100 max-depth answers a day, ~$600/month worst case** — one booking a month plus a handful of tips covers it. These numbers stay internal (decided: the site just says *free*); they exist so routing decisions have a target to optimise against.

### 5.5 Provider privacy floor

Model-agnostic **but privacy-gated** — Frank's `DataRouteDecision` idea in miniature. Default routing requires: API data **not used for training by default**, bounded retention, no PRC-jurisdiction storage. Anthropic meets it (verified: "By default, we will not use your inputs or outputs from our commercial products to train our models"; zero-data-retention agreements exist for scale-ups later). OpenAI and Google paid API tiers claim equivalents — **verify their current terms before enabling them in default routes** (open task, §11). DeepSeek's pricing is spectacular but its data terms fail the floor; it stays out of default routing and becomes the reason to add a self-hosted open-model lane someday.

### 5.6 The cost governor

- **Per-job envelope** by triage class: simple $0.10 / standard $0.40 / hard $1.00.
- **Global daily budget: $20/day** (decided). **Quality-first rule, explicit policy:** when budget runs short, the governor *defers whole jobs to the next window* — it never silently thins the pipeline to squeeze more jobs in. Fewer answers today beats worse answers today; the status copy owns the wait honestly.
- **Batch cadence:** submit accumulated jobs every 30 min; poll results every 5. Consolidated submissions maximise prompt-cache hits (shared system prompts at 0.1×; provider-reported hit rates of 30–98% in batches).
- **Kill-switch:** a spend monitor that halts submission (never destroys queued jobs) if any hour exceeds 3× the expected burn — the "oops, someone found an abuse vector" brake.

### 5.7 The pricing scout (cost-driving is a permanent job, so automate it)

Prices, models, and discounts move constantly — this gets a **dedicated scheduled agent**, not occasional manual effort:

- **Nightly run:** re-reads the provider pricing/docs pages, diffs against `models.yaml`, and opens a PR when anything moved — new models, price changes, new discount mechanisms (batch tiers, off-peak windows, cache pricing).
- **Route advisor:** alongside the diff, it recomputes the cheapest-qualifying model per pipeline stage and proposes route changes ("Gemini 3.6 Flash now beats Sonnet for synthesis on $/quality — suggest A/B"), with the privacy floor (§5.5) as a hard constraint it can never trade away.
- **Cost report:** blended $/answer trend, escalation rate, search spend share — the dashboard that tells you whether the $20 is buying more answers this month than last.
- Route changes ship only after an eval pass (a small fixed set of benchmark problems, answers scored by a judge model) — the scout drives cost down; it is never allowed to drive quality down to do it.

---

## 6. Abuse & safety (a free compute service is an abuse magnet)

The design already blunts the worst of it — batch-only means nobody can farm the service as a fast free LLM API, and double opt-in means unverified email costs you nothing:

1. **Nothing enqueues until the email confirm click** (or, in no-email mode, until a Cloudflare Turnstile passes). Bots that never confirm never cost a cent.
2. **Concurrency, not quotas:** 1 active job per thread; **3 open jobs at a time per email**, free — no weekly or lifetime caps. Since each job takes up to a day, concurrency is naturally self-limiting (~3/day ceiling for free users) without ever telling an honest heavy user "you've had enough this week." Want more lanes? **$20 USD unlocks more slots** (§7.3) — which also attaches a Stripe-verified identity, quietly filtering the abuse crowd from the power users. IP-level submission throttles at the edge (Caddy) back it all up.
3. **Size caps:** message ≤ ~50k characters v1 (people can share as much or as little as they want; the intake nudges help them share the *right* things); context assembly capped; output capped (≈8k tokens).
4. **Content triage** (part of stage 1, so it's free): refuse disallowed content politely and immediately; crisis content short-circuits to an instant supportive reply with real resources instead of a 24h wait; medical/legal/financial answers carry natural "this isn't professional advice" framing.
5. **Provider relationship:** one paid API org per provider, batch endpoints, spend alerts on the provider side as the outer belt-and-braces.

What deliberately does *not* exist: CAPTCHAs on every action, accounts, phone verification. Friction budget goes to exactly two moments — confirm click, PIN entry — both of which serve the user, not the operator.

---

## 7. Money — tips, slots, and the $300 booking

### 7.1 Tips

Stripe Payment Link (pay-what-you-want), shown in the answer footer and nowhere else. No pre-set guilt tiers, no popups, no "support us" banners. Copy: *"Always free. Tips keep it that way."* Stripe's hosted page means no card data ever touches the app.

### 7.2 Book Steven — $300 USD

The promise, verbatim, on one page:

> **Book my attention — $300 flat.**
> You get me, personally, on your problem. We start with a call: we spec exactly what "solved" looks like. Then I go do it. One of three things happens:
> 1. **I solve it** — you got a specialist for a flat fee.
> 2. **I can't solve it — full refund.** No argument, no partial-effort fee.
> 3. **It turns out bigger than $300** — I tell you at the call or as soon as I know, and you choose: scope down to something $300-solvable, agree a bigger number, or take the refund.
> The AI answers are free and always will be. This is for when you want a human who ships.

**Flow:** Stripe Payment Link ($300 USD) → success redirects to Cal.com booking (pay-first filters tyre-kickers and makes the calendar real) → intake form ("what's the problem, what does solved look like, links/context — and if you have a thread here, you can share it," §8). After the call: deliver / refund / re-scope, in writing, in one email.

**Boring-but-important:** refunds via Stripe (fees on refunds are small but nonzero — the promise eats them); currency **USD** (decided); Australian GST treatment once revenue is real — one conversation with your accountant, not a blocker. Cal.com is open source, fitting the stack's ethos.

### 7.2b Revenue that stays value-first (parked ideas, in honesty order)

- **Standing questions** *(strongest candidate)*: some problems recur — "re-run my competitor scan monthly," "re-check this pricing quarterly." Frank re-runs the thread on a schedule and emails the delta. Real recurring compute → fair to tie to the $20 unlock tier rather than keep free-unlimited. Repeat use by design, and the first paid thing that's a *capability*, not an answer.
- **Private deployments**: a business that loves it pays Steven to stand up a private instance (the repo is open source; the service is expertise). Natural big-ticket extension of the booking — "run Frank inside your company" — priced per engagement.
- **Content flywheel**: with explicit consent, the best *shared-with-Steven* threads become anonymised "problems Frank solved" write-ups — trust-building, searchable, zero cost. Marketing that is literally just demonstrated value.
- **Patronage** *(parked, sceptically)*: "this week's answers funded by X" is public-radio-style underwriting, but it's one step from advertising and dilutes "no catch." Revisit only if costs outgrow tips + bookings.

### 7.3 More slots — $20 USD (optional, for power users)

Free users run **3 open jobs at a time**, forever, with no volume cap. A one-off **$20 USD** unlock raises an email's concurrency (proposed: **10 slots** — confirm the number, §12). Framing matters: this is *not* paying for answers — answers are free at any tier — it's paying for **parallel lanes**, which maps to real cost (open jobs are what consume the daily budget). Nice side effects: the $20 crowd funds roughly their own burn, and a Stripe-verified identity attached to high-concurrency accounts is a better abuse filter than any CAPTCHA. Implementation is one Stripe Payment Link + a webhook flipping `slot_limit` on the hashed email.

---

## 8. The feedback loop — "share with Steven," done right

Replacing PIN-sharing (see §4.4) with a **per-thread consent share**:

After decrypting, the user can hit **"Share this thread with Steven."** The client re-encrypts the *decrypted* thread to **Steven's own public key** and posts it with a consent record (timestamp, scope: this-thread-as-of-now). Future messages are not included — sharing is a snapshot, repeatable if they choose. A shared thread lands in a private review queue Steven decrypts locally.

Properties worth having: the user never reveals a secret; the share is scoped and auditable; even shared content sits encrypted at rest (to Steven's key, not plaintext); and revocation is a delete-request away. Copy at the button: *"This sends Steven a readable copy of this thread — nothing else, nothing future — to help improve the product. Optional, obviously."*

This is also the **only** product-improvement telemetry that involves content. Everything else Steven learns comes from operational metrics (§13) and voluntarily shared threads.

---

## 9. Infrastructure — the three options, plainly (ELI5)

**Context:** Frank is at Slice 0 — contracts and CI gates exist; no services run yet.

**Option A — a small standalone stack on your VPS (recommended).**
*Like building a food truck in your driveway instead of waiting for the restaurant to finish construction.*
One open-source repo; `docker compose up` brings up Postgres + a worker + the web app behind your existing Caddy on the frank.fail box. Pros: shippable in days; runs on hardware you already pay for; the open-source story is perfect ("clone it, add API keys, compose up"); nothing waits on Frank; VPS-first matches your AGENTS.md rule 0. Cons: you'll own a second small system for a while, and some plumbing (queue, router) is a miniature of what Frank will have — accepted, because the miniature *is the dogfood* and the seams (§9.2) make later migration mechanical.

**Option B — build it as Frank's first customer cell.**
*Like cooking the restaurant's first dish while the kitchen is still being installed.*
Pros: dogfoods ADR-015 cells, the Model Broker, and Temporal durability for real; zero throwaway. Cons: your launch is gated on Slice 1–2 services that don't exist yet; Temporal + NATS + OpenBao + SeaweedFS is an absurd ante for what is, mechanically, a queue, four model calls, and an email; and self-hosters would have to stand up Frank to run a "simple free app," which kills the open-source adoption story. **Verdict: this is the destination, not the starting point.**

**Option C — managed (Vercel + Supabase).**
*Renting a food-court stall: fastest opening, someone else's building.*
Pros: fastest ship, generous free tiers, zero server ops. Cons: contradicts your VPS-first workflow; ties the open-source repo to vendor services (self-hosters must recreate them); usage pricing appears exactly when the thing succeeds; and "your ciphertext lives on someone's serverless platform" is a weaker story than "one auditable box." **Verdict: fine fallback if the VPS becomes a bottleneck; wrong default for this product's ethos.**

**Recommendation: A, built with B's seams.** Queue behind a `WorkflowPort`-shaped interface (Postgres `SKIP LOCKED` now, Temporal later), models behind the router contract (ADR-009 shape), storage behind a thin port — so "graduate into Frank" is an adapter swap, not a rewrite. This *is* the "clone of Frank" you described: clone the patterns, skip the tonnage.

### 9.1 v1 component map

```
Browser (Next.js + libsodium: key derivation, seal/open, chat UI)
   │  HTTPS (Caddy, existing VPS)
   ▼
API (chatpack-style thread/message backend + job endpoints)
   │
Postgres ── threads / messages(ciphertext) / jobs(ciphertext) / events
   │
Worker (single Node process)
   ├─ job intake: open sealed jobs (W_priv from OpenBao/env)
   ├─ router: models.yaml + privacy floor + envelopes (LiteLLM under)
   ├─ batch client: submit every 30 min, poll every 5
   ├─ pipeline: plan → research → synthesize → red-team → package
   ├─ sealer: encrypt answer to U_pub, delete job ciphertext
   └─ mailer: "your answer is ready" (Resend — decided)
Stripe payment links (tips, booking) · Cal.com (booking) · Turnstile (no-email mode)
```

### 9.2 The seams that make it Frank-ready

| Seam | v1 implementation | Frank destination |
|---|---|---|
| `WorkflowPort` | Postgres queue, `SKIP LOCKED`, idempotent steps | Temporal (ADR-005) |
| Model routing | `packages/router` + models.yaml | Model Broker (ADR-009) |
| Privacy routing | provider floor table | `DataRouteDecision` (§2.3) |
| Evidence | red-team gate + citations in answer | `EvidenceManifest` (§6.8) |
| Isolation | separate compose project + DB on the VPS | Customer cell (ADR-015) |

### 9.3 The chat backend: chatpack as pattern, not dependency (decided)

We take the *shape* of [chatpack](https://github.com/chddaniel/chatpack) (MIT) — 1:1 conversation, messages, read-state, SSE for live status — and write our own thin version (~500 lines). Reasons this is the right call here: message bodies are ciphertext (a generic chat backend's assumptions about content buy us nothing), auth is claim-link possession rather than user accounts, and the composer needs custom intake-nudge behaviour. The deliverable is a **full-stack chat interface where people share as much or as little as they want**, with a handful of prompts that help pull the right information out of them — that's an interaction model, not a dependency.

---

## 10. Open source

- **License — decision pending (ELI5 given in chat):** **MIT** = "do anything, even run a closed paid clone, no strings." **AGPL-3.0** = "do anything — but if you run a modified copy as a public service, you must publish your changes." Self-hosters are unaffected either way; AGPL only bites someone standing up a closed clone of your privacy product, which is exactly the clone that shouldn't be unauditable. Recommendation stands: **AGPL-3.0**. (Building the chat layer ourselves means no dependency licensing entanglement either way.)
- **Repo layout** (standalone, public from day one):

```
frank-my/
├─ apps/web        # Next.js UI, client crypto, thread pages
├─ apps/worker     # queue, router, batch, pipeline, mailer
├─ packages/crypto     # envelope code shared client/worker
├─ packages/router     # models.yaml, floors, envelopes
├─ packages/contracts  # zod schemas: thread, job, plan, answer, events
├─ infra/          # docker-compose.yml, Caddy snippet, .env.example
└─ docs/           # this spec, threat model, self-host guide, privacy page source
```

- **Self-host promise in the README:** clone → `.env` (API keys, Resend key, W keypair generated by a script) → `docker compose up` → you run your own private copy. The privacy page and threat model live in the repo so claims and code ship together.
- **No secrets in the repo, ever;** `preflight`-style env validation on boot (Frank pattern, borrowed).

---

## 11. Build order (each run sized to a sitting, Frank-style)

1. **Walking skeleton:** compose file, Postgres, Next.js hello, Caddy route on the VPS, `.env.example`, preview at `preview.frank.fail/frank-my-v1/`.
2. **Crypto core first, alone:** `packages/crypto` + test vectors (derive, seal, open, tamper cases). This is the part that must never be improvised.
3. **Thread + submit flow:** our thin chat backend (chatpack-shaped, §9.3) with ciphertext bodies; claim links; PIN sheet; intake nudges; confirm-to-queue email (Resend); no-email mode + Turnstile.
4. **Worker + router:** queue consumer, models.yaml, one provider (Anthropic batch) end-to-end: plan → synthesize → red-team → sealed answer → "ready" email. **This is the first real answer milestone.**
5. **Research stage + web search caps;** second provider (OpenAI or Google) behind the router to prove model-agnosticism; escalation cascade + judge.
6. **Governor + ops:** envelopes, $20/day budget + defer-not-degrade policy, 3-slot concurrency, kill-switch, metrics counters, status honesty copy.
7. **Money surfaces:** tip link, $300 booking page (Stripe + Cal.com), $20 slots unlock (payment link + webhook), share-with-Steven flow.
8. **Pricing scout:** the scheduled agent from §5.7 — pricing diff PRs, route advisor, eval gate, cost trend report.
9. **Polish + publish:** privacy page, threat model doc, FAQ, README self-host guide → public repo, soft launch.

Verification gates before "public": crypto test vectors pass in CI; a stranger can self-host from README alone; a $0-budget day degrades honestly; a crisis message gets the immediate-support path; restore-from-backup drill leaves no plaintext anywhere.

### v2+ (parked, deliberately)

File uploads (client-encrypted), pasted-URL fetching v1.5, self-hosted open-model lane (the DeepSeek-class economics without the data terms), multiple languages, public stats page, Frank-cell migration.

---

## 12. Decisions log & remaining opens

**Decided (2026-08-09):** name = `frank.my` working placeholder (final TBD) · no cost display anywhere, product just says free · booking **$300 USD** flat · retention **90 days** · daily budget **$20** with defer-not-degrade quality policy · concurrency **3 free slots**, **$20 USD** unlock for more · pricing kept dynamic by a dedicated **pricing scout** agent · email = **Resend** · chat layer = **our own, chatpack-shaped**, with intake-nudge prompts.

**Decided (2026-08-10):** design = light, minimal, ChatGPT-inspired; near-zero copy with every explanation one tap away (expandable chips/sheets) · **Tip + Book Steven visible on the main page** (app bar) · booking page opens with Steven's pitch — *"AI nerd, career generalist: data science, business, marketing, web dev, app building. The more obscure or interesting the problem, the better"* — then the 4-step process and the three outcomes · growth stays quiet: a **Tell a friend** action (copies the URL) and a *"yours for 90 days · reply anytime"* line; nothing gamified.

**Decided (2026-08-10, later):** answers stay complete and self-contained, then earn repeat use honestly — **Worth asking next** follow-up briefs (one-liner → expand → value line → one-tap ask, always free) · **The bigger picture** card only when a real larger project exists, with equal DIY-free and book-Steven paths · **answer sharing** as the growth engine: owner mints a read-only link ("when you share the link, it's visible to whoever has it"), recipients get the full answer plus *Ask anything — free* · share sheet consolidates answer-link / send-to-Steven / share-the-site. Parked revenue ideas live in §7.2b (standing questions strongest).

**Sign-up: recommended none, ever, for v1.** "No sign-up" is the differentiator, and accounts would create a password-reset expectation that collides head-on with unrecoverable encryption. Everything an account would manage already exists without one: hashed email carries rate limits and the $20 slot unlock (via Stripe webhook), link+PIN carries access, the delete button carries data hygiene, and the browser can remember your threads locally on your own device. If "where are my threads?" ever becomes a real complaint, the escape hatch is a passwordless magic-link page that lists thread links — it never touches decryption, so the privacy story survives intact.

**Still open:**

1. **License:** AGPL-3.0 (recommended) vs MIT — see §10.
2. **Slot-unlock details:** $20 → how many slots (proposed 10)? One-off forever, or annual? (Proposed: one-off.)
3. **Verify OpenAI + Google API data-usage terms** before they enter default routing (Anthropic verified).
4. **The intake-nudge prompt set:** which 3–5 questions pull the most answer-improving context? Worth iterating against real shared threads once they exist.
5. **Final name + domain** — everything brand-touching stays behind one config value until this lands.

---

## 13. What Steven gets to see (metrics, all content-free)

Jobs/day, confirm-through rate, time-to-answer distribution, cost per job (median/p95), model mix and escalation rate, red-team failure rate, deliverability, thread deletions, tips (count/amount), slot unlocks, bookings, share-with-Steven volume. That last one doubles as the product's real quality signal: people share what impressed them. Nothing here requires reading anyone's thread.

---

## Sources (verified 9 Aug 2026)

- Anthropic model & batch pricing, caching multipliers: [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch processing behaviour (24h window, 1h typical, feature support, free failure states): [platform.claude.com/docs/en/build-with-claude/batch-processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- Web search tool pricing ($10/1k, batch-compatible): [platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- Anthropic commercial data policy (no training by default; ZDR exists): [privacy.claude.com — "Is my data used for model training?"](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)
- OpenAI pricing & 50% batch: [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing)
- Gemini pricing & 50% batch: [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- DeepSeek pricing (V4-Flash/Pro; increase flagged): [api-docs.deepseek.com/quick_start/pricing](https://api-docs.deepseek.com/quick_start/pricing)
- chatpack (MIT): [github.com/chddaniel/chatpack](https://github.com/chddaniel/chatpack)
- Frank grounding: `README.md`, `docs/architecture/overview.md`, `docs/adr/ADR-009`, `AGENTS.md` in `C:\Dev\Frank`
