# Releasing the owner Ads workspace

What happens after the owner approves the front-end, and what to check while it
happens. Everything here has been rehearsed; nothing here has been executed
against production.

## What is being released

`ads-frontend-repair-20260914` (21 commits on top of the reviewed baseline
`9e8c3ae`) adds the owner Ads workspace: the six screens, the shared draft model,
immutable identities, the publishing flow and its queue, the reader contract
`apps/window/owner_ads.py`, and the two acceptance journeys.

The workspace is a **reader with a local queue**. It renders rows a reporting
sync has written — and that sync does not exist yet, so every live reader answers
`501` with a typed not-connected envelope. Nothing in this release connects to
Meta, and the rehearsal switch (`?preview=1` or the Preview button) is the only
way to see it with rows. That is the state the owner approved.

## The merge

Rehearsed as `ads-release-rehearsal` (pushed), a merge of the branch into
`origin/main` (`7f50162` at the time of rehearsal).

- **One conflict**, in `apps/window/DESIGN.md`. Main's paragraph about the owner
  session and native mail is newer than the paragraph the branch had kept, so
  main's text wins and the branch's new `## Ads workspace` section is added after
  it. The sentence claiming `web/ads.css` owns every style was corrected in the
  same resolution, because the operator's controls now live in
  `web/ads-controls.css`.
- Everything else merges automatically; 42 files change.

To redo the merge if `main` has moved:

```bash
cd /projects/frank
git fetch origin main
git worktree add -b ads-release-<date> /projects/frank-worktrees/ads-release-<date> origin/main
cd /projects/frank-worktrees/ads-release-<date>
git merge ads-frontend-repair-20260914      # resolve DESIGN.md as above
```

## Verification on the merged tree

Run before the release, from the merged worktree:

```bash
cd apps/window
node --test tests/ads_identity.test.mjs tests/ads_drafts.test.mjs \
    tests/ads_workspace_contract.test.mjs tests/ads_tracking.test.mjs \
    tests/ads_overview.test.mjs tests/ads_controls.test.mjs   # 124 tests
python3 -m pytest tests/test_owner_ads.py tests/test_owner_workspace.py -q
node --test tests/*.test.mjs                                  # 327 pass, 2 known failures
```

The two known failures are pre-existing and unrelated to this surface:
`tests/graph_client.test.mjs` (no `graphology` in a worktree) and
`tests/owner_dashboard.test.mjs`'s frozen rail allowlist, which fails
identically at `9e8c3ae`.

With an instance built from the merged tree answering on `$BASE`:

```bash
/srv/frank/acceptance-venv/bin/python acceptance/ads_entry_journey.py --base-url "$BASE"
/srv/frank/acceptance-venv/bin/python acceptance/ads_journey.py --root .
```

Last rehearsal: **105/105** and **142/142**.

## The release

Production serves committed `main` through `scripts/vps/product-release.sh`; the
Window is deployed by `apps/window/deploy.sh`, which refuses a non-canonical
repository, refuses an uncommitted tree, builds the image tagged with the source
SHA, and swaps the container.

```bash
# 1. Fast-forward main to the rehearsal merge (or merge it fresh), then:
cd /projects/frank/apps/window
./deploy.sh --revision <merge-commit-sha>
```

Do not deploy from a worktree: `deploy.sh` deliberately refuses anything but
`/projects/frank`.

## After the release

1. **The route is live and honest.** Open `https://frank.fail/project/blockwise/ads`
   in a fresh session: the six screens must render, and with preview off every
   reader must say *Not connected* and name what it needs — no zeros, no
   fixtures.
2. **The reader contract answers.** `curl -s -o /dev/null -w '%{http_code}'
   https://frank.fail/api/owner/ads/context` must be `501` (and `404` for an
   unknown reader), never the single-page HTML.
3. **The journeys pass against production.** Run the entry journey with
   `--base-url https://frank.fail` after establishing an owner session; a
   rehearsal (`?preview=1`) is the only mode that will show rows.
4. **Retire the review instance.** Stop and remove the container
   `frank-window-ads-approval` and delete `/srv/frank/previews/ads-repair-20260914`,
   then point the address it was shared under at the real section.

Rollback is the previous release SHA:

```bash
cd /projects/frank/apps/window
./deploy.sh --revision 7f50162e56c34292ade48df89651ef1adaea2760
```

## What is deliberately not in this release

- Any Meta connection, credential, sync or write. The readers answer `501`.
- Scheduled incremental reporting, adaptive refresh, throttling backoff, asset
  reuse and uncertain-write reconciliation — all of it is described in the
  workspace's own "not yet built" list and in `docs/OWNER_ADS_INTEGRATION.md`.
- Durable server-side drafts: the queue is still `localStorage`, so a staged
  change belongs to one browser. Moving it to authenticated server storage with
  revisions and audit history is the next phase of work and needs no further
  approval to design, but it does change where a draft lives.
