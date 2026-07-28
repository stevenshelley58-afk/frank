/**
 * Deterministic serialization for hashing — FRANK-§11.5, FRANK-§6.8.
 *
 * Two things in this package hash structured values: the audit chain
 * (`audit-chain.ts`) and the capture idempotency key (`capture-key.ts`). Both
 * break if the same logical value can produce two different byte strings, so
 * neither may use `JSON.stringify` directly:
 *
 *   * object key order in `JSON.stringify` follows insertion order, so
 *     `{a, b}` and `{b, a}` hash differently;
 *   * `undefined` values vanish from objects but become `null` in arrays;
 *   * `-0` stringifies as `0`, and `NaN`/`Infinity` become `null`, so three
 *     distinct values collapse;
 *   * `Date` silently becomes a string via `toJSON`, so a `Date` and its ISO
 *     string are indistinguishable after hashing.
 *
 * The encoding here is JSON with sorted keys and an explicit refusal for
 * everything ambiguous. It is deliberately not JCS (RFC 8785): JCS's number
 * canonicalization is defined in terms of IEEE 754 doubles, and this codebase
 * forbids floats in exactly the values that matter (FIN-002). Numbers are
 * restricted to safe integers and anything fractional must be presented as a
 * string by the caller — the same discipline `money.ts` enforces.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

export class NonCanonicalValueError extends TypeError {
  constructor(path: string, detail: string) {
    super(`Cannot canonicalize value at ${path || '<root>'}: ${detail}.`);
    this.name = 'NonCanonicalValueError';
  }
}

/**
 * Serialize `value` to a deterministic UTF-8 JSON string.
 *
 * `undefined` object properties are omitted (they are "absent", which is a
 * meaning JSON can express); `undefined` inside an array throws, because an
 * absent array element is not a meaning JSON can express and coercing it to
 * `null` would make `[1, undefined]` and `[1, null]` hash alike.
 */
export function canonicalJson(value: CanonicalValue): string {
  return encode(value, '');
}

function encode(value: CanonicalValue | undefined, path: string): string {
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
        throw new NonCanonicalValueError(
          path,
          `${value} is not a safe integer; present fractional and large values as strings (FIN-002)`,
        );
      }
      // Normalizes -0 to 0, which is correct here: they are the same integer.
      return String(value === 0 ? 0 : value);
    }

    case 'undefined':
      throw new NonCanonicalValueError(path, 'undefined is not representable');

    case 'object':
      break;

    default:
      throw new NonCanonicalValueError(path, `values of type ${typeof value} are not representable`);
  }

  if (Array.isArray(value)) {
    const parts = value.map((element, i) => {
      if (element === undefined) {
        throw new NonCanonicalValueError(
          `${path}[${i}]`,
          'undefined inside an array is ambiguous; use null explicitly',
        );
      }
      return encode(element, `${path}[${i}]`);
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
    if (child === undefined) continue; // absent property
    parts.push(`${JSON.stringify(key)}:${encode(child, path === '' ? key : `${path}.${key}`)}`);
  }
  return `{${parts.join(',')}}`;
}
