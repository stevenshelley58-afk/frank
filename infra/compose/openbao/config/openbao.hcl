// FRANK machine secrets — OpenBao server configuration (REAL server, not -dev)
//
// Spec: FRANK-§16.2 "Machine secrets | OpenBao | Short-lived, scoped credentials";
//       FRANK-§15.3 (integrated Raft storage, KMS auto-unseal, offline threshold recovery
//       material, bootstrap-token revocation, audit-device continuity); ADR-012.
//
// This server starts SEALED and does nothing useful until the bootstrap in README.md is
// performed. That is intentional: a -dev server keeps its root token and its data in memory
// and would silently satisfy a healthcheck while providing no security at all.
//
// NO KEY MATERIAL IS IN THIS FILE OR ANYWHERE IN THE REPOSITORY.

ui = true

// FRANK-§15.7: unsealed key material must never reach swap. Requires cap_add: IPC_LOCK,
// which docker-compose.yml grants. The container also has memswap_limit == mem_limit, so
// there is no container swap to reach in the first place.
disable_mlock = false

// --- Storage: integrated Raft (FRANK-§15.3, ADR-012) --------------------------------------
// Single node. FRANK is a single private cell (FRANK-§2.4); high availability is the warm
// recovery cell of FRANK-§16.1, not a local Raft quorum on one shared host. The Raft
// snapshot is the unit of protection in FRANK-§16.7 ("Raft snapshot, deletion-protected
// independent auto-unseal KMS, offline recovery material").
storage "raft" {
  path    = "/openbao/data"
  node_id = "frank-cell-openbao-1"

  // Bounded log growth: this shares a disk with six unrelated production projects.
  autopilot_reconcile_interval  = "10s"
  autopilot_update_interval     = "2s"
}

// --- Listener -----------------------------------------------------------------------------
// KNOWN DEVIATION (documented in README, remediation owned by Workstream 3):
// FRANK-§15.6 requires TLS everywhere and mTLS for the secret-broker path. Slice 1 has no
// internal certificate authority yet, so this listener is plaintext and is reachable ONLY
// from the frank-cell-net bridge and from 127.0.0.1 on the host. It has no Caddy route and
// no public DNS. When the internal CA lands, replace tls_disable with tls_cert_file /
// tls_key_file / tls_client_ca_file and set tls_require_and_verify_client_cert = true.
listener "tcp" {
  address         = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_disable     = 1

  // Never let a secret response sit in an intermediary cache.
  custom_response_headers {
    "default" = {
      "Cache-Control"          = ["no-store"],
      "X-Content-Type-Options" = ["nosniff"],
      "Strict-Transport-Security" = ["max-age=31536000; includeSubDomains"]
    }
  }
}

api_addr     = "http://frank-openbao:8200"
cluster_addr = "http://frank-openbao:8201"

// --- Seal ---------------------------------------------------------------------------------
// SHIPPED CONFIGURATION: Shamir. `bao operator init` produces the threshold shares and the
// initial root token; both are handled by the operator per README and neither is stored by
// this stack.
//
// KNOWN DEVIATION (documented in README): FRANK-§15.3 mandates auto-unseal through a
// deletion-protected per-cell KMS or HSM key held in the INDEPENDENT recovery provider
// account, outside the FRANK VPS provider. That account is not provisioned at Slice 1, so
// there is nothing to point at yet. Shamir unseal with offline threshold shares is the
// documented interim, and it is the same threshold scheme FRANK-§15.3 requires Steven to
// hold offline regardless — so no recovery material is thrown away by the later migration.
//
// To adopt auto-unseal, uncomment ONE stanza, then run `bao operator unseal -migrate`
// (see README "Seal migration"). Keep the offline shares: FRANK-§15.3 is explicit that the
// shares do not replace the KMS key and that the plan must cover loss of either dependency.
//
// seal "awskms" {
//   region     = "<recovery-account-region>"
//   kms_key_id = "<deletion-protected per-cell key ARN in the independent account>"
// }
//
// seal "transit" {
//   address         = "https://<recovery-account-openbao>:8200"
//   key_name        = "frank-cell-autounseal"
//   mount_path      = "transit/"
//   tls_ca_cert     = "/openbao/tls/recovery-ca.pem"
//   // token supplied as BAO_TOKEN via the deploy-time secret injection, never committed
// }

// --- Leases: short-lived by default (FRANK-§15.3) -----------------------------------------
// "OpenBao issues short-lived derived credentials where the upstream supports them."
// One hour default, one week ceiling. A credential that outlives a workflow is a finding.
default_lease_ttl = "1h"
max_lease_ttl     = "168h"

// --- Telemetry ------------------------------------------------------------------------------
// FRANK-§16.2 telemetry is OpenTelemetry Collector; Prometheus-format scrape is exposed for
// it on the private network. FRANK-§15.7: telemetry is metadata, never secret content.
telemetry {
  prometheus_retention_time = "24h"
  disable_hostname          = true
}

// --- Logging (FRANK-§2.5: 24-hour, ISO 8601 in logs) ---------------------------------------
log_level         = "info"
log_format        = "json"
log_requests_level = "off"

// --- Behaviour --------------------------------------------------------------------------
// The audit device is NOT declared here on purpose: OpenBao refuses every request when a
// declared audit device cannot be written, and a device declared before `bao operator init`
// would deadlock the first boot. It is enabled as bootstrap step 6 in README, writing to the
// frank-cell-openbao-logs volume, which satisfies the FRANK-§15.3 requirement to prove
// "audit-device continuity" across restart, upgrade and full-cell restore.
disable_clustering       = false
disable_sealwrap         = false
disable_indexing         = false
introspection_endpoint   = false
raw_storage_endpoint     = false
