# FRANK — Slice 1 cell infrastructure

Docker Compose package for FRANK's control and data plane, per **FRANK-§16.1**
("Docker Compose is the preferred package for each stable service node").

This directory stands up the *infrastructure* of the cell only: the canonical database,
cache, event transport, durable workflow engine, identity, machine secrets, object storage
and the edge. The FRANK web app, domain API and control-plane workers are application code
and join this stack from their own deployment; they are not started here.

Authority for everything below: `../../docs/product/FRANK_COMPLETE_BUILD_PLAN_AND_SPEC.md`
and `../environments/production.env.yaml` / `../environments/local.env.yaml`.

---

## 0. The host — read this first

The target is **not a dedicated VPS**. It is a shared Ubuntu 24.04 box, 8 vCPU / 31 GB RAM
(~25 GB available) / ~191 GB free disk, already running **six unrelated production
projects** — `blockwise`, `draftcheck-wa-v3`, `coolify`, `cuz`, `elfandwonder`,
`character-generator` — with roughly 20 live containers.

FRANK-§16.6 says *"Deployment discovery records the actual host before provisioning."* This
is that record, and it drives five hard rules that this package enforces:

| # | Rule | How it is enforced |
|---|---|---|
| 1 | FRANK never binds port 80 or 443. They belong to `blockwise-caddy` and `draftcheck-wa-v3-internal_caddy-1`. | FRANK's Caddy runs `auto_https off` and publishes one configurable high port. The existing host edge forwards `frank.fail` to it (§4 below). |
| 2 | Every published port binds `127.0.0.1` only. | Hard-coded in `docker-compose.yml`; `preflight.sh` re-checks the rendered config and fails on any other bind. Satisfies FRANK-§15.6 and the Slice 1 exit gate "a public port scan exposes only intended edge services". |
| 3 | Every service has a hard `mem_limit`, `memswap_limit` and `cpus` cap. | See the allocation table in §2. FRANK cannot OOM the other six projects. |
| 4 | Everything is namespaced `frank-cell-`. | Project `frank-cell`, containers `frank-cell-*`, volumes `frank-cell-*`, network `frank-cell-net`, bridge `frank-cell0`. The retired deployment used `frank-hub`; **nothing here reuses that prefix**, so teardown is never ambiguous (FRANK-§16.3.1 step 2). |
| 5 | Nothing assumes `/dev/kvm`. | There is none on this host. FRANK-§16.6 is explicit that the control VPS runs no untrusted build microVM anyway; untrusted execution belongs to the separate execution worker (FRANK-§15.4). |

---

## 1. What each service is for

| Container | Image | FRANK-§16.2 role | Why it is here |
|---|---|---|---|
| `frank-cell-postgres` | `pgvector/pgvector:0.8.0-pg17` | **Canonical database** — "PostgreSQL. Extensions limited and pinned; pgvector for baseline semantic index" | The only canonical store. FRANK domain state, the transactional outbox (ADR-004), the audit chain and the action ledger. Also hosts Temporal's and Authentik's **separate** databases with separate roles. pgvector is the FRANK-§16.2 knowledge-projection baseline; no graph engine is promoted before eval. |
| `frank-cell-valkey` | `valkey/valkey:8.1.1-alpine` | **Cache and ephemeral coordination** — "Open, replaceable, and never canonical" | Sessions, rate-limit counters, short-lived coordination. FRANK-§16.7 classes it as discardable and rebuildable from the outbox, so it persists nothing and evicts under pressure. |
| `frank-cell-nats` | `nats:2.11.4-alpine` | **Event transport** — "NATS JetStream. Outbox remains durability anchor" | Delivery and replay of FRANK-§6.7 event envelopes. Durability still belongs to the PostgreSQL outbox, which is why the JetStream store is hard-capped. |
| `frank-cell-temporal` | `temporalio/auto-setup:1.27.2` | **Durable workflows** — "Temporal. Separate database and worker processes" | FRANK-§13.1 / ADR-005 durable run state, retries, signals, timers, compensation. Gets `frank_temporal` + `frank_temporal_visibility`, its own role, and no `CREATEDB`. Worker processes are application code and are deliberately not in this file. |
| `frank-cell-temporal-ui` | `temporalio/ui:2.34.0` | operator console | **`admin` profile, off by default.** FRANK-§16.3: admin consoles are private-network only and get no public DNS. Loopback port, no Caddy route. |
| `frank-cell-authentik-server` | `ghcr.io/goauthentik/server:2025.6.4` | **Identity** — "Authentik through OIDC. Passkeys/WebAuthn MFA, separate workload identities" | The FRANK-§15.2 identity service: passkeys, phishing-resistant MFA, short-lived sessions, device/session inventory, workload identities. Served at `auth.<domain>`. |
| `frank-cell-authentik-worker` | same image | identity background work | Migrations, outposts, policy evaluation, scheduled identity tasks. |
| `frank-cell-authentik-redis` | `valkey/valkey:8.1.1-alpine` | identity dependency | **Separate from `frank-valkey` on purpose** — see §7 "Judgment calls". |
| `frank-cell-openbao` | `openbao/openbao:2.3.1` | **Machine secrets** — "OpenBao. Short-lived, scoped credentials" | FRANK-§15.3 / ADR-012. Real server with integrated Raft storage, **not** `-dev`. Starts sealed and does nothing until bootstrapped (§5). Agents get opaque handles; raw secrets never reach a model, log, trace, event or artifact. |
| `frank-cell-seaweedfs` | `chrislusf/seaweedfs:3.80` | **Object storage** — "SeaweedFS S3 API, behind the `ObjectStore` contract" | Immutable sources, artifacts, evidence and media behind the FRANK-§6.13 `ObjectStore` contract. Private network only. Off-cell replication to an independent provider is FRANK-§16.7 / Slice 8 and is not wired here. |
| `frank-cell-caddy` | `caddy:2.10.0-alpine` | **Reverse proxy** — "Caddy. Automatic TLS, secure headers, streaming, rate-limit integration" | The FRANK-§16.3 domain map, security headers, streaming, private-network-only admin paths. TLS is the host edge's job here (§4). |

**Not in this file, and why**

| Service | Where it goes |
|---|---|
| Web (Next.js), domain API (Fastify), control-plane workers | FRANK application code; joins `frank-cell-net` from its own deployment. Caddy already routes to `frank-web:3000` / `frank-api:3001`. |
| Model gateway (LiteLLM), knowledge projection workers | Slice 2 / Slice 3. |
| Untrusted execution, preview hosting | FRANK-§15.4 / §16.1: a **separate execution worker**, never the control plane. No `/dev/kvm` here regardless. |
| Buzz relay | Slice 6 (ADR-011). `rooms.` is routed and returns a documented 503. |
| OpenTelemetry, Prometheus, Loki, Tempo, Grafana | FRANK-§16.6 gives observability its own 6 GB envelope, which does not fit inside this host's ~11 GiB ceiling alongside the canonical stores. It lands with Workstream 3's telemetry work, and FRANK-§16.6 requires it to be sized by measurement first. |
| Langfuse | FRANK-§16.6 forbids it on the control node outright: "Langfuse is not admitted to the 64 GB control VPS." |

---

## 2. Memory allocation and its FRANK-§16.6 mapping

### 2.1 The problem

FRANK-§16.6's envelopes assume a **dedicated 8 vCPU / 64 GB** box: 8 GB reserved for the OS
and 56 GB committed across ten envelopes. This host has 31 GB total, ~25 GB available, and
six other production systems on it. The envelopes cannot be applied literally.

### 2.2 How the scale factor was derived

This compose file covers exactly four of FRANK-§16.6's ten envelopes:

| FRANK-§16.6 envelope | Reference (64 GB box) | Covered here? |
|---|---:|---|
| PostgreSQL | 8 GB | yes |
| Workflow / event / cache | 5 GB | yes |
| Identity / secrets / edge | 3 GB | yes |
| Object services | 2 GB | yes |
| Web / API | 4 GB | no — application deployment |
| Buzz | 4 GB | no — Slice 6 |
| Model / memory services | 6 GB | no — Slice 2/3 |
| Observability | 6 GB | no — Workstream 3 |
| Control-plane workers | 8 GB | no — application deployment |
| **Uncommitted reserve** | **10 GB** | proportional share only |

Covered envelopes are **18 GB of the 46 GB committed** (56 GB total − 10 GB reserve) =
**39.1%**. Their proportional share of the 10 GB reserve is 3.91 GB, so the comparable
FRANK-§16.6 total is **21.91 GB**. Scaling that to an **11 GiB (11264 MiB) ceiling** gives a
factor of **0.502**.

### 2.3 Per-service allocation

| Service | `mem_limit` | `cpus` | `oom_score_adj` | §16.6 envelope | Note |
|---|---:|---:|---:|---|---|
| `frank-cell-postgres` | **4096 MiB** | 2.0 | **−900** | PostgreSQL | `shared_buffers` 1 GiB, `effective_cache_size` 2.5 GiB, `work_mem` 12 MiB, 120 connections. Worst realistic peak ≈ 3.4 GiB. |
| `frank-cell-temporal` | 1024 MiB | 1.0 | **−800** | workflow / event / cache | History cache sized down from Temporal's dedicated-node defaults in `temporal/dynamicconfig/frank.yaml`. |
| `frank-cell-valkey` | 512 MiB | 0.5 | **+300** | workflow / event / cache | `maxmemory` 384 MiB, `allkeys-lru`, no persistence. |
| `frank-cell-nats` | 512 MiB | 0.5 | −500 | workflow / event / cache | JetStream memory store capped at 256 MiB, file store at 4 GiB. |
| `frank-cell-temporal-ui` | 256 MiB | 0.25 | **+500** | workflow / event / cache | `admin` profile; not running by default. |
| `frank-cell-authentik-server` | 1024 MiB | 1.0 | **−800** | identity / secrets / edge | 2 gunicorn workers × 2 threads. |
| `frank-cell-authentik-worker` | 768 MiB | 0.75 | −700 | identity / secrets / edge | |
| `frank-cell-authentik-redis` | 192 MiB | 0.25 | −700 | identity / secrets / edge | `maxmemory` 128 MiB, `noeviction`. |
| `frank-cell-openbao` | 384 MiB | 0.5 | **−900** | identity / secrets / edge | Raft on a single node; `mlock` on, no swap. |
| `frank-cell-caddy` | 256 MiB | 0.5 | −400 | identity / secrets / edge | |
| `frank-cell-seaweedfs` | 1024 MiB | 0.75 | −600 | object services | Master + volume + filer + S3 in one process. |
| **Total (always on)** | **9792 MiB** | | | | |
| **Total (with `admin` profile)** | **10048 MiB** | | | | |
| **Uncommitted reserve** | **1216 MiB** | | | uncommitted reserve | |
| **Ceiling** | **11264 MiB (11 GiB)** | | | | ≈ 44% of host RAM; leaves ~14 GiB for the six other projects. |

### 2.4 Envelope-by-envelope mapping (this is the number that matters)

| FRANK-§16.6 envelope | §16.6 proportional target at 11 GiB | Actually allocated | Δ | Why |
|---|---:|---:|---:|---|
| PostgreSQL | 4113 MiB | 4096 MiB | −17 | On proportion. Rounded to a clean 4 GiB so the `postgresql.conf` arithmetic is checkable. |
| Workflow / event / cache | 2570 MiB | 2304 MiB | −266 | Under-drawn on purpose. No control-plane workers exist yet, so Temporal's real load is a fraction of what the envelope assumes. The difference funds identity. |
| Identity / secrets / edge | 1542 MiB | 2624 MiB | **+1082** | **Over-drawn on purpose.** Authentik's memory is a *fixed floor*, not a load-proportional cost: a server + worker pair does not run in 1.5 GiB no matter how small the cell is. FRANK-§16.6's own priority rule ("identity … cannot be OOM-evicted") makes under-funding it the worse error. |
| Object services | 1028 MiB | 1024 MiB | −4 | On proportion. |
| Uncommitted reserve | 2010 MiB | 1216 MiB | −794 | The remaining cost of the identity floor. The reserve is 10.8% of the ceiling against FRANK-§16.6's proportional 17.8% — thinner, and recorded as such. |

**The allocation method is: fixed floors first, elastic remainder scaled proportionally.**
A flat 0.502 across every service would have produced an Authentik that cannot start, which
is not a faithful application of FRANK-§16.6 — it is a literal one.

### 2.5 The FRANK-§16.6 priority rule

> *"PostgreSQL, identity, workflow, and secret services have priority and cannot be
> OOM-evicted by ingestion, indexing, telemetry, or model work."*

Implemented with `oom_score_adj`, which is what the kernel OOM killer actually consults:

- **−900** PostgreSQL, OpenBao — canonical data and secret root.
- **−800** Authentik server, Temporal — identity and workflow.
- **−700** Authentik worker, Authentik Redis — identity dependencies.
- **−600** SeaweedFS — FRANK-§16.7 makes object storage a canonical store ("canonical
  sources and evidence"), so it joins the protected set even though §16.6's priority
  sentence does not name it.
- **−500 / −400** NATS, Caddy — rebuildable transport and the edge.
- **+300 / +500** Valkey, Temporal UI — **the first things to die.** FRANK-§16.7 says the
  cache "may be discarded"; the UI is operator convenience. If this box is ever under
  memory pressure, these are the correct casualties.

`memswap_limit` equals `mem_limit` on every service, so **no FRANK container can swap**. A
swapping container on a shared box degrades everyone's I/O; a killed one degrades only FRANK.

Negative `oom_score_adj` requires the daemon to be privileged, which it is. `preflight.sh`
checks that the cgroup memory controller is present, because without it every limit above is
silently ignored.

### 2.6 CPU

The host has 8 vCPU and FRANK-§16.6 reserves 15% for the OS, leaving ~6.8. The per-service
`cpus` values are **hard quotas** and deliberately sum to more than 6.8 (7.75, or 8.0 with
the admin profile): they are burst ceilings, so an idle box can be used, while no single
service can monopolise it. The worst realistic concurrent case — Postgres 2.0 + Temporal 1.0
+ Authentik 1.75 = 4.75 — sits inside the FRANK share.

### 2.7 Disk

FRANK-§16.6's disk quotas assume 400 GB. Scaling the four relevant classes to a **60 GiB**
FRANK budget out of ~191 GiB free (factor 0.197):

| FRANK-§16.6 class | Reference | FRANK budget | Enforcement |
|---|---:|---:|---|
| Canonical database | 80 GB | 16 GiB | **Monitored.** The `local` volume driver has no quota. `max_wal_size = 2GB` bounds WAL. |
| Objects | 180 GB | 35 GiB | **Monitored**, with a 1 GiB per-volume ceiling so compaction stays inside the host's I/O budget. |
| Workflow / event stores | 25 GB | 5 GiB | **Enforced** — JetStream `max_file_store` 4 GiB. |
| Images / caches | 20 GB | 4 GiB | **Monitored.** |
| Container logs | — | 300 MiB | **Enforced** — `json-file`, 10 MiB × 3 × 10 services. |

FRANK-§16.6 lifecycle thresholds against the 60 GiB budget: **alert 39 GiB (65%)**,
**throttle 45 GiB (75%)**, **contain 51 GiB (85%)**. `preflight.sh` applies the same 65/75/85
thresholds to the filesystem itself before deploy.

---

## 3. Bringing the cell up

### 3.1 Prerequisites

```bash
cd infra/compose

# 1. Configuration. Never commit .env.
cp .env.example .env
chmod 600 .env

# 2. Generate every secret. The generator command is in the header of .env.example.
#    Nothing is auto-generated for you: FRANK-§15.3 requires secrets created at deploy time
#    and held outside the repository.
$EDITOR .env

# 3. Read-only preflight. Exits non-zero on any blocker.
./preflight.sh
```

**Validating the compose file without any secrets.** Every credential in `docker-compose.yml`
uses the `${VAR:?message}` form, so the stack **cannot be rendered or started with a missing
or empty secret** — `docker compose config` with no `.env` fails closed and names each one.
That is the intended behaviour, not a defect. To syntax-check the file on a machine that has
no secrets (CI, a review box):

```bash
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
sed 's/^\(FRANK_[A-Z0-9_]*\)=$/\1=validate-placeholder/' .env.example > "$tmp"
docker compose -f docker-compose.yml --env-file "$tmp" --profile admin config -q && echo "compose file is valid"
```

`preflight.sh` runs this automatically when no `.env` is present.

`preflight.sh` checks tooling and versions, that the compose file renders, secret hygiene
(present, unique, mode 0600, untracked), that FRANK's ports are free, that **80/443 are held
by someone else** (they must be — FRANK depends on that edge), that no `frank-cell` resource
already exists, that the chosen subnet does not overlap another project's network, memory
and disk headroom, cgroup memory-controller availability, and that every mounted config file
exists. It never writes anything.

### 3.2 Pin images to digests before the first production deploy

FRANK-§15.8: *"Never use `latest` container tags in production"* — no tag here is `latest` —
and *"Pin packages, actions, containers … verify signatures and checksums."* Exact version
tags are the committed state; resolve them to digests before production:

```bash
docker compose -f docker-compose.yml --profile admin config --images | sort -u | while read -r img; do
  docker pull -q "$img" >/dev/null
  printf '%-45s %s\n' "$img" "$(docker image inspect --format '{{index .RepoDigests 0}}' "$img")"
done
```

Replace each `image:` value with the `repo@sha256:…` form it prints, and record the mapping
in the release evidence pack (FRANK-§18.2 release identity, FRANK-§16.7 recovery manifest
"image digests").

### 3.3 Start

```bash
# Core cell. Ordering is handled by depends_on: condition: service_healthy.
docker compose up -d

# Watch until every service is healthy (Temporal takes ~2 min on first run: it creates its
# schema; Authentik takes ~3 min: it runs its migrations).
watch docker compose ps

# Operator console, only when you need it (loopback, no public route):
docker compose --profile admin up -d frank-temporal-ui
```

Start order, enforced by health conditions:

```
frank-postgres ─┬─> frank-temporal
                └─> frank-authentik-server ──> frank-caddy
frank-authentik-redis ──┘
frank-valkey / frank-nats / frank-openbao / frank-seaweedfs   (independent)
```

### 3.4 Verify

```bash
docker compose ps                          # every service: healthy
curl -s http://127.0.0.1:8443/healthz      # -> ok
curl -si -H 'Host: auth.frank.fail' http://127.0.0.1:8443/ | head -20   # Authentik + headers

# FRANK-§15.6 / Slice 1 exit gate: nothing of FRANK's is publicly bound.
ss -ltn | grep -E ':(8443|48200|48088)\b'  # every line must show 127.0.0.1
```

Then complete the two bootstraps below — the cell is not usable until they are done.

---

## 4. Wiring the host edge to FRANK's Caddy

**Do not modify any existing project's configuration as part of deploying FRANK.** The
snippets below are the handoff contract; applying one is a separate, deliberate change to
whichever project owns the edge, made by its owner.

`frank.fail` resolves to this host. Port 443 is terminated by an existing edge. FRANK's Caddy
listens on `127.0.0.1:8443` and speaks plain HTTP, routing by `Host`.

### 4.1 The reachability constraint (read before choosing)

A port published to `127.0.0.1` is reachable **from the host's loopback only**. Other
containers cannot reach it over the Docker bridge — `host.docker.internal` and the bridge
gateway both resolve to the host's *bridge* address, not its loopback. So the option you pick
depends on how the existing edge runs.

### 4.2 Option A — the existing edge is host-networked (simplest)

Add to the existing Caddy's config:

```caddyfile
frank.fail, api.frank.fail, auth.frank.fail,
rooms.frank.fail, hooks.frank.fail, status.frank.fail {
	reverse_proxy 127.0.0.1:8443 {
		header_up Host {host}
		header_up X-Forwarded-Proto https
		header_up X-Real-IP {remote_host}
	}
}
```

`Host` must be preserved — FRANK's Caddy routes entirely on it. `X-Forwarded-Proto https` is
what makes Authentik mint `https` OIDC redirect URIs and `Secure` cookies over a plaintext
hop.

### 4.3 Option B — the existing edge is containerised (expected here)

Add a loopback relay on the host so the bridge can reach FRANK's loopback port, without FRANK
ever binding a routable interface. `172.17.0.1` is the Docker bridge gateway: reachable from
containers and from the host, and **not routable from off-box**, so a public port scan still
sees nothing.

`/etc/systemd/system/frank-edge-relay.socket`:

```ini
[Unit]
Description=FRANK edge relay socket (docker bridge -> FRANK Caddy on loopback)
After=docker.service
Requires=docker.service

[Socket]
ListenStream=172.17.0.1:8443
BindIPv6Only=ipv6-only

[Install]
WantedBy=sockets.target
```

`/etc/systemd/system/frank-edge-relay.service`:

```ini
[Unit]
Description=FRANK edge relay
Requires=frank-edge-relay.socket
After=frank-edge-relay.socket

[Service]
ExecStart=/lib/systemd/systemd-socket-proxyd 127.0.0.1:8443
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now frank-edge-relay.socket
```

Then, in the existing edge container's config, proxy to `172.17.0.1:8443` with the same
`header_up` lines as Option A. Confirm `172.17.0.1` is really the bridge gateway on this box:

```bash
docker network inspect bridge -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}'
```

### 4.4 Option C — attach the existing edge container to `frank-cell-net`

Add `frank-cell-net` (as an `external` network) to the edge container and proxy directly to
`frank-cell-caddy:8443`. Simplest to write, but it gives that container L3 reach to FRANK's
whole cell subnet, which weakens the FRANK-§2.4 / §15.6 isolation this package is built
around. **Prefer A or B.** If you take C, record it as an accepted deviation.

### 4.5 nginx form of the same handoff

```nginx
location / {
    proxy_pass http://127.0.0.1:8443;   # or 172.17.0.1:8443 with the relay above
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_http_version 1.1;
    proxy_buffering     off;            # FRANK-§16.2 streaming
    proxy_read_timeout  3600s;
    client_max_body_size 25m;
}
```

### 4.6 What the host edge must NOT do

- Do not strip or rewrite `Host`.
- Do not add its own security headers on FRANK's hostnames — FRANK's Caddy sets a per-host
  CSP and duplicate headers are a hard-to-debug policy conflict.
- Do not buffer responses: FRANK-§16.2 requires streaming for SSE and agent token streams.
- Do not expose `frank-cell` DNS names publicly. Admin consoles are private-network only
  (FRANK-§16.3), and this package gives them no route at all.

---

## 5. OpenBao bootstrap and unseal (FRANK-§15.3, ADR-012)

OpenBao runs as a **real server with integrated Raft storage**, not `-dev`. It starts
**sealed** and is useless until initialised. Its healthcheck deliberately treats *sealed* as
healthy — a sealed vault is an operator task, not a crash-loop.

**No key material is produced, stored or committed by this stack.** Everything below is done
by hand, once, by the operator.

```bash
export BAO_ADDR="http://127.0.0.1:${FRANK_OPENBAO_PORT:-48200}"
```

### Step 1 — Initialise with a threshold scheme

```bash
docker compose exec frank-openbao bao operator init -key-shares=5 -key-threshold=3
```

This prints **five unseal key shares and one root token, exactly once**. FRANK-§15.3:
*"Steven holds offline OpenBao recovery material using a tested threshold scheme split
across separate physical or password-manager locations."*

- Write each share to a **separate** location — password manager entries in different vaults,
  and/or paper in different physical places. Never all five in one place. Never in this
  repository, in `.env`, in a chat, or on the shared host's disk.
- Any three shares reconstruct the key. Losing three shares loses the cell's secrets
  permanently; there is no vendor recovery.

### Step 2 — Unseal (three shares, one at a time)

```bash
docker compose exec frank-openbao bao operator unseal   # repeat 3x, one share each
docker compose exec frank-openbao bao status            # Sealed: false
```

**This is required after every restart** while Shamir unseal is in use — including a host
reboot. Until auto-unseal is configured (step 7), a reboot leaves FRANK's secret store
sealed and any workload that needs a credential will fail closed. That is the correct
failure mode, but it must be on the runbook.

### Step 3 — Log in with the root token

```bash
docker compose exec -e BAO_TOKEN=<root-token> frank-openbao bao status
```

### Step 4 — Enable the KV engine for cell secrets

```bash
docker compose exec -e BAO_TOKEN=<root-token> frank-openbao \
  bao secrets enable -path=frank -version=2 kv
```

### Step 5 — Create narrowly scoped policies (FRANK-§15.3)

*"The bootstrap root token is revoked after narrowly scoped administration identities are
created, and normal workloads authenticate with audience-bound machine identity."*
One policy per workload, read-only on its own prefix. For example:

```bash
docker compose exec -i -e BAO_TOKEN=<root-token> frank-openbao \
  bao policy write frank-api - <<'EOF'
path "frank/data/api/*"     { capabilities = ["read"] }
path "frank/metadata/api/*" { capabilities = ["list", "read"] }
EOF
```

### Step 6 — Enable the audit device

```bash
docker compose exec -e BAO_TOKEN=<root-token> frank-openbao \
  bao audit enable file file_path=/openbao/logs/audit.log
```

Deliberately **not** declared in `openbao.hcl`: OpenBao refuses every request when a declared
audit device cannot be written, so declaring one before `init` deadlocks the first boot.
Enabling it here satisfies FRANK-§15.3's requirement to prove *audit-device continuity*
across restart, upgrade and full-cell restore. The device writes to the
`frank-cell-openbao-logs` volume.

### Step 7 — Migrate to KMS auto-unseal (when the recovery account exists)

FRANK-§15.3 mandates auto-unseal through a **deletion-protected per-cell KMS or HSM key in
the independent recovery provider account**, outside the FRANK VPS provider. That account
does not exist at Slice 1, so Shamir is the documented interim. When it does:

1. uncomment the `seal "awskms"` or `seal "transit"` stanza in `openbao/config/openbao.hcl`
   and fill in the key reference;
2. `docker compose up -d frank-openbao`;
3. `bao operator unseal -migrate` with the threshold shares;
4. verify `bao status` shows the new seal type and `Sealed: false` after a full restart;
5. **keep the offline shares.** FRANK-§15.3 is explicit that the shares do not replace the
   KMS key, and that the plan must cover loss of *either* dependency.

### Step 8 — Revoke the root token

```bash
docker compose exec -e BAO_TOKEN=<root-token> frank-openbao bao token revoke -self
```

FRANK-§15.3: the bootstrap identity is time-limited and the root token is revoked once
scoped administration identities exist. Leaving it alive is a finding.

### Step 9 — Snapshot

```bash
docker compose exec -e BAO_TOKEN=<admin-token> frank-openbao \
  bao operator raft snapshot save /openbao/logs/bootstrap.snap
```

Copy it **off this host** and delete the local copy. FRANK-§16.7 protects OpenBao with a Raft
snapshot plus the deletion-protected KMS and offline recovery material.

### Every restart must prove

FRANK-§15.3: *"Every restart, upgrade, and full-cell restore proves ordinary auto-unseal,
replacement-host restore, temporary KMS outage, revoked bootstrap credentials, audit-device
continuity, policy restoration, and token revocation."* Until step 7, "ordinary auto-unseal"
reads as "documented manual unseal", and the gap is an accepted, recorded deviation.

---

## 6. Authentik bootstrap (FRANK-§15.2)

1. Set `FRANK_AUTHENTIK_BOOTSTRAP_EMAIL`, `_PASSWORD` and `_TOKEN` in `.env` **before the
   first start**. They create the initial `akadmin` account.
2. Reach `https://auth.frank.fail/if/flow/initial-setup/` through the host edge, or from the
   host: `curl -H 'Host: auth.frank.fail' http://127.0.0.1:8443/…`.
3. **Immediately** enrol a WebAuthn/passkey credential and make phishing-resistant MFA
   mandatory for the owner. FRANK-§15.2: *"Passkeys preferred; phishing-resistant MFA
   required for owner and operator."*
4. Create Steven's own account with its own passkey. Create a **separate break-glass
   identity** with its own recovery codes, stored offline (FRANK-§15.2: *"Separate migration
   and break-glass identities"*, *"Recovery codes and trust roots stored offline"*).
5. Configure short-lived sessions with refresh rotation, and step-up authentication for
   recovery, trust-root and high-consequence actions.
6. Create OIDC providers/applications for `frank.fail` and `api.frank.fail` with audience
   `frank-production` (`production.env.yaml → isolation.identityAudience`).
7. **Blank all three `FRANK_AUTHENTIK_BOOTSTRAP_*` values in `.env`**, then
   `docker compose up -d frank-authentik-server frank-authentik-worker`. Leaving a bootstrap
   password in place past first login is a FRANK-§15.2 finding, and `preflight.sh` says so on
   every subsequent run.

Admin UI paths (`/if/admin*`, `/api/v3/admin/*`, `/-/metrics*`) are **404 from the public
internet** by Caddyfile rule (FRANK-§16.3). Reach them from the host or over the private
overlay.

---

## 7. Judgment calls forced by the shared host

Each of these is a place where FRANK-§16 could not be applied literally. Recorded here so a
reviewer can accept or reject them explicitly rather than discover them.

| # | FRANK-§16 expectation | What was done | Why |
|---|---|---|---|
| 1 | §16.2: Caddy provides "automatic TLS". | `auto_https off`; FRANK terminates nothing and publishes plain HTTP on `127.0.0.1:8443`. | Ports 80/443 belong to two other production projects. ACME needs 80/443. Security headers, CSP, streaming and the private-network rules are all still owned by FRANK's Caddy, so only certificate *issuance* moved. |
| 2 | §16.2: "rate-limit integration" at the edge. | **Not implemented.** | Caddy's rate limiter is a plugin requiring a custom image build, which would break the FRANK-§15.8 "pinned, unbuilt, digest-verifiable image" property this package holds everywhere else. Interim: the host edge can rate-limit, and the domain API enforces per-identity limits. Recorded as an open gap for Workstream 3. To close it: `xcaddy build v2.10.0 --with github.com/mholt/caddy-ratelimit`, pin the resulting image by digest, add a `rate_limit` block. |
| 3 | §16.6: envelopes for a 64 GB box. | Scaled to an 11 GiB ceiling with fixed floors honoured first (§2.4). | Literal proportional scaling gives identity 1.5 GiB, which will not start an Authentik server + worker pair. §16.6's own priority rule makes under-funding identity the worse error. Over-draw and its funding source are stated to the megabyte. |
| 4 | §16.2: one Valkey for "cache and ephemeral coordination". | Two instances: `frank-valkey` (`allkeys-lru`) and `frank-authentik-redis` (`noeviction`). +192 MiB. | The two need opposite eviction policies. Sharing one instance makes a cache-pressure event an identity outage, which §5.3 and the §16.6 priority rule forbid. |
| 5 | §15.3: OpenBao auto-unseals from a KMS key in the independent recovery account. | Shamir threshold unseal, with the `seal` stanza and full migration procedure documented (§5 step 7). | That provider account does not exist at Slice 1. The threshold shares are required by §15.3 *anyway*, so nothing is discarded by the later migration. **Cost: a host reboot leaves the vault sealed until an operator unseals it.** |
| 6 | §15.6: "TLS everywhere", mTLS on the secret-broker path. | Intra-cell traffic on `frank-cell-net` is plaintext; OpenBao's listener is `tls_disable`. | No internal CA exists at Slice 1. Compensating controls: one private bridge no other project joins, no routable published port, and per-service credentials. The exact remediation is in `openbao/config/openbao.hcl`. Recorded as an open gap for Workstream 3. |
| 7 | §16.7: "Continuous PostgreSQL write-ahead-log archiving". | `wal_level = replica` set now (it needs a restart to change later); `archive_mode = off` with the exact enabling block written out. | An archive with no shipping-and-pruning job attached is an unbounded disk-fill vector against six other production projects. Enable it *together with* the off-cell backup automation, not before. The `frank-cell-postgres-wal-archive` volume is already mounted so enabling is a config change only. |
| 8 | §16.2 / §16.6: observability stack (OTel, Prometheus, Loki, Tempo, Grafana). | Not deployed. | §16.6 gives observability a 6 GB envelope — over half this cell's entire ceiling. §16.6 also requires sizing by measurement. Deploying it here would starve the canonical stores it exists to watch. |
| 9 | §16.6: reserve 15% CPU for the OS. | Per-service `cpus` quotas sum to 7.75 of 8. | These are burst *ceilings*, not reservations. The realistic concurrent peak is 4.75. Reserving hard shares would waste an already-small box. |
| 10 | §16.1: FRANK's own DNS/edge/CDN path. | FRANK depends on another project's edge for TLS and public reachability. | Unavoidable on a shared box. It is a real coupling: an outage or config change in `blockwise-caddy` takes `frank.fail` down. `preflight.sh` warns if 443 is *free*, because that means no edge exists to forward at all. |

---

## 8. Tearing down cleanly

> **Never run `docker system prune`, `docker volume prune` or `docker network prune` on this
> host.** Six other production projects live here. Those commands do not respect project
> boundaries and will destroy their data. Every command below is scoped to `frank-cell`.

### 8.1 Inventory first (FRANK-§16.3.1 steps 1–2)

Destructive work is refused while any target is ambiguous. Produce the exact list first:

```bash
docker ps -a  --filter 'label=com.docker.compose.project=frank-cell' --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker volume ls  --filter 'name=^frank-cell-'   --format '{{.Name}}'
docker network ls --filter 'name=^frank-cell-net$' --format '{{.Name}}'
```

Nothing outside those three lists belongs to FRANK. In particular, anything named
`frank-hub*` is the **retired** deployment: FRANK-§16.3.1 steps 10–11 keep it stopped,
network-isolated and read-only through the rollback window. Do not touch it here.

### 8.2 Stop, keep data

```bash
docker compose --profile admin down
```

Containers and the network go; every `frank-cell-*` volume survives. This is the reversible
option and the right one for maintenance.

### 8.3 Destroy the cell and its data

**Irreversible.** Destroys canonical domain data, Temporal history, identity state, the
OpenBao Raft store and all objects.

```bash
# 1. Back up first — a destroy without a verified restore is a FRANK-§16.7 violation.
docker compose exec -T frank-postgres pg_dumpall -U frank | gzip > frank-cell-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
docker compose exec -e BAO_TOKEN=<admin-token> frank-openbao \
  bao operator raft snapshot save /openbao/logs/final.snap
docker compose cp frank-openbao:/openbao/logs/final.snap ./frank-cell-openbao-final.snap

# 2. Move both off this host and verify a restore before continuing.

# 3. Destroy.
docker compose --profile admin down --volumes --remove-orphans

# 4. Confirm nothing is left — all three must print nothing.
docker ps -a  --filter 'label=com.docker.compose.project=frank-cell' -q
docker volume ls  --filter 'name=^frank-cell-' -q
docker network ls --filter 'name=^frank-cell-net$' -q
```

### 8.4 Confirm the other six projects are untouched

```bash
docker ps --format '{{.Names}}' | sort     # ~20 containers, none named frank-cell-*
ip link show frank-cell0 2>/dev/null || echo "frank-cell0 bridge removed"
ss -ltn | grep -E ':(8443|48200|48088)\b' || echo "FRANK ports released"
```

Then remove the host edge's `frank.fail` handoff block and the
`frank-edge-relay` units if Option B was used.

---

## 9. File map

```
infra/compose/
├─ docker-compose.yml              the cell
├─ .env.example                    every tunable, commented; copy to .env (gitignored)
├─ preflight.sh                    read-only pre-deploy checks; non-zero on any blocker
├─ README.md                       this file
├─ caddy/
│  └─ Caddyfile                    FRANK-§16.3 domain map, security headers, admin gating
├─ postgres/
│  ├─ postgresql.conf              tuned for the 4 GiB cap; UTC storage; extension pinning
│  └─ initdb/
│     ├─ 00-databases.sh           separate roles + databases, cross-service REVOKEs
│     └─ 10-extensions.sh          vector / pgcrypto / pg_stat_statements, and only those
├─ valkey/
│  ├─ valkey.conf                  FRANK cache: allkeys-lru, no persistence
│  └─ authentik-redis.conf         identity cache: noeviction
├─ nats/
│  └─ nats.conf                    JetStream with hard memory and file-store caps
├─ temporal/
│  └─ dynamicconfig/frank.yaml     limits sized for a 1 GiB Temporal on a shared box
├─ openbao/
│  └─ config/openbao.hcl           real Raft server; seal stanza documented, not enabled
└─ seaweedfs/
   └─ s3.json.tmpl                 S3 identity TEMPLATE; rendered to tmpfs at start
```

---

## 10. Spec cross-reference

| Requirement | Where it is satisfied |
|---|---|
| §2.4 isolation — single private cell | one `frank-cell-net` bridge; no external network joined; nothing shared with the other six projects |
| §2.5 defaults — `Australia/Perth`, ISO 8601, 24-hour, IANA rules | `TZ` on every container as an IANA name, never an offset; PostgreSQL stores and logs UTC with `intervalstyle = iso_8601`; Caddy logs RFC 3339; NATS `logtime_utc` |
| §15.2 identity | Authentik OIDC, passkeys/WebAuthn, bootstrap-then-revoke, break-glass identity, per-service workload credentials |
| §15.3 secrets | OpenBao, real Raft server, threshold unseal, audit device, scoped policies, root-token revocation, no secret in the repository |
| §15.6 network and edge | only Caddy is routable and only via the host edge; every port `127.0.0.1`; stores on the private bridge; admin paths private-network only; CSP, HSTS, frame/CSRF headers; request size limits |
| §15.8 supply chain | exact version tags, no `latest`, digest-pinning procedure in §3.2 |
| §16.1 topology | Compose package for a stable service node; no untrusted execution on the control plane |
| §16.2 service baseline | every "Preferred implementation" honoured: Caddy, Temporal + separate database, PostgreSQL + pgvector, SeaweedFS, Valkey, NATS JetStream, Authentik, OpenBao |
| §16.3 domain map | all six hostnames routed from one `FRANK_DOMAIN`; admin consoles unrouted and private |
| §16.3.1 cutover | `frank-cell` namespace never collides with the retired `frank-hub`; teardown inventory in §8.1 |
| §16.6 resources | §2 of this README; hard caps, `oom_score_adj` priority, no swap, capped logs, capped JetStream |
| §16.7 backup | `wal_level` pre-set, WAL archive volume mounted and documented, Raft snapshot procedure, per-store objectives referenced |
| §16.8 retention | Temporal namespace retention 14d aligned to PITR; container logs bounded; archival off pending lifecycle rules |
