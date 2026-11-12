/**
 * Structural hashing: the memo key for relations and layer plans.
 *
 * Two nodes that would compute the same rows must hash the same, whatever order their fields
 * were written in and whatever they are called. So the input is canonical JSON — object keys
 * sorted, `undefined` dropped — and ids are left out by the callers, who hash inputs by *their*
 * hashes instead. Renaming a node, or moving it on the canvas, therefore costs nothing.
 *
 * FNV-1a, twice with different offsets, for 64 bits. Pure arithmetic rather than
 * `crypto.subtle`, because the planner is headless (no DOM, no Node built-ins) and because
 * a synchronous hash keeps compilation synchronous where it can be. Collisions at 64 bits
 * across the few hundred relations a session creates are not a practical concern.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // NaN and ±Infinity have no JSON form and would all collapse to `null`.
    if (typeof value === 'number' && !Number.isFinite(value)) return `"#${String(value)}"`;
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function fnv1a(text: string, offset: number): number {
  let h = offset >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 16 hex characters. Safe in an unquoted SQL identifier after a letter prefix. */
export function hashOf(value: unknown): string {
  const text = canonicalJson(value);
  const a = fnv1a(text, 0x811c9dc5);
  const b = fnv1a(text, 0x050c5d1f);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
