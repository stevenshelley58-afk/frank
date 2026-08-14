# Frank stopped-state receipt

Recorded: `2026-08-12T10:51:03+08:00`

## Source boundary

- PR: `#73`, merged normally.
- Exact `origin/main`: `b5b338b1589454596130b30364f70d55cf34f644`.
- Main verify: `31556679044`, success.
- Main secret scan: `31556679032`, success.
- Signed release artifacts: `31556797961`, success.
- Release evidence artifact: `release-evidence-b5b338b1589454596130b30364f70d55cf34f644`.
- Artifact ID: `9126444110`.
- Artifact SHA-256: `0a11d59de482b2dab348a0d9f14e80b75571282feae476e9aaf4ce2d185b0ac0`.

## Production boundary

- Production remains on the previously accepted Graphify release `fead0c4b9e3cae60038b54f999a5066d165f8a2b` on the original VPS `76.13.209.160`.
- The stopped release lane performed no VPS access, migration, deployment, Compose switch, image switch, Caddy change, cleanup, or DNS action.
- The merged/signed `b5b338b1` artifacts are not production-accepted and must not be deployed directly. Only the final cleaned `main` artifacts that pass the chat handover's Phase 5 exact-artifact acceptance, Phase 6 cutover, and Phase 7 production acceptance may become live. Any source, generated, configuration, migration, or image change requires a fresh build and evidence.

## Downstream packets at the stop boundary

- `refs/heads/codex/project-dashboard-api` = `db20ce85eab8e3f50a03d547ab338cb039d98282`.
- `refs/heads/codex/project-dashboard-ui` = `d852e87176d707423f4f245da3b2b54f8c3465f6`.
- `refs/heads/codex/project-dashboard-lake` = `7a965c23bbfb41ff776a8b80522db80397dc8d46`.

These refs were published for cold-start durability only and were not merged. A later remote check during the chat-only plan revision no longer found them, and the local object store no longer retained the packet objects. They must not be treated as current executable inputs. The chat compatibility phase must obtain each workstream's current accepted replacement ref and prove it resolves from a fresh clone; the recorded SHAs remain historical coordination evidence only.

## Zero-active-process check

- Local active release/deploy processes: `0`.
- Original-VPS active promotion/deploy/release/build/migration processes matching the guarded release patterns: `0`.
- One stale local SSH helper for the already-disposable `frankwave1canary0d45` cleanup was found and stopped by exact PID after its containers, networks, and volumes were confirmed absent. Its exact VPS source directory was then confirmed absent.
- No production process was stopped.

This receipt is a stop boundary, not a production acceptance receipt.
