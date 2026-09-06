# Ad Template Generator naming contract

The canonical Frank product label is **Ad Template Generator**. New source uses
`ad_template_generator`, `adTemplateGenerator`, `AD_TEMPLATE_GENERATOR`,
`AdTemplateGenerator`, or `ad-template-generator` according to language and
context. The canonical browser path is `/ad-template-generator`, and the
canonical HTTP API prefix is `/api/ad-template-generator`.

The former `/ad-studio` browser path, `/api/ad-studio` API prefix, and
`frank:ad-studio*` browser events remain accepted aliases so bookmarks and
external callers continue to work during migration. Frank reads Hermes'
`ad_template_generator_capabilities` field first and falls back to the legacy
`ad_studio_capabilities` field.

Do not rename contracts that identify another system rather than this product:
the stored Tool ID `ad-template-generator`, Blockwise `/api/internal/adstudio/*`,
`adstudio.templates*` scopes, `/fonts/adstudio/*`, published Blockwise
`/ad-studio/templates/*` URLs, and the persisted process value `exact-clone`.
Graph node and edge IDs are durable compatibility identifiers; their displayed
labels use the canonical product name while the IDs remain unchanged.
