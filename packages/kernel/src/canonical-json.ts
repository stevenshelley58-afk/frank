/**
 * Deterministic serialization for context-pack hashing — FRANK-§7.4.
 *
 * Ported from `adapters/storage/postgres/src/canonical-json.ts` (same
 * algorithm, same discipline). Duplicated here because FRANK-§17.2 forbids
 * `packages/*` from importing `adapters/*`: the dependency arrow points the
 * other way.
 *
 * One deliberate extension: a `floatPolicy` option. The audit chain (the
 * original caller) forbids floats outright (FIN-002). A context pack carries
 * `relevance: number` (0..1) in its memory section, which is a float by
 * nature. With `floatPolicy: 'stringify'` those values are rendered via
 * `JSON.stringify`, which is deterministic in every conformant JS engine
 * (shortest round-trippable representation). The audit-chain caller keeps
 * the default `'reject'` and is unaffected.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

/**
 * How to treat a non-integer finite number.
 *
 * - `'reject'` (default): throw. Use for financial / audit values (FIN-002).
 * - `'stringify'`: render via `JSON.stringify`. Use for context-pack hashing
 *   where floats are legitimate (e.g. memory relevance scores).
 */
export type FloatPolicy = 'reject' | 'stringify';

export class NonCanonicalValueError extends TypeError {
  constructor(path: string, detail: string) {
    super(`Cannot canonicalize value at ${path || '<root>'}: ${detail}.`);
    this.name = 'NonCanonicalValueError';
  }
}

/**
 * Serialize `value` to a deterministic UTF-8 JSON string with sorted keys.
 *
 * `undefined` object properties are omitted; `undefined` inside an array
 * throws (an absent array element is not a meaning JSON can express).
 */
export function canonicalJson(
  value: CanonicalValue,
  floatPolicy: FloatPolicy = 'reject',
): string {
  return encode(value, '', floatPolicy);
}

function encode(
  value: CanonicalValue | undefined,
  path: string,
  floatPolicy: FloatPolicy,
): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);

    case 'boolean':
      return value ? 'true' : 'false';

    case 'number': {
      if (!Number.isFinite(value)) {
        throw new NonCanonicalValueError(path, `${value} has no JSON representation`);
      }
      if (!Number.isSafeInteger(value)) {
        if (floatPolicy === 'stringify') {
          // Deterministic: V8 and all conformant engines emit the shortest
          // round-trippable decimal for a given IEEE 754 double.
          return JSON.stringify(value);
        }
        throw new NonCanonicalValueError(
          path,
          `${value} is not a safe integer; present fractional and large values as strings (FIN-002)`,
        );
      }
      return String(value === 0 ? 0 : value);
    }

    case 'undefined':
      throw new NonCanonicalValueError(path, 'undefined is not representable');

    case 'object':
      break;

    default:
      throw new NonCanonicalValueError(
        path,
        `values of type ${typeof value} are not representable`,
      );
  }

  if (Array.isArray(value)) {
    const parts = value.map((element, i) => {
      if (element === undefined) {
        throw new NonCanonicalValueError(
          `${path}[${i}]`,
          'undefined inside an array is ambiguous; use null explicitly',
        );
      }
      return encode(element, `${path}[${i}]`, floatPolicy);
    });
    return `[${parts.join(',')}]`;
  }

  if (value instanceof Date) {
    throw new NonCanonicalValueError(
      path,
      'Date is ambiguous after serialization; pass an explicit ISO 8601 string',
    );
  }

  const record = value as { readonly [key: string]: CanonicalValue | undefined };
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = record[key];
    if (child === undefined) continue;
    parts.push(
      `${JSON.stringify(key)}:${encode(child, path === '' ? key : `${path}.${key}`, floatPolicy)}`,
    );
  }
  return `{${parts.join(',')}}`;
}
