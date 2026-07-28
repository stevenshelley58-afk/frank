/**
 * Shared primitive aliases used across the frozen contracts.
 *
 * These are deliberately plain `string` aliases rather than template-literal or
 * branded types. The JSON Schemas constrain them with `pattern` and `format`,
 * and Ajv (see `tools/registry/validate-contracts.mjs`) is the thing that
 * enforces those constraints. A TypeScript type that only *half* expressed the
 * pattern would read as a guarantee it cannot make, so the alias carries the
 * rule in its documentation and leaves enforcement where it actually happens.
 */

/**
 * A SHA-256 digest, optionally prefixed with `sha256:`.
 * Schema pattern: `^(sha256:)?[0-9a-f]{64}$`.
 */
export type Sha256 = string;

/**
 * A SHA-256 digest that must carry the `sha256:` prefix.
 * Schema pattern: `^sha256:[0-9a-f]{64}$`.
 */
export type PrefixedSha256 = string;

/**
 * RFC 3339 / ISO 8601 timestamp. Schema `format: date-time`.
 */
export type IsoDateTime = string;

/**
 * Semantic version string.
 * Schema pattern: `^\d+\.\d+\.\d+(-…)?(\+…)?$`.
 */
export type SemanticVersion = string;

/**
 * ISO 4217 currency code. Schema pattern: `^[A-Z]{3}$`.
 */
export type CurrencyCode = string;
