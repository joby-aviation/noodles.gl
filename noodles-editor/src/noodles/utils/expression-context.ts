// Expression Context - Utilities for determining available variables and data keys
// for autocomplete in ExpressionOp and AccessorOp

import * as turf from '@turf/turf'
import * as d3 from 'd3'
import * as deck from 'deck.gl'
import * as utils from '../../utils'
import type { Edge } from '../graph-executor'
import type { IOperator, Operator } from '../operators'
import { getAllOps, getOp } from '../store'
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

// Information about the target field an accessor is connected to
export interface TargetFieldInfo {
  name: string // e.g., "getPosition", "getFillColor", "getRadius"
  fieldType: string // e.g., "geopoint-3d", "color", "number"
  returnType?: 'object' | 'tuple' // For point/vec fields
}

export interface ExpressionContext {
  dataKeys: string[] // Keys from upstream data: ['lat', 'lng', 'count']
  globals: GlobalDefinition[] // d, data, op, utils, d3, turf, etc.
  operatorPaths: string[] // Available operator paths for op() autocomplete
  targetField?: TargetFieldInfo // For AccessorOp: info about the field it connects to
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

// Result from tracing downstream to find where an accessor connects
interface DownstreamTarget {
  layerData: unknown | null // The layer's data for extracting keys
  targetField: TargetFieldInfo | null // Info about the field the accessor connects to
}

// Get field type info from a field instance
function getFieldTypeInfo(field: unknown): { fieldType: string; returnType?: 'object' | 'tuple' } {
  if (!field || typeof field !== 'object') {
    return { fieldType: 'unknown' }
  }

  // Get static type from the field's constructor
  const fieldConstructor = field.constructor as { type?: string }
  const fieldType = fieldConstructor.type || 'unknown'

  // Get returnType if it exists (for Point/Vec fields)
  const returnType =
    'returnType' in field ? (field as { returnType?: 'object' | 'tuple' }).returnType : undefined

  return { fieldType, returnType }
}

// Find downstream target for an accessor
// Returns both the layer data (for key extraction) and the target field info (for type-aware completions)
function findDownstreamTarget(
  opId: OpId,
  edges: Edge[],
  visited: Set<OpId> = new Set(),
  firstHopField: TargetFieldInfo | null = null
): DownstreamTarget {
  // Prevent infinite recursion on cycles
  if (visited.has(opId)) return { layerData: null, targetField: firstHopField }
  visited.add(opId)

  // Find edges where this operator is the source
  const downstreamEdges = edges.filter(e => e.source === opId)

  for (const edge of downstreamEdges) {
    const targetOp = getOp(edge.target)
    if (!targetOp) continue

    // Parse targetHandle to get field name: "par.getPosition" -> "getPosition"
    const handleParts = edge.targetHandle?.split('.') || []
    let currentFieldInfo = firstHopField

    // On first hop, capture the target field info
    if (!firstHopField && handleParts.length >= 2 && handleParts[0] === 'par') {
      const fieldName = handleParts[1]
      const targetInput = targetOp.inputs[fieldName]

      if (targetInput) {
        const { fieldType, returnType } = getFieldTypeInfo(targetInput)
        currentFieldInfo = { name: fieldName, fieldType, returnType }
      }
    }

    // If target is a layer operator, get its data and return
    if (isLayerOperator(targetOp)) {
      const dataInput = targetOp.inputs.data
      const layerData = dataInput && 'value' in dataInput ? dataInput.value : null
      return { layerData, targetField: currentFieldInfo }
    }

    // Otherwise, trace further downstream (accessor may go through MapRange, ColorRamp, etc.)
    // Preserve the first-hop field info for type awareness
    const result = findDownstreamTarget(edge.target, edges, visited, currentFieldInfo)
    if (result.layerData !== null || result.targetField !== null) {
      return result
    }
  }

  return { layerData: null, targetField: firstHopField }
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

  let targetField: TargetFieldInfo | undefined

  if (displayName === 'Accessor') {
    // AccessorOp: trace downstream to find the layer's data and target field
    globals = ACCESSOR_GLOBALS
    const { layerData, targetField: fieldInfo } = findDownstreamTarget(operatorId, edges)
    dataKeys = extractDataKeys(layerData)
    targetField = fieldInfo || undefined
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
    targetField,
  }
}

// React hook version that can be used in components
// Re-exports the context with stable references
export function useExpressionContext(operatorId: OpId, edges: Edge[]): ExpressionContext {
  // In a real implementation, this would use useMemo and possibly subscribe to changes
  // For now, we compute on demand
  return getExpressionContext(operatorId, edges)
}
