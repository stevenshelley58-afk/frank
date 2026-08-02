# Repo Reviews — FRANK

Running log of every GitHub repo / OSS project we review for Frank, with a summary and verdict. So Steven can come back to any of these later without re-reading the whole session.

**Convention:** newest review batch at the top. One `##` section per review batch (date + source), one row per repo. Verdicts: 🟢 use now · 🟡 evaluate later · 🔴 skip · ⚪ not relevant to Frank.

---

## 2026-07-31 — GitHub Show report (10 featured + sponsors)

Source: `https://2026-07-31.githubshow.codeshiftagent.com/` · Reviewed in session `@session:default/20260802_132510_8d702d`

| Repo | ★ | What it is | Verdict | Notes for Frank |
|------|---|------------|---------|-----------------|
| **block/buzz** | 19k | Self-hosted team chat where AI agents are signed teammates, not bots. Rust. Hooks into Goose, Codex, Claude Code. | 🟢 already wired | Frank has `adapters/collaboration/buzz/` (relay adapter + verification). Correct approach — use it, don't rebuild. Buzz is the collaboration substrate under Frank (§3.1 of spec). |
| **paperclipai/paperclip** | 75k | Manage AI agents like employees — identities, assignments, audit. TypeScript. 3-person team, 5k open issues. | 🔴 skip (now) | Multi-tenant agent-workforce manager; Frank is single-user. **Revisit if Frank is ever white-labelled for businesses** — Steven flagged this 2026-08-02. At that point Paperclip's identity/assignment/audit model becomes relevant. |
| **stablyai/orca** | 34.5k | Cockpit for running a fleet of coding agents in parallel git worktrees. Phone companion app. | 🟡 evaluate later | For when Frank spawns N coding agents on one project and picks the best result (Steven: "i often want to run multiple agents on 1 project to speed up dev"). Run *under* Frank, not instead of it. Overlaps with Hermes delegation. |
| **NousResearch/hermes-agent** | 223k | General agent with compounding skills + memory. Centre of gravity of the ecosystem. | ⚪ already the substrate | Steven runs this as his daily driver. Nothing to "adopt" — it's the harness Frank's dev work happens inside. |
| **citrolabs/ego-lite** | 6.8k | Browser where agents get their own tabs and inherit your Chrome logins. JS. | 🟡 evaluate later (blocked) | Right model for "Frank drives a browser with real logins" (Plane UI, forms behind auth) — beats headless Puppeteer. **Mac-only as of review**; Frank's VPS is Linux. Dead end until Linux support ships. Steven: "frank will of course need its own browser" — this is the candidate when that day comes. |
| **alibaba/open-code-review** | 16.9k | AI code reviewer battle-tested on Alibaba's engineers for 2 years. Go. Hybrid rules + AI. 74% recall on real PRs. | 🟢 use now | Drop into GitHub Actions on the Frank repo — free line-level PR review on every commit, uses existing AI subscription. Trade-off: ~12% precision = ~1 in 8 comments is noise; Go binary in a TS monorepo. Effort: ~2 hours. |
| **ayghri/i-have-adhd** | 14.5k | One markdown file of output-style rules: lead with the answer, number steps, cap lists at 5, kill preamble/recap. | 🟢 use now | Zero cost. Steal the rules into Frank's system prompt — literally how Steven wants answers. Effort: 10 min. |
| **pascalorg/editor** | 20.4k | Free browser-based 3D building editor. React Three Fiber + WebGPU. | ⚪ not relevant | Nothing to do with Frank. |
| **virgiliojr94/book-to-skill** | 14.1k | Point at a PDF/EPUB/folder → distils into an agent skill with per-chapter lazy loading. | 🟢 use now | Point at `FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md` → lazy-loaded per-chapter skill instead of paying full-context tokens every time an agent touches the spec. Trade-off: built for Claude Code / Copilot skill format; needs a thin converter. Effort: ~1 hour. |
| **1jehuang/jcode** | 14.4k | Rust coding agent: 14ms start, 28MB RAM, semantic vector memory on every turn, swarm mode. | 🔴 skip (steal the idea) | Was evaluated as agent harness, **dropped for Goose** (see `references/jcode-harness-research.md`). **Revisit if Frank is white-labelled** — Steven flagged 2026-08-02: speed matters at scale, 14ms/28MB is a different league. Steal the "embed every turn" memory idea regardless. |
| **mattpocock/skills** | 197k | `/grill-me`, `/tdd`, `/diagnosing-bugs` — engineering discipline as installable agent skills. | 🟢 use now | Frank has grilling already; doesn't have a formalised TDD loop or structured debug protocol. Distil the *discipline* into Frank's skill format (not copy files). Effort: ~30 min. |
| **pingdotgg/t3code** | 16k | One app to run every coding agent on your machine, controllable from your phone. MIT. Android app. | 🟡 evaluate later | For steering Frank's coding-agent layer from the Pixel 10. Trade-off: controls *coding agents*, not Frank — Frank would need a compatible interface, or T3 stays for the coding layer while Frank's own mobile story matures. Steven: "can we use frank to control t3 instead of writing our own" — yes, that's the right framing. |
| **koala73/worldmonitor** | 77k | Global situation-room dashboard. 500+ feeds, 3D globe. | ⚪ not relevant | Cool, irrelevant to Frank. |
| 🤝 **Zapier MCP** *(sponsor)* | — | 8,000+ tools behind one MCP endpoint. Gmail, Calendar, Asana, Notion. No code. | 🟢 use now (biggest win) | Collapses the Gmail/Calendar/Tasks integration roadmap from "build 3 adapters" to "paste one URL" — handles auth, rate limits, token refresh. Trade-off: external dependency + per-task cost; if Frank is high-frequency (hundreds of cal writes/day), keep those as first-party adapters and use Zapier for the long tail. Effort: ~1 day to wire into Frank's tool layer. |

### Overlap audit — what Frank built vs. what already existed

| Frank component | Already existed? | Verdict |
|-----------------|------------------|---------|
| `@frank/memory` (MemoryProvider + mem0 backend) | mem0 itself; jcode's vector memory; Hermes' memory | **Justified** — thin glue making mem0 swappable + enforcing "memory is evidence, not instructions" (§2.3). Nobody else does that. |
| `@frank/identity` (signed sessions, roles) | Paperclip, Buzz (multi-tenant) | **Justified, keep small** — Frank needs "1 agent, 1 human, signed provenance," not a directory service. |
| `@frank/policy` (signed envelopes, conformance) | Nothing on this list | **Genuine invention** — Frank's differentiator. |
| `adapters/storage/postgres` (audit chain, blind indexes, envelope encryption) | Nothing on this list | **Genuine invention** — not something you can `npm install`. |
| `adapters/collaboration/buzz` | Buzz | **Correct** — adapter, not rebuild. ✓ |
| `adapters/harness/goose` | Goose | **Correct** — adapter, not rebuild. ✓ |

**Bottom line:** Frank didn't reinvent much. The custom-built parts (policy, provenance, audit, memory-as-evidence) are exactly the parts nobody else has. Everything that overlaps is already wired as an adapter, which is right.

---

## Template for future reviews

```
## YYYY-MM-DD — <source / topic>

Source: <URL or session link> · Reviewed in session `@session:default/<id>`

| Repo | ★ | What it is | Verdict | Notes for Frank |
|------|---|------------|---------|-----------------|
| **owner/name** | Nk | One-line description. | 🟢/🟡/🔴/⚪ | Why it matters (or doesn't) for Frank. Effort if actionable. Revisit triggers. |
```
