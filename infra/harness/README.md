# Harness gateway: candidate → current → rollback

This is an isolated, private overlay. It does not allocate capacity, deploy production, or
alter Graphify. The planned attachment pool is **50 GiB** and promotion refuses a host with
less than **30 GiB free**. Buckets and prefixes are literal:

| bucket | allowed key prefix |
| --- | --- |
| `frank-attachment-staging` | `<cell_id>/<upload_id>/<part-or-object>` |
| `frank-objects` | `sha256/<first-two-hex>/<full-sha256>` |
| `frank-object-previews` | `<object_id>/<variant>/<digest-or-name>` |

`frank-previews` is reserved for preview.frank.fail and is forbidden here. SeaweedFS has no
public route. tusd is reachable only through Caddy's authenticated `/v1/uploads/tus/*` route;
the API issues capability credentials and the private HTTPS hook performs scan/promotion.
TLS verification is never disabled. Quarantine scans precede promotion; freshness/readiness
of ClamAV signatures is a hard dependency.

Trust boundary: `frank-model` is LiteLLM/Hermes plus the API control seam. `frank-attachments` is
SeaweedFS/tusd/ClamAV plus API and narrowly scoped Caddy ingress. The API joins `frank` as the controlled seam. Dashboard OpenFGA
must stay lake-local: it joins neither network and receives no attachment credential. Hermes
has no public port, scheduler, durable/child-agent authority, or Night Watch access.

Bucket bootstrap is a reviewed idempotent one-shot operation using a temporary bucket-admin
credential held outside Compose. It creates the three attachment buckets without enumerating
or changing later lake buckets, and applies a 24h incomplete-upload lifecycle only to staging.
The credential is removed from the bootstrap process; external credential retirement is separately evidenced. The API reserves
2 GiB per file and enforces 10 GiB/10,000 aggregate limits before issuing a capability. That
capability binds owner/cell/conversation/upload and the hook selects the collision-safe key
`<cell_id>/<upload_id>/<part-or-object>`; no deployment-wide S3 key prefix is used.

Goose remains the existing externally managed default source for this release; no unused Goose
image slot is deployed. Frank receives its endpoint/credential policy and an upgrade is a separate
artifact decision. Promotion is manual: populate a candidate digest only after `cosign verify` against
the upstream immutable commit/key, SBOM review, and the LiteLLM security floor (never 1.82.7/1.82.8;
not before 1.83.7),
run the isolated hosted candidate probe, copy the verified manifest to CURRENT, and retain the
previous manifest as ROLLBACK. Revert by restoring the ROLLBACK manifest and recreating only
these services; never delete attachment volumes. Licenses to record per chosen artifact: LiteLLM
MIT, SeaweedFS Apache-2.0, tusd MIT, ClamAV GPL-2.0-only, Goose Apache-2.0, Hermes upstream
license pending review, Letta Apache-2.0. No promotion is automatic.
