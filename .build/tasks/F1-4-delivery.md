# F1-4 — Service identity and artifact delivery

**Depends:** F1-2 · **Model:** strong (security surface) · **Serial**
**Allowed files:** `modules/delivery/**`
**Forbidden:** producing modules, consumer repos, hot files

How a signed release physically reaches a consumer, and how a consumer proves it got the right bytes.

---

## Producer side

```
POST /v1/projects/:projectId/releases           publish a release
GET  /v1/projects/:projectId/releases?after=<cursor>&limit=100
GET  /v1/projects/:projectId/releases/:releaseId
GET  /v1/projects/:projectId/releases/:releaseId/archive    expiring signed URL
GET  /v1/projects/:projectId/health
```

- Cursor-based pagination, stable ordering, **tombstones included** — a consumer that skips tombstones never unpublishes.
- Service identities are **project-scoped**. A token for project A returns 403 for project B, not an empty list. Test both.
- Archive URLs expire in ≤ 5 minutes, are single-use, and carry no credentials in the query string.

## Consumer side

```json
{ "packUrl": "expiring HTTPS URL",
  "packSha256": "sha256", "packId": "id", "buildId": "id",
  "issuedAt": "ISO", "nonce": "one-use", "signature": "Ed25519",
  "idempotencyKey": "pack sha256" }
```

**Importer must enforce, each with its own test:**

| Check | Failure |
|---|---|
| Ed25519 signature against the pinned Frank public key | reject |
| `issuedAt` within a 5-minute window | reject |
| Nonce unused | reject on replay |
| HTTPS origin **and path** on the allowlist | reject |
| No redirects followed | reject |
| Size ceiling before download completes | reject |
| Archive path traversal (`../`) | reject |
| Archive symlinks | reject |
| MIME **and magic bytes** match declared type | reject |
| Schema validation against F1-2 | reject |
| Every asset and font `sha256` verified | reject |
| Both layouts render as canaries | reject |
| Supplied previews match deterministic renders | reject |

**Quarantine until every check passes. Activation is atomic** — a consumer never observes a half-imported release.

### Idempotency

- Identical replay (same `release_id`, same hash) → **the same receipt**, no new row, HTTP 200.
- Same identity, **different** hash → HTTP `409` with `RELEASE_VERSION_CONFLICT`.
- Interrupt after every batch boundary and resume — no duplicates, no gaps.

**Frank receives a signed receipt but gains no mutation access to the consumer.** The receipt is proof of delivery, not a callback with privileges.

---

## Never

Tokens in logs, JSON responses, or browser bundles. Private object paths in any payload. A consumer calling a producer's database. A producer calling a consumer to perform generation.

Add a build-output scan proving no service token can reach the browser bundle.

---

## Done when

- [ ] Replay, expiry, wrong-project, wrong-scope, changed-byte and revoked-token tests all pass
- [ ] Traversal and zip-bomb fixtures rejected before extraction completes
- [ ] Tampering one byte of one asset fails the import
- [ ] Identical replay returns the identical receipt; different-hash returns 409
- [ ] Interrupted import resumes cleanly
- [ ] Cursor pagination returns tombstones
- [ ] Token scan of built bundles is clean
