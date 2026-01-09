/**
 * Common type definitions for the Noodles.gl codebase
 */

/**
 * Valid values for Deck.gl layer properties
 * Represents the common types that can be passed as layer props
 */
export type LayerPropsValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>
  | null

/**
 * Constructor arguments for Deck.gl layer extensions
 * Keep flexible as different extensions accept different arguments
 */
export type ExtensionConstructorArgs = unknown[]

/**
 * Result from a single for-loop iteration
 * Keep flexible as loop content is dynamic and user-defined
 */
export type ForLoopIterationResult = unknown

/**
 * Execution context passed to operators during graph execution
 * Contains timing information and contextual data for special execution modes
 */
export interface ExecutionContext {
  /** Current timestamp in milliseconds */
  time?: number
  /** Current frame number for animation/iteration */
  frame?: number
  /** Additional contextual data (e.g., iteration variables for for-loops) */
  context?: Map<string, unknown>
}
