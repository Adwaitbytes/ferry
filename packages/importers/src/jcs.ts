/**
 * RFC 8785 JSON Canonicalization Scheme for plain JSON values. PAM integrity checksums are defined
 * over JCS output. ECMAScript number and string serialization already match RFC 8785, so only key
 * ordering (UTF-16 code units, which is the default sort) and undefined handling need care.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalize: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalize: unsupported ${typeof value}`);
}
