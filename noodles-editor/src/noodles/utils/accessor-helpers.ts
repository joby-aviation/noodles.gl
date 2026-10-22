// Helper utilities for composing accessor functions in operator chains.
//
// An accessor is a function that extracts data from objects, commonly used in deck.gl layers.
// These helpers allow operators to compose their transformations with incoming accessor functions,
// creating "viral accessors" that propagate through operator chains.
//
// Example:
//   Input: (d) => d.count              // accessor function
//   Transform: (val) => normalize(val)  // operator transformation
//   Output: (d) => normalize(d.count)   // composed accessor

// Generic accessor type for deck.gl style accessors
// TData: the type of each data item
// TReturn: the return type of the accessor
export type Accessor<TData, TReturn> = (datum: TData, index?: number, data?: TData[]) => TReturn

// A value that can be either a static value or an accessor function
export type AccessorOrValue<TData, TReturn> = TReturn | Accessor<TData, TReturn>

// Legacy type for backwards compatibility with existing code
export type AccessorFunction = (...args: unknown[]) => unknown

// Compose a transformation with a value that might be an accessor function.
//
// If the value is a function (accessor), returns a new function that composes them.
// If the value is static, applies the transformation directly.
//
// Example with accessor function:
//   const countAccessor = (d) => d.count
//   const normalized = composeAccessor(countAccessor, (val) => val / 100)
//   // normalized is now: (d) => d.count / 100
//
// Example with static value:
//   const normalized = composeAccessor(50, (val) => val / 100)
//   // normalized is: 0.5
export function composeAccessor<TIn, TOut>(
  value: TIn | AccessorFunction,
  transform: (val: TIn) => TOut
): TOut | ((...args: unknown[]) => TOut) {
  if (typeof value === 'function') {
    // Compose: create new accessor that applies both
    return (...args: unknown[]) => transform(value(...args) as TIn)
  }
  // Apply transformation directly to static value
  return transform(value as TIn)
}

// Check if a value is an accessor function.
export function isAccessor(value: unknown): value is AccessorFunction {
  return typeof value === 'function'
}

// Type-safe version of isAccessor for when you know the data and return types
export function isTypedAccessor<TData, TReturn>(
  value: AccessorOrValue<TData, TReturn>
): value is Accessor<TData, TReturn> {
  return typeof value === 'function'
}
