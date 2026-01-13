// Expression Context - Utilities for determining available variables and data keys
// for autocomplete in ExpressionOp and AccessorOp

import * as d3 from 'd3'
import * as deck from 'deck.gl'
import * as turf from '@turf/turf'
import * as utils from '../../utils'
import type { Edge } from '../graph-executor'
import type { IOperator, Operator } from '../operators'
import { getOp, getAllOps } from '../store'
import type { OpId } from './id-utils'

// Helper to get function/property names from an object, filtering out internals
function getLibraryProperties(obj: object): string[] {
  return Object.keys(obj).filter(key => !key.startsWith('_'))
}

export interface GlobalDefinition {
  name: string
  description: string
  type: 'variable' | 'function' | 'library'
  properties?: string[] // For libraries/objects, list of available properties
}

export interface ExpressionContext {
  dataKeys: string[] // Keys from upstream data: ['lat', 'lng', 'count']
  globals: GlobalDefinition[] // d, data, op, utils, d3, turf, etc.
  operatorPaths: string[] // Available operator paths for op() autocomplete
}

// Global variables available in expressions
const EXPRESSION_GLOBALS: GlobalDefinition[] = [
  {
    name: 'd',
    description: 'Current data item (first element for ExpressionOp)',
    type: 'variable',
  },
  { name: 'data', description: 'Full data array', type: 'variable' },
  { name: 'op', description: 'Access other operators by path', type: 'function' },
  {
    name: 'utils',
    description: 'Utility functions',
    type: 'library',
    properties: getLibraryProperties(utils),
  },
  {
    name: 'd3',
    description: 'D3.js data manipulation library',
    type: 'library',
    properties: getLibraryProperties(d3),
  },
  {
    name: 'turf',
    description: 'Turf.js geospatial analysis',
    type: 'library',
    properties: getLibraryProperties(turf),
  },
  {
    name: 'deck',
    description: 'Deck.gl utilities',
    type: 'library',
    properties: getLibraryProperties(deck),
  },
  { name: 'Plot', description: 'Observable Plot', type: 'library' },
  { name: 'vega', description: 'Vega visualization grammar', type: 'library' },
  { name: 'Temporal', description: 'TC39 Temporal API for dates', type: 'library' },
]

// Accessor-specific globals (d has different meaning - current row in iteration)
const ACCESSOR_GLOBALS: GlobalDefinition[] = [
  { name: 'd', description: 'Current data row being processed', type: 'variable' },
  { name: 'i', description: 'Current row index', type: 'variable' },
  { name: 'data', description: 'Full data array', type: 'variable' },
  { name: 'op', description: 'Access other operators by path', type: 'function' },
  ...EXPRESSION_GLOBALS.filter(g => !['d', 'data', 'op'].includes(g.name)),
]

// Extract keys from a data object/array
function extractDataKeys(data: unknown): string[] {
  if (!data) return []

  // If it's an array, look at the first item
  const item = Array.isArray(data) ? data[0] : data

  if (!item || typeof item !== 'object') return []

  // Get all keys, including nested ones (one level deep)
  const keys: string[] = []
  for (const [key, value] of Object.entries(item)) {
    keys.push(key)
    // Add nested keys for objects (not arrays)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nestedKey of Object.keys(value)) {
        keys.push(`${key}.${nestedKey}`)
      }
    }
  }

  return keys
}

// Get all available operator paths for op() autocomplete
export function getOperatorPaths(): string[] {
  return getAllOps().map(op => op.id)
}

// Check if an operator is a layer operator (has 'data' input and layer-like outputs)
function isLayerOperator(op: Operator<IOperator>): boolean {
  const displayName = (op.constructor as { displayName?: string }).displayName || ''
  return displayName.includes('Layer') && op.inputs.data !== undefined
}

// Find downstream layer operator that consumes an accessor
// This traces through the graph to find where an AccessorOp's output ends up
function findDownstreamLayerData(
  opId: OpId,
  edges: Edge[],
  visited: Set<OpId> = new Set()
): unknown | null {
  // Prevent infinite recursion on cycles
  if (visited.has(opId)) return null
  visited.add(opId)

  // Find edges where this operator is the source
  const downstreamEdges = edges.filter(e => e.source === opId)

  for (const edge of downstreamEdges) {
    const targetOp = getOp(edge.target)
    if (!targetOp) continue

    // If target is a layer operator, get its data
    if (isLayerOperator(targetOp)) {
      const dataInput = targetOp.inputs.data
      if (dataInput && 'value' in dataInput) {
        return dataInput.value
      }
    }

    // Otherwise, trace further downstream (accessor may go through MapRange, ColorRamp, etc.)
    const result = findDownstreamLayerData(edge.target, edges, visited)
    if (result !== null) return result
  }

  return null
}

// Get expression context for an operator
// Returns available data keys, globals, and operator paths for autocomplete
export function getExpressionContext(operatorId: OpId, edges: Edge[]): ExpressionContext {
  const op = getOp(operatorId)
  if (!op) {
    return {
      dataKeys: [],
      globals: EXPRESSION_GLOBALS,
      operatorPaths: getOperatorPaths(),
    }
  }

  const displayName = (op.constructor as { displayName?: string }).displayName || ''
  let dataKeys: string[] = []
  let globals = EXPRESSION_GLOBALS

  if (displayName === 'Accessor') {
    // AccessorOp: trace downstream to find the layer's data
    globals = ACCESSOR_GLOBALS
    const layerData = findDownstreamLayerData(operatorId, edges)
    dataKeys = extractDataKeys(layerData)
  } else if (displayName === 'Expression' || displayName === 'Code') {
    // ExpressionOp/CodeOp: look at the data input directly
    const dataInput = op.inputs.data
    if (dataInput && 'value' in dataInput) {
      const data = dataInput.value
      // For ListField inputs, the value is an array of connected values
      if (Array.isArray(data) && data.length > 0) {
        // Try the first item - if it's an array, use it; otherwise use data as-is
        const firstItem = data[0]
        if (Array.isArray(firstItem) && firstItem.length > 0) {
          dataKeys = extractDataKeys(firstItem)
        } else {
          dataKeys = extractDataKeys(data)
        }
      } else if (data !== null && data !== undefined) {
        // Handle non-array data
        dataKeys = extractDataKeys(data)
      }
    }
  }

  return {
    dataKeys,
    globals,
    operatorPaths: getOperatorPaths(),
  }
}

// React hook version that can be used in components
// Re-exports the context with stable references
export function useExpressionContext(operatorId: OpId, edges: Edge[]): ExpressionContext {
  // In a real implementation, this would use useMemo and possibly subscribe to changes
  // For now, we compute on demand
  return getExpressionContext(operatorId, edges)
}
