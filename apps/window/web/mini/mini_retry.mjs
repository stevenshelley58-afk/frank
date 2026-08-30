/**
 * Retain one idempotency key while the same material command is unresolved.
 * A confirmed response clears it; a changed command receives a fresh key.
 */
export function createReplayKeyTracker(keyFactory) {
  if (typeof keyFactory !== "function") throw new TypeError("A key factory is required.");
  let pending = null;

  return {
    keyFor(signature) {
      const material = String(signature || "");
      if (pending && pending.signature === material) return pending.key;
      pending = { signature: material, key: String(keyFactory()) };
      return pending.key;
    },
    confirm(signature) {
      if (pending && pending.signature === String(signature || "")) pending = null;
    },
    reset() {
      pending = null;
    },
  };
}
