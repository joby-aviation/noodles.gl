// Memoization function to cache results based on the input object.
// It uses a WeakMap to store the results, allowing for garbage collection
// of unused objects.
export function memoize<T>(fn: (arg: object) => T) {
  const cache = new WeakMap<object | symbol, T>()
  const memoized = function (params: object) {
    if (cache.has(params)) {
      return cache.get(params)
    }
    const result = fn.call(this, params)
    cache.set(params, result)
    return result
  }
  memoized.cache = cache

  return memoized
}
