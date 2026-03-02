import type { Field } from '../fields'
import { type IOperator, type OpType, type Operator, opTypes } from '../operators'
import { categories, nodeTypeToDisplayName } from '../components/categories'

export interface SuggestedNode {
  opType: OpType
  reason: 'curated' | 'compatible' | 'same-category'
  priority: number
  matchingOutput?: string
}

// Curated high-value suggestions per operator type
// These are hand-picked relationships that represent common workflows
const curatedSuggestions: Partial<Record<OpType, OpType[]>> = {
  // Data sources -> processing
  FileOp: ['FilterOp', 'SliceOp', 'DuckDbOp', 'ScatterplotLayerOp'],
  DuckDbOp: ['FilterOp', 'ScatterplotLayerOp', 'PathLayerOp'],
  NetworkOp: ['FilterOp', 'DuckDbOp'],

  // GeoJSON workflow
  GeoJsonOp: ['GeoJsonLayerOp', 'GeoJsonTransformOp', 'BoundingBoxOp'],
  PointOp: ['GeoJsonOp', 'ScatterplotLayerOp'],
  GeoJsonTransformOp: ['GeoJsonLayerOp', 'BoundingBoxOp'],

  // Layers -> renderer
  ScatterplotLayerOp: ['DeckRendererOp'],
  PathLayerOp: ['DeckRendererOp'],
  GeoJsonLayerOp: ['DeckRendererOp'],
  ArcLayerOp: ['DeckRendererOp'],
  ColumnLayerOp: ['DeckRendererOp'],
  HeatmapLayerOp: ['DeckRendererOp'],
  H3HexagonLayerOp: ['DeckRendererOp'],
  IconLayerOp: ['DeckRendererOp'],
  TextLayerOp: ['DeckRendererOp'],
  PolygonLayerOp: ['DeckRendererOp'],
  LineLayerOp: ['DeckRendererOp'],
  TripsLayerOp: ['DeckRendererOp'],

  // Colors
  ColorOp: ['ColorRampOp'],
  ColorRampOp: ['ScatterplotLayerOp', 'PathLayerOp'],
  HSLOp: ['ColorOp'],

  // Views
  MapViewOp: ['DeckRendererOp', 'MapViewStateOp'],
  GlobeViewOp: ['DeckRendererOp'],
  FirstPersonViewOp: ['DeckRendererOp'],
  OrbitViewOp: ['DeckRendererOp'],

  // Numbers and math
  NumberOp: ['MathOp', 'MapRangeOp', 'ExpressionOp'],
  MathOp: ['NumberOp', 'ExpressionOp'],

  // Data processing chain
  FilterOp: ['SliceOp', 'SortOp', 'ScatterplotLayerOp'],
  SliceOp: ['FilterOp', 'SortOp'],
  SortOp: ['FilterOp', 'SliceOp'],

  // Vectors
  CombineXYOp: ['ScatterplotLayerOp', 'PathLayerOp'],
  CombineXYZOp: ['ScatterplotLayerOp', 'ColumnLayerOp'],
}

// Build type compatibility index at module load time
// Maps output field types to operators that can consume them as inputs
// Cache built lazily on first access. In dev with HMR, new operator types
// won't be picked up without a page reload - acceptable trade-off for perf.
let typeToConsumers: Map<string, Set<OpType>> | null = null

function buildTypeIndex(): Map<string, Set<OpType>> {
  const index = new Map<string, Set<OpType>>()

  for (const [opTypeName, OpClass] of Object.entries(opTypes)) {
    // Skip internal operators
    if (
      opTypeName === 'ForLoopBeginOp' ||
      opTypeName === 'ForLoopEndOp' ||
      opTypeName === 'ForLoopMetaOp' ||
      opTypeName === 'GraphInputOp' ||
      opTypeName === 'GraphOutputOp'
    ) {
      continue
    }

    try {
      // Create temporary instance to inspect inputs
      const tempOp = new OpClass('/temp')
      for (const input of Object.values(tempOp.inputs)) {
        const fieldType = (input.constructor as typeof Field).type
        if (fieldType) {
          if (!index.has(fieldType)) {
            index.set(fieldType, new Set())
          }
          index.get(fieldType)!.add(opTypeName as OpType)
        }
      }
    } catch {
      // Some operators may fail to instantiate without proper context
      // Skip them silently
    }
  }

  return index
}

function getTypeIndex(): Map<string, Set<OpType>> {
  if (!typeToConsumers) {
    typeToConsumers = buildTypeIndex()
  }
  return typeToConsumers
}

// Get the category for an operator type
function getOpCategory(opType: OpType): string | null {
  const displayName = nodeTypeToDisplayName(opType)
  for (const [category, ops] of Object.entries(categories)) {
    if ((ops as readonly string[]).includes(displayName)) {
      return category
    }
  }
  return null
}

// Display names that don't follow the standard `${displayName}Op` naming convention
// ForLoop is a special composite type handled by node-creation-utils, not a regular operator
const SPECIAL_DISPLAY_NAMES = new Set(['ForLoop'])

// Get operators in the same category
function getSameCategoryOps(opType: OpType): OpType[] {
  const category = getOpCategory(opType)
  if (!category) return []

  const categoryOps = categories[category as keyof typeof categories]
  if (!categoryOps) return []

  return (categoryOps as readonly string[])
    .filter(displayName => !SPECIAL_DISPLAY_NAMES.has(displayName))
    .map(displayName => `${displayName}Op` as OpType)
    .filter(type => type !== opType && type in opTypes)
}

/**
 * Get suggested nodes for a given operator.
 * Returns suggestions prioritized by:
 * 1. Curated suggestions (hand-picked, highest quality)
 * 2. Type-compatible operators (can consume this node's outputs)
 * 3. Same-category operators (related by domain)
 */
export function getSuggestedNodes(op: Operator<IOperator>, limit = 6): SuggestedNode[] {
  const suggestions: SuggestedNode[] = []
  const seen = new Set<OpType>()
  const opType = op.constructor.name as OpType

  // Priority 1: Curated suggestions
  const curated = curatedSuggestions[opType]
  if (curated) {
    for (const suggestedType of curated) {
      if (!seen.has(suggestedType) && suggestedType in opTypes) {
        suggestions.push({
          opType: suggestedType,
          reason: 'curated',
          priority: 1,
        })
        seen.add(suggestedType)
      }
    }
  }

  // Priority 2: Type-compatible operators
  const index = getTypeIndex()
  for (const [outputName, outputField] of Object.entries(op.outputs)) {
    const fieldType = (outputField.constructor as typeof Field).type
    if (fieldType) {
      const compatible = index.get(fieldType)
      if (compatible) {
        for (const compatibleType of compatible) {
          if (!seen.has(compatibleType) && compatibleType !== opType) {
            suggestions.push({
              opType: compatibleType,
              reason: 'compatible',
              priority: 2,
              matchingOutput: outputName,
            })
            seen.add(compatibleType)
          }
        }
      }
    }
  }

  // Priority 3: Same category operators
  const sameCategoryOps = getSameCategoryOps(opType)
  for (const categoryOpType of sameCategoryOps) {
    if (!seen.has(categoryOpType)) {
      suggestions.push({
        opType: categoryOpType,
        reason: 'same-category',
        priority: 3,
      })
      seen.add(categoryOpType)
    }
  }

  // Sort by priority and limit
  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, limit)
}
