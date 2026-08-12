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
the API issues capability credentials; its private HTTP hook only validates/enqueues durable processing, and a worker later scans/promotes.
TLS verification is never disabled. Quarantine scans precede promotion; freshness/readiness
of ClamAV signatures is a hard dependency.

Trust boundary: `frank-model` is LiteLLM plus the API control seam. `frank-attachments` is
SeaweedFS/tusd/ClamAV plus API and narrowly scoped Caddy ingress. The API joins `frank` as the controlled seam. Dashboard OpenFGA
must stay lake-local: it joins neither network and receives no attachment credential. Hermes is
a later specialist overlay with separate evidence; it is not part of this four-service packet.

Bucket bootstrap is a reviewed idempotent one-shot operation using a temporary bucket-admin
credential held outside Compose. It creates the three attachment buckets without enumerating
or changing later lake buckets, and applies a 24h object and incomplete-upload lifecycle only to staging.
The credential is removed from the bootstrap process; external credential retirement is separately evidenced. The API reserves
2 GiB per file and enforces 10 GiB/10,000 aggregate limits before issuing a capability. That
capability binds owner/cell/conversation/upload and the hook selects the collision-safe key
`<cell_id>/<upload_id>/<part-or-object>`; no deployment-wide S3 key prefix is used.

Goose remains the existing externally managed default source for this release; no unused Goose
image slot is deployed. Frank receives its endpoint/credential policy and an upgrade is a separate
artifact decision. Promotion is manual: populate a candidate digest only after `cosign verify` against
the upstream immutable commit/key, SBOM review, and the LiteLLM security floor established by
GHSA-r75f-5x8p-qvmc (never 1.82.7/1.82.8; not before 1.83.7). Current candidate starting points
as of 2026-08-11 are LiteLLM v1.96.0, SeaweedFS 4.41, tusd v2.10.0, and ClamAV
1.5.4 (upstream GitHub release `clamav-1.5.4`). Tags are not promotion identities and all candidate digest slots remain blank,
run the isolated hosted candidate probe, copy the verified manifest to CURRENT, and retain the
previous manifest as ROLLBACK. Revert by restoring the ROLLBACK manifest and recreating only
these services; never delete attachment volumes. Licenses to record per chosen artifact: LiteLLM
MIT, SeaweedFS Apache-2.0, tusd MIT, ClamAV GPL-2.0-only, Goose Apache-2.0, Hermes upstream
license pending review, Letta Apache-2.0. No promotion is automatic.

External evidence boundary: Letta v0.16.8 is the reviewed manual-service starting point,
but its exact running OCI digest remains a release blocker until the original VPS exposes
and matches it through `FRANK_LETTA_EXPECTED_IMAGE`; the release runbook then performs a
real private `/v1/health/` probe from `frank-web`. Hermes has no Wave 1 runtime or image slot.
Its v2026.8.3 tag is only a Wave 2 review starting point; exact OCI digest, SBOM, provenance,
configuration, and typed-adapter canary evidence remain intentionally unavailable here.

Promotion evidence is never inferred from `evidence-manifest.schema.json`. A real
secret-free manifest must name exactly LiteLLM v1.96.0, SeaweedFS 4.41, tusd v2.10.0, and
ClamAV 1.5.4 (upstream release `clamav-1.5.4`) and bind each reviewed digest, license, SBOM hash, provenance method,
server command, configuration hash, and hosted canary URL to the exact release commit.
The release validator rejects missing, placeholder, `.invalid`, or candidate/current
mismatches before it renders the enabled Compose unit.
