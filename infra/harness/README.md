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
public route. tusd is reachable only through Caddy's authenticated `/v1/uploads/*` route;
the API issues capability credentials and the private HTTPS hook performs scan/promotion.
TLS verification is never disabled. Quarantine scans precede promotion; freshness/readiness
of ClamAV signatures is a hard dependency.

Trust boundary: `frank-harness-model` is LiteLLM/Hermes only. `frank-harness-attachments` is
SeaweedFS/ClamAV/tusd only. The API joins `frank` as the controlled seam. Dashboard OpenFGA
must stay lake-local: it joins neither network and receives no attachment credential. Hermes
has no public port, scheduler, durable/child-agent authority, or Night Watch access.

Promotion is manual: populate a candidate digest only after `cosign verify` and SBOM review,
run the isolated hosted candidate probe, copy the verified manifest to CURRENT, and retain the
previous manifest as ROLLBACK. Revert by restoring the ROLLBACK manifest and recreating only
these services; never delete attachment volumes. Licenses to record per chosen artifact: LiteLLM
MIT, SeaweedFS Apache-2.0, tusd MIT, ClamAV GPL-2.0-only, Goose Apache-2.0, Hermes upstream
license pending review, Letta Apache-2.0. No promotion is automatic.
