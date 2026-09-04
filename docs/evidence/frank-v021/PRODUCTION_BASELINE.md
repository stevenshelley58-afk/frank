# Frank v0.21 Phase A — production baseline receipts (redacted)

Captured: 2026-09-03T10:30Z by Session 1 (integration/release owner).
Raw manifests and authenticated material live only under `/secure/frank-v021/`
(root-owned, outside Git). This file contains structural facts and hashes only.

## 1. Source and checkout

| Item | Value |
| --- | --- |
| Canonical remote | https://github.com/stevenshelley58-afk/frank.git |
| `origin/main` at capture | `49d75ad79dcf1f89a18506e7af2a8abacd9b1487` |
| `/projects/frank` working tree | clean, branch `main`, up to date with `origin/main` |
| Approved-sha file | `/var/lib/frank/release/approved-sha` = `49d75ad79dcf1f89a18506e7af2a8abacd9b1487` |
| Release record | `frank-step8-43c58f9` (`record_hash sha256:eb16910d…172a52f9e`) |

## 2. Running application

| Item | Value |
| --- | --- |
| Container | `frank-window` (compose project `frank`), healthy, `127.0.0.1:18080->8080` |
| Image | `frank-window:current` = `sha256:783f322a0c9ad152cfa5008847f65e074144c95523169e8f0494ed999b34c064` |
| Image created | 2026-08-31T07:25:06Z |
| Image OCI source labels | none (release-provenance gap; fixed in Phase E) |
| `/api/health` | `{"hermes":{"ok":true},"ok":true,"service":"frank-window"}` |
| Other images present | `frank-window:blog-studio-rc` (`sha256:e16a87da…`, built 2026-09-03 ~06:20Z, not deployed) |

## 3. Release-provenance drift (reconciled)

The running image's web assets hash-match, blob for blob, commit
`8b2c8b256d421140a2ac0aaa0745cddda5da4eec` ("fix(ad-studio): preserve live run
history"), the tip of unmerged branch `fix/adstudio-history-flicker`. `8b2c8b2`
is a descendant of `main` (main is fully contained in it); the delta is exactly
one commit, 6 files, +247/−7, adding `web/js/ad-studio-state.js` and tests.

Decision (Phase A step 3): **keep the deployed behavior**. `8b2c8b2` was merged
into `codex/frank-v021-preflight` (no reset/rebase; ancestry preserved), so
source now matches production. One internal inconsistency existed inside
`8b2c8b2` itself: its new UI-contract assertions expected cache keys
`20260831-ad-studio-history-v1`/`20260831-history-v1`, while its own html/app.js
(and the deployed image) use `20260831-batch-live-history-v1` for both. The test
was corrected to the deployed reality; no behavior change.

Reconciliation commits on `codex/frank-v021-preflight`:
- `4bedfe7` release: reconcile deployed ad-studio run-history fix (8b2c8b2) into source
- `9e954da` tests: reconcile control-inventory canonical-root assertion and ad-studio cache-key contract

Additional pre-existing test repair: `test_repository_matrix_is_deterministic_and_canonical`
failed on pristine `main` from any checkout because it required *all* inventory
locators to start with `/projects/frank/` although the closed-world declaration
legitimately pins external canonical roots (`/home/hermes/.hermes/skills`,
`/root/.claude`, `/root/.codex`, the Blockwise release workspace). The
assertion now requires every locator to start with a declared canonical root
and that `/projects/frank/` is represented. Source-adapters declaration untouched.

Asset manifest: `ASSET_MANIFEST.sha256` (container blob hashes vs source).
Raw: `/secure/frank-v021/raw/container-web-manifest.txt`.

## 4. Hermes runtime inventory (Phase A 3a)

| Item | Value |
| --- | --- |
| Active version | 0.20.1 (`pyproject.toml`), dirty checkout |
| Path | `/home/hermes/.hermes/hermes-agent` |
| Branch | `codex/ad-studio-release-path-recovery` |
| Nominal HEAD | `ed1554a2fee7478f3085d307f376ef9cc5e2113c` |
| Modified (uncommitted) | `gateway/tool_run_api.py`, `tests/gateway/test_api_server_tool_runs.py`, `tests/gateway/test_ad_studio_generation_contract.py` |
| Untracked rollback debris | 8 files `*.rollback-{421f,a727e89,af42,ed1554}` (hashes below; never copied) |
| Consumers | `hermes-serve.service` (`--profile default serve --isolated`) and `hermes-gateway.service` (`gateway run`) both execute this checkout's venv directly |

SHA-256 of effective live `/v1/tool-runs` implementation/tests:
- `gateway/tool_run_api.py` = `3a4e9815520dc1a8ca3c68914a6c5eb33c5c581c93fdbbebf241349455a42a94` (1043 lines)
- `tests/gateway/test_api_server_tool_runs.py` = `5b79bff3ced84298d484ce6c5910603289a744506548f358db82231293b3f2d9`
- `tests/gateway/test_ad_studio_generation_contract.py` = `55665c6a0f25fe28b1b464002acc4860075922cb39bf808014d245cf0e0c1db8`

Rollback debris hashes (recorded for disposition only):
`79dbe1d4…`, `e558b8be…`, `0f46c576…`, `f64efcab…` (tool_run_api variants),
`d9135bfe…`, `a1cc62a7…` (generation contract variants),
`59767278…`, `6ffdb499…` (tool-runs test variants) — full list with filenames in
`/secure/frank-v021/raw/hermes-rollback-debris.sha256`.

Live diff (3043 lines) recovered to `/secure/frank-v021/raw/hermes-tool-runs-live.diff`
and replayed onto a clean branch `codex/frank-v021-tool-runs-recovery` at
`ed1554a2fe` in a separate worktree; the dirty live checkout was not modified.

## 5. Hindsight (current production)

| Item | Value |
| --- | --- |
| Mode | `local_embedded`, profile `hermes` |
| Bank identity | `bank_id: steven-unassigned`, template `steven-{workspace}` |
| Recall | `auto_recall: true`, sync, `recall_max_tokens: 2048` |
| Retain (current) | `auto_retain: true`, every turn, async — contract requires `auto_retain:false` + supported-API admission adapter at cutover |
| Access | loopback-only API; Frank reaches it via `hindsight-frank-proxy.socket` (socket-proxyd to `127.0.0.1:9177`) on the private Frank Docker network |

## 6. Service units touched by this release

`hermes-serve.service` (bind: Tailscale host IP :9119, `--isolated`),
`hermes-gateway.service`, `hermes-frank-vault-broker.service`
(`/srv/frank/hermes-connections/broker.py`), `hindsight-frank-proxy.{socket,service}`,
`agenttrail-only-process-frank.service`, `agenttrail-only-process-hermes.service`,
plus opt-in Frank control-plane timers (cleanup, discovery, evaluation,
chat-pattern, restore-drill, control-reconcile fast/full).

## 7. Data roots that must survive every deploy/rollback

`/srv/frank/data/window` (Window data incl. chats, uploads, maps, control-graph,
evidence), `/srv/frank/secrets/window.env` (0600), `/home/hermes/.hermes`
(Hermes state incl. kanban.db, cron, sessions, skills, secrets),
`/var/lib/frank/release` (approved-sha + release records), Infisical named volumes.
