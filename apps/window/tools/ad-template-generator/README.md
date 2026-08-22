# Ad Studio

Ad Studio is a Frank mini app backed by Hermes durable Tool runs. Frank owns source selection, project and job setup, model-policy editing, authoritative history, live monitoring, QA approval, release evidence and downloads. It never starts a Hub chat or inherits the Hub model selector.

Hermes stores the command, immutable model-policy revision, checkpoints and ordered redacted events on the VPS. Device and approved VPS sources are staged briefly, copied into Hermes' private content-addressed asset store, hashed and then removed from Frank staging. Deterministic stages use the installed Ad Template Builder capability and VPS tools; model-capable stages use the run's pinned provider/model chain.

The canonical pipeline is `source → analyse → decompose → restyle → story-draft → check → subject-invariance → studio-qa → ready → release`. Image models are restricted to declared masks. Release requires all automated gates plus an operator's 100% zoom confirmation.

New releases use the provider-neutral `schema://frank.template-pack/v1` contract documented in `TEMPLATEPACK.md`. The legacy v1 validator remains readable for already-issued historical releases but is not the active pipeline.
