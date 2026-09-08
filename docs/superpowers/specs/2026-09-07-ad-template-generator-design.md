> Historical record or proposal. This is not current operating authority.
> Use the [maintained documentation index](../../README.md) before applying commands,
> endpoints, deployment claims or acceptance criteria from this record.

# Reference-to-editable ad template generator

Approved direction: Steven requested implementation using a swarm of Luna agents on 2026-09-07 after reviewing the clean-sheet proposal.

## Outcome

A reference ad becomes a structured editable Blockwise template. Faithful reconstruction and successful replacement of the original content are distinct acceptance criteria. The operator sees upload, generation, comparison, and an explicit edit/approval handoff.

## Preserve and reuse

- Frank is the interface only. Hermes owns authoritative durable jobs, reasoning, retry/checkpoints, and generation.
- Blockwise owns the existing AdTemplate/AdDocument contract, deterministic renderer, editor, immutable ad revisions, and gated publishing.
- Keep existing layered JSON templates, source-filled QA previews, customer-default previews, resume behavior, saved data, and current product approval gates.
- No new graphics SDK, agent runtime, database, flat-image templates, or parallel customer product.
- Existing final-review requirements remain in force; this implementation does not weaken them merely to reduce model calls.

## Canonical rendering

The structured document and immutable template are the source for generation previews, the authoritative editor preview, and saved exports. Reuse the Blockwise server renderer. Browser interaction machinery must not be represented as authoritative final rendering.

Preview requests are authenticated, workspace scoped, bounded, and non-persistent. They resolve images, fonts, colours, crops, and text with the same semantics as save. Superseded requests cannot replace a newer editor preview. Loading or failed renders are explicit, not falsely labelled current. Editing and selection remain usable.

Persist a deterministic template hash alongside each saved revision, using the existing schema column. Do not invent mutable template identities.

## Generation and acceptance

AI emits and repairs the supported structured document, not executable customer-specific code. Retain a source-filled reconstruction and separately prove reusable content replacement. Deterministic checks cover text overflow, asset availability, layout bounds, and the declared input contract before expensive review.

Exercise short and long text, Unicode, optional missing data, supported image shapes/crops, and both existing placements. Failures report concrete fields or layers. Preserve bounded existing repair budgets, best-so-far candidates, and resumable checkpoints; add only missing behavior.

No template is declared successful solely from similarity to the reference. No source screenshot may masquerade as an editable full-template background.

## Operator experience

Keep the established Frank shell and accessibility semantics. Explain the four steps plainly. Distinguish faithful reconstruction from the reusable customer template, including absent evidence. Retain batch generation, history, retries, cancellation, source comparison, and advanced model roles.

Offer a Blockwise edit handoff only when the returned imported template identity supports it. Approve/publish stays explicit; no automatic activation of unapproved templates.

## Verification

Each subsystem gets regression tests for behavior rather than source formatting. Verify preview/export parity using the same document and assets; verify replacement cases and stale-response rejection; verify operator selectors and actual browser interactions. Use existing representative references and bounded real-provider canary work where supported.

Run each changed repository's mandatory checks. Integrate only intended commits atop current upstream, retain current live changes, deploy exact revisions using existing runbooks, and verify live provenance and changed behavior. Record measured results without invented quality or cost claims.

## Ownership and safety

Luna renderer_contract owns Blockwise rendering/editor/provenance work. Luna generator_pipeline owns Hermes generation acceptance. Luna operator_workflow owns Frank UI changes. Root coordinates contracts, acceptance, integration and release.

All project work stays on the VPS. Preserve unrelated edits, user data, workspace isolation, provider restrictions, and recoverable rollback artifacts. No production ad publishing or activation of generated templates is part of this release verification.
