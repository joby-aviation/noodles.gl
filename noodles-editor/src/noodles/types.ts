import type { View } from '@deck.gl/core'
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import type { RefObject } from 'react'

// Common type definitions for the Noodles.gl codebase

// Ref providing synchronous read access to the full graph state (all nodes/edges,
// not just the currently displayed scope). Used by CopyControls, UndoRedoHandler,
// and hooks that need the complete graph without triggering re-renders.
// Uses the widest Node/Edge types since consumers only need base properties (id, type, position, etc).
export type GraphRef = RefObject<{ nodes: ReactFlowNode[]; edges: ReactFlowEdge[] }>

// Valid values for Deck.gl layer properties
// Represents the common types that can be passed as layer props
export type LayerPropsValue = string | number | boolean | unknown[] | Record<string, unknown> | null

export type DeckViewType =
  | 'MapView'
  | 'GlobeView'
  | 'FirstPersonView'
  | 'OrbitView'
  | 'OrthographicView'

// Serializable description of a deck.gl View. View operators produce these values;
// the renderer turns them into class instances at the deck.gl boundary.
export type DeckViewDescriptor = {
  type: DeckViewType
  id?: string
  [key: string]: unknown
}

// Keep accepting class instances produced by custom CodeOps while built-in view
// operators migrate to descriptors.
export type DeckViewValue = DeckViewDescriptor | View

// Constructor arguments for Deck.gl layer extensions
// Keep flexible as different extensions accept different arguments
export type ExtensionConstructorArgs = unknown[]

// Result from a single for-loop iteration
// Keep flexible as loop content is dynamic and user-defined
export type ForLoopIterationResult = unknown

// Execution context passed to operators during graph execution
// Contains timing information and contextual data for special execution modes
export interface ExecutionContext {
  // Current timestamp in milliseconds
  time?: number
  // Current frame number for animation/iteration
  frame?: number
  // Additional contextual data (e.g., iteration variables for for-loops)
  context?: Map<string, unknown>
}
