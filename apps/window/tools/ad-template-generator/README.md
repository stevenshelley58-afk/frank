# Ad Studio

Ad Studio is a Frank mini app backed by Hermes durable Tool runs. Frank owns source selection, project and job setup, model-policy editing, authoritative history, live monitoring, QA approval, release evidence and downloads. It never starts a Hub chat or inherits the Hub model selector.

Hermes stores the command, immutable model-policy revision, checkpoints and ordered redacted events on the VPS. Device and approved VPS sources are staged briefly, copied into Hermes' private content-addressed asset store, hashed and then removed from Frank staging. Deterministic stages use the installed Ad Template Builder capability and VPS tools; model-capable stages use the run's pinned provider/model chain.

The canonical pipeline is `source → analyse → decompose → restyle → story-draft → render → visual-review → check → subject-invariance → studio-qa → ready → release`. `visual-review` is an explicit bounded loop: each render is assigned a generation number, immutable artifact hash, two independent ad-system likeness scores and a revision reason. Scores below 9.5 return to render; both scores at or above 9.5 advance. Image models are restricted to declared masks. Release requires the numeric gate, all other automated gates, and an operator's 100% zoom confirmation.

Frank shows two views of the same job. The declared lifecycle comes from `manifest.json`; observed activity comes from Hermes' ordered durable events. Frank never creates a second trace store or agent runtime. Every new generation emits `generation-started`, `generation-rendered`, `generation-scored`, then either `generation-revision-requested` or `generation-accepted`, with safe artifact and score metadata. Private prompts, paths and source pixels remain in Hermes.

New releases use the provider-neutral `schema://frank.template-pack/v1` contract documented in `TEMPLATEPACK.md`. The legacy v1 validator remains readable for already-issued historical releases but is not the active pipeline.
