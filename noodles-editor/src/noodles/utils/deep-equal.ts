export function deepEqual(a: unknown, b: unknown, maxDepth = Infinity, currentDepth = 0): boolean {
  // Fast path: same reference. NaN counts as equal to itself, like Object.is.
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true

  // Primitives and null
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false

  // Arrays must match
  if (Array.isArray(a) !== Array.isArray(b)) return false

  // Special types (Date, Map, Set, RegExp) are compared by value regardless of depth
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    for (const [key, val] of a) {
      if (!b.has(key) || !deepEqual(val, b.get(key), maxDepth, currentDepth + 1)) return false
    }
    return true
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const val of a) {
      if (!b.has(val)) return false
    }
    return true
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags
  }
  // Temporal values keep their state in internal slots and have no own keys, so the
  // key walk below would call any two of them equal. Their ISO strings are canonical.
  if (isTemporal(a) || isTemporal(b)) {
    return isTemporal(a) && isTemporal(b) && a.constructor === b.constructor && `${a}` === `${b}`
  }
  // Other class instances (ArrayBuffer, URL, Blob, Error, DOM nodes, ...) can also keep their
  // state where Object.keys can't see it. Compare them key by key only within the same class,
  // and never call two key-less ones equal: they already failed the reference check.
  const plain = isPlain(a) && isPlain(b)
  if (!plain && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false

  // Check keys
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false

  // Empty plain objects and arrays are equal
  if (keysA.length === 0) return plain

  // If we've reached max depth and objects have properties, compare by reference
  if (currentDepth >= maxDepth) return false

  // Compare values
  for (const k of keysA) {
    if (!Object.hasOwn(b, k)) return false

    const valA = (a as any)[k]
    const valB = (b as any)[k]

    // Fast path: same reference or primitive equality
    if (valA === valB || (Number.isNaN(valA) && Number.isNaN(valB))) continue

    // Different primitives or null
    if (typeof valA !== 'object' || valA === null || typeof valB !== 'object' || valB === null) {
      return false
    }

    // Both are objects: recurse with incremented depth
    // This ensures depth only counts object nesting levels, not primitive properties
    if (!deepEqual(valA, valB, maxDepth, currentDepth + 1)) return false
  }

  return true
}

// Matches both the polyfill and native Temporal, which tag instances as e.g. "Temporal.PlainDateTime"
function isTemporal(value: object): boolean {
  return Object.prototype.toString.call(value).startsWith('[object Temporal.')
}

function isPlain(value: object): boolean {
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
