# Mini Frank boundary and verification

Mini Frank is an independently deployable customer-work application — a peer of
Blockwise, not an embedded part of Frank Window. It owns project-specific
product decisions and knowledge scope while consuming centrally governed
Hermes execution, tools, skills and approved reusable references by reference.
It must not duplicate Hermes, a persistent runtime, a skills tree or a memory
provider. Customer/account/job files, conversations, credentials and
recognisable business context remain private.

## Peer-application architecture (staged migration)

- Canonical application source lives in the Mini project:
  `/projects/mini-frank/app/` (`mini_app.py` server, `mini_frank.py` transport,
  `mini/` product contracts, `web/mini/` frontend).
- The standalone server implements the same Hermes seams Frank's server
  injects today (session creation, requests, chat streaming) against the
  shared Hermes runtime on `localhost:9119`. No second runtime or memory store.
- Frank connects through a thin, authenticated push/pull API
  (`/partner/v1/*`, bearer `MINI_PARTNER_TOKEN`): health, aggregate status,
  owner-level job status pulls, and operational messages. It exposes
  operational fields only — never customer content.
- Data roots have host↔container parity with frank-window's mounts
  (`/srv/frank/data/window` = container `/data`, previews, legacy
  customer-projects), so cutover moves no data.

## Current migration stage

Implemented and verified:

- Standalone app boots and serves the byte-identical canonical frontend
  (SHA256-verified against the Frank tree copy) with the full product API.
- Authenticated partner boundary tested (401 without/with wrong token, 503
  when unconfigured; projections exclude `problem`, `conversation`,
  `account_id`).
- Staging service runs on `127.0.0.1:9130` against an isolated staging data
  root (`/srv/frank/data/mini-frank-staging`), so it cannot interfere with
  frank-window's live Mini store. Unit template: `app/deploy/mini-frank.service`.

Remaining for coordinated cutover (Frank task + Verdent):

1. Flip the service environment to the production host paths and
   `MINI_START_RECONCILER=1`; install the systemd unit and persist the partner
   token in the secrets store.
2. Point Caddy's `/mini-frank/*` route at `localhost:9130` and remove Mini's
   blueprint/SPA registration from Frank's `server.py` in the same window.
3. Frank's management interface switches to the partner API.

Until cutover, the live public route is still served by frank-window, whose
tree carries the same frontend and transport fixes.

## Central shared library

Implemented (file-backed, context-only; not the Hindsight adapter):

- `shared_library.py`: seed + runtime approved records, relevance search,
  project-scoped candidate queue, digest-bound admission with id+version
  records, expiry rejection, atomic no-clobber publication, symlink-safe
  directory ancestry, public-HTTPS-only provenance.
- `tests/test_shared_library.py` proves cross-project isolation, admission
  visibility, version supersession, tamper/expiry/corruption/symlink/private
  failure safety, and concurrent-write atomicity (11 tests).
- Mini integration: `mini/knowledge.py` reports truthful library availability,
  queues only public evidence-backed candidates at result finalisation, and
  `_build_prompt` injects bounded relevance-filtered approved references as
  untrusted context with no permission changes. Dispatch instructions match.
- Installed shared skill: `/srv/skills/shared-library/SKILL.md` (CLI usage for
  any project agent: search, contribute, admit).
- Shared Hindsight industry memory remains unavailable; this library is not it.

## Verification

```bash
cd /projects/frank/apps/window
node --test tests/mini_*.test.mjs                 # 48/48
python3 -m unittest tests.test_shared_library \
  tests.test_mini_product_backend tests.test_mini_frank \
  tests.test_mini_guide_contract                  # 144/144
MINI_QA_SCREENSHOTS=/srv/frank/tmp/cleanup-20260905/mini-qa \
  /srv/frank/tmp/cleanup-20260905/mini-qa-venv/bin/python tests/mini_browser_qa.py   # 4/4

cd /projects/mini-frank/app
python3 -m unittest tests.test_mini_standalone    # 13/13
```

The browser harness serves the canonical UI locally, blocks all non-local
browser traffic, rejects unexpected API routes, and fakes every mutation.
Screenshots are disposable release evidence, not customer data.

## Knowledge direction

A project-specific reusable, non-private lesson may be contributed to the
central shared library through the governed candidate queue and admitted after
evidence review. Customer-derived material stays private pending deliberate
sanitisation. This document records the boundary; the Hindsight industry-memory
adapter remains unavailable.
