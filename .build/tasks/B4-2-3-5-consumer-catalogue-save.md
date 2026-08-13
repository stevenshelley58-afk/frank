# B4-2 / B4-3 / B4-5 — Consumer boundary · Catalogue · Save

**Depends:** B4-1, F1-2, F1-4 · **Model:** cheap; strong for Save transaction
**Allowed:** `src/lib/frank/**`, `src/app/api/internal/**`, `src/app/api/adstudio/**`, `supabase/migrations/**`
**Forbidden:** editor components, Frank repo

**Law:** Blockwise never calls a Frank database and never generates a template. It imports signed releases and renders them.

---

## B4-2 — Frank consumer boundary

One **server-only** client package. Never importable from a client component — enforce with a lint rule.

State it maintains: local cursor · imported releases · payload hash · import receipt · last successful sync · error state.

- **Feature-flagged off by default.** Each consumer turns on only after its producer passes shadow verification.
- **Serve the last verified import** if Frank is unavailable. A Frank outage must not break a Blockwise page — test with Frank deliberately down.
- Tombstones apply: a withdrawal unpublishes or redirects per an explicit policy, preserving SEO redirects.
- The Frank service token must never reach the browser. Add a bundle scan.

**Done when:** fixture releases import idempotently · a wrong hash fails · tombstones apply · the last good release still serves during a simulated outage · token scan clean.

---

## B4-3 — Template catalogue

```
POST /api/internal/adstudio/template-packs/import
```

Runs the full F1-4 importer check list: signature · 5-minute window · one-use nonce · HTTPS origin and path allowlist · no redirects · size ceiling · traversal and symlink rejection · MIME and magic bytes · schema validation · every asset and font hash · **both layouts rendered as canaries** · supplied previews match deterministic renders.

**Quarantine until every check passes. Activation is atomic.** Identical replay returns the same receipt; same identity with a different hash returns `409`.

Tables: stable templates · immutable template-pack versions · template assets · import receipts and nonces.

**Done when:** a tampered pack is rejected · a zip bomb is rejected before extraction completes · replay is idempotent · conflict returns 409 · no half-imported pack is ever visible to a customer.

---

## B4-5 — Save

The single most correctness-sensitive path in Blockwise. **There is no partial "Feed saved, Story still running" state.**

### Transaction

1. Client submits the complete layered document **plus the expected revision**
2. Server rejects a stale revision
3. Server validates the document against the **pinned** pack
4. Server canonicalises and hashes it
5. Server renders Feed **and** Story
6. Both PNGs upload to temporary workspace-scoped paths
7. Server validates dimensions, MIME and hashes
8. **One transaction** creates the immutable revision and both render receipts
9. The active revision advances **only after both renders succeed**
10. A failed attempt leaves the previous saved revision active
11. Temporary artefacts from failures are cleaned up
12. An unchanged save returns the existing revision and PNG hashes, rendering nothing

### Tables

Customer ads · immutable ad revisions · render attempts and receipts · Instant Form drafts · locked publication snapshots.

**Every workspace-scoped table requires a `workspace_id` filter and RLS.** A missing filter is a test failure.

**Done when:**
- [ ] Concurrent stale save rejected without mutating the active revision
- [ ] Story render failure leaves the previous revision active and no orphan PNG
- [ ] Unchanged save performs zero renders and returns identical hashes
- [ ] Exactly two PNGs exist after a successful save
- [ ] Reload restores full layered state
- [ ] Cross-workspace read and write denied — tested from a second workspace
