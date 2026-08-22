# Portable TemplatePack v1

TemplatePack is a provider-neutral, immutable release. A consumer verifies the SHA-256 checksum and Ed25519 signature, validates `template-pack.schema.json`, then imports the layered document, placement layouts, assets, editable fields, copy, CTA, destination and lead-form contracts.

The pack is sufficient to render, edit, validate and prepare an ad without Frank or access to the original image. It deliberately excludes raw sources, replaceable source-photo pixels, advertiser identity, prompts, credentials, reviewer identity, temporary URLs, mutable drafts and internal paths.

Consumers should reject a pack when its version or compatibility declaration is unsupported, its integrity check fails, any QA gate is false, 100% zoom approval is absent, or a referenced asset hash is missing. `reference_consumer.py` shows the minimum import behaviour; `blockwise_adapter.py` shows the Blockwise mapping.
