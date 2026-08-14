/**
 * Server-side context-pack kernel (FRANK-§7.4).
 *
 * Composes exactly ONE {@link ContextPackAssembler} for the running app so the
 * live `/api/chat` path assembles proper signed, hash-addressed context packs.
 *
 * - Signing key: an env-driven {@link SigningKeyResolver}. The key handle is
 *   opaque (`handle:`-prefixed, FRANK-§2.3) and the material is derived from
 *   `FRANK_PACK_SIGNING_KEY` (≥32 bytes after SHA-256). A stable dev fallback is
 *   used only when the env key is absent — production must set it.
 *
 * This is the ONLY place the web app builds an assembler. Callers import
 * {@link getAssembler} and never touch the resolver directly.
 */

import { createHash } from 'node:crypto';

import { ContextPackAssembler } from '@frank/kernel';
import { InMemoryKeyResolver } from '@frank/policy';
import type { SigningKeyResolver } from '@frank/policy';

/** Opaque key handle the assembler signs packs under (FRANK-§2.3). */
export const PACK_KEY_HANDLE = 'handle:frank-web-pack-signer';
/** Signer identity recorded in every pack's integrity block. */
export const PACK_SIGNER_ID = 'service:frank-web';

/**
 * Stable development key material. NOT a secret — used only when
 * `FRANK_PACK_SIGNING_KEY` is unset (local dev / test). Production must set the
 * env var so packs are signed with deployment-owned material.
 */
const DEV_FALLBACK_SECRET = 'frank-web-dev-pack-signing-key-not-for-production';

let instance: ContextPackAssembler | null = null;

/** Build a SigningKeyResolver whose single handle maps to deployment key material. */
function buildResolver(): SigningKeyResolver {
  const secret = process.env.FRANK_PACK_SIGNING_KEY ?? DEV_FALLBACK_SECRET;
  // SHA-256 normalizes any secret to exactly 32 bytes, satisfying the
  // InMemoryKeyResolver minimum and giving deterministic dev packs.
  const key = createHash('sha256').update(secret, 'utf8').digest();
  return new InMemoryKeyResolver([[PACK_KEY_HANDLE, key]]);
}

/** The app-wide context-pack assembler. Lazily constructed, then reused. */
export function getAssembler(): ContextPackAssembler {
  if (instance) return instance;
  instance = new ContextPackAssembler(buildResolver());
  return instance;
}

/** Force re-init (tests, env reload). */
export function resetAssembler(): void {
  instance = null;
}
