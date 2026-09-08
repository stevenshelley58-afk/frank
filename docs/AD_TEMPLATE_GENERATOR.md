# Ad Template Generator

This is the single maintained cross-system operator guide for Frank, Hermes
and Blockwise template generation. The naming-only contract remains in
[AD_TEMPLATE_GENERATOR_NAMING.md](AD_TEMPLATE_GENERATOR_NAMING.md).
Dated plans, release notes and old builder skills are not alternate procedures.

## Ownership

- Frank supplies the operator interface and forwards commands.
- Hermes executes generation, comparison, revision, final review and durable
  run tracking. Chat model settings do not override a run's frozen routes.
- Blockwise owns the shared template/rendering contract, quarantine import,
  customer editor and separate publishing controls.

## Approved acceptance policy

Steven approved this policy on 8 September 2026:

| Scored section | Minimum |
| --- | --- |
| Geometry (`geometry`) | 9.8 |
| Colour and effects (`colourEffects`) | 9.8 |
| Image crop (`imageCrop`) | 9.8 |
| Typography except exact font family (`typography`) | 9.8 |
| Details (`details`) | 9.8 |

The comparator and both independent final reviewers must each meet every section
minimum. A higher score in one section cannot compensate for a lower score in
another. Exact font-family matching is excluded from scoring because proprietary
or unavailable source fonts may require the closest bundled substitute. Font
substitutions remain recorded evidence. Text sizing, weight, spacing, alignment,
hierarchy and legibility remain part of the typography score.

There is one overall pass/fail check: `noObviousErrors`. It passes only when the
combined review evidence contains no overlap, clipping, missing text or media,
stray glyph, illegible content, unresolved effect mismatch or other immediately
visible production defect. A numeric overall score is not an acceptance gate.

A score alone is not approval. The current requirements also include valid
editable Feed and Story layouts, no unresolved material defects, complete
review evidence, passing reusable-template checks, quarantined import and a
passing smoke check. Explicit operator approval remains separate from generation;
approval does not grant permission for unrelated provider publishing.

Never infer acceptance from an overall score, a missing decision, partial
evidence or a UI fallback. Never overwrite recorded scores to meet this policy.

## Readiness evidence

As observed earlier on 8 September 2026, Hermes release `e691c16a2a` still used
a 9.5 gate while its pinned Blockwise renderer `39e51fed` required review metadata
declaring at least 9.8. That mismatch caused the latest sample to fail final
validation. No recorded run had completed the full successful handoff, and the
first-50 batch had not been started. See the latest deployment evidence below
before treating that dated failure as the current runtime state.

These are dated observations, not permanent current-version claims. Recheck
the live deployment and a real completed run before updating readiness.
Documentation changes do not fix the implementation or establish template quality.

### Deployment evidence, 8 September 2026

The five-section 9.8, exact-font-exempt policy deployed in Hermes
75bd842674a1f677de598f5bd3868645ff856861 with renderer
cbc3f92e061477f5f2162ef816d26e130ec16fcf. Prompt improvements then deployed in
Hermes 502fafe9f8f8262e7c7e5aa68324a33b26eada21 at 04:30:39 UTC, with the same
renderer. Runtime selectors and authenticated health were verified.

The baseline canary reached a comparator pass after 16 comparisons but failed
maximum replacement-text validation before independent final review/import.
The improved-prompt canary failed twice at source analysis with provider HTTP
402, Insufficient Balance, before reaching the changed prompts. No full live
handoff or faster convergence is established. The first-50 batch remains unstarted.
Detailed dated evidence is Hermes docs/ad-template-prompt-review-20260908.md.

## Run control

Use Frank's `/ad-template-generator` page for upload, generation, evidence,
request-changes and approval. The canonical Frank API prefix is
`/api/ad-template-generator`; legacy naming aliases are documented only in the
naming contract. Do not reuse the retired `portrait` placement or old
`/approval` payload: current placements are `feed` and `story`.

Run reads and events use:

- `GET /api/ad-template-generator/runs/{run_id}`
- `GET /api/ad-template-generator/runs/{run_id}/events`
- `GET /api/ad-template-generator/runs/{run_id}/artifacts/{name}`

Hermes owns the underlying `/v1/tool-runs` command API. Its configured gateway
is reachable from the VPS host; verify the current configured endpoint rather
than relying on an old skill's reachability claim. Authentication stays required.
Do not print credential-bearing environment files.

Use the existing controller operations for retries and request-changes. Automatic
retry does not reset comparison budgets. A new directed revision preserves
history and recorded cost; it is not permission to rewrite checkpoints or scores.
Confirm each operation's current payload in its serving contract before sending
it, and reconcile an uncertain result before repeating a write.

A run in `ready_for_review` awaits operator review. Quarantine import, an Edit
handoff, or a `template.ready_for_review` UI event is not approval or publishing.
Only offer Edit when the run contains a valid imported template identity.

## Runtime and release ownership

Frank's current release procedure is
[FRANK_RELEASE_RUNBOOK.md](FRANK_RELEASE_RUNBOOK.md). Blockwise's current
verification and rollback guides are selected by
`/projects/blockwise/docs/README.md`. Do not duplicate either release procedure
in skills.

Hermes generation runs in `hermes-gateway.service`, with the default profile at
`/home/hermes/.hermes`. The gateway's active import path is selected by
`/etc/systemd/system/hermes-gateway.service.d/only-ad-template-process.conf`;
the renderer command selects a separately pinned renderer release. Verify the
running process's path-valued settings, not a repair worktree or an old release
name in a document. Do not dump its full environment.

For a generator release, validate the exact task revision, preserve an online
SQLite backup and the exact gateway override, create an immutable release,
update the existing selector and restart only the owning service. Verify the
settled process import path, authenticated health and real generator behavior.
Preserve current runs, history, frozen routes, budgets and approval controls.
A health response is not a successful template run.

## Component references

Provider qualification remains owned by the Hermes source document
`docs/ad-template-provider-routing.md`. The batch driver and its resume
contract are documented in `docs/ad-template-first50-20260907.md` alongside the
driver in the maintained Hermes source revision. Locate those through the
verified source/release; do not assume a task worktree is a permanent runtime.

Before using the batch, require a genuinely correct live sample to complete the
full handoff under the approved policy. Keep unapproved outputs quarantined.

The same minimums apply at every new import boundary. Existing historical
templates and run evidence remain readable; older scores are not retroactively
promoted to a pass.
