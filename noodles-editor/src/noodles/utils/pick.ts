export function pick<T extends object, K extends keyof T>(
  obj: T | undefined,
  keys: K[]
): Partial<T> {
  if (!obj) return {}
  const ret: Partial<T> = {}
  for (const key of keys) {
    if (key in obj) {
      ret[key] = obj[key]
    }
  }
  return ret
}
