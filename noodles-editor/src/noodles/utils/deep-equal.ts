export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false

  // Handle Date, Map, Set, RegExp
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    for (const [key, val] of a) {
      if (!b.has(key) || !deepEqual(val, b.get(key))) return false
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

  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false
  return keysA.every(
    k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as any)[k], (b as any)[k])
  )
}
