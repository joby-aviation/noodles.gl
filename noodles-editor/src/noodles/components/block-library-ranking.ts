import type { NodeType } from '../utils/node-creation-utils'
import { getNodeDescription, typeCategory, typeDisplayName } from './op-components'

// Common operators that should be boosted in search results.
// These are operators that users frequently need and should appear higher in results.
const COMMON_OPERATORS_BOOST: Record<string, number> = {
  FileOp: 100,
  NumberOp: 100,
  MathOp: 100,
  ColorOp: 100,
  GeoJsonOp: 100,
  MaplibreBaseMapOp: 80,
  ScatterplotLayerOp: 80,
  ArcLayerOp: 80,
  GeoJsonLayerOp: 80,
  HexagonLayerOp: 80,
}

// Popular operators shown when search is empty.
// Ordered by importance/frequency of use.
export const POPULAR_OPERATORS: NodeType[] = [
  'FileOp',
  'GeoJsonOp',
  'MaplibreBaseMapOp',
  'ScatterplotLayerOp',
  'GeoJsonLayerOp',
  'NumberOp',
  'MathOp',
  'ColorOp',
  'ArcLayerOp',
  'HexagonLayerOp',
]

export interface RankedNodeType {
  type: NodeType
  score: number
}

// Calculate relevance score for a node type based on search term.
//
// Scoring priorities:
// 1. Exact name match (1000 points)
// 2. Partial name match (500 points)
// 3. Starts with search term (250 points)
// 4. Description match (100 points)
// 5. Category match (50 points)
// Plus: Common operator boost (0-100 points)
export function calculateRelevanceScore(
  type: NodeType,
  searchTerm: string
): number {
  const normalizedSearch = searchTerm.toLowerCase().trim()
  if (!normalizedSearch) return 0

  const displayName = typeDisplayName(type)
  const normalizedName = displayName.toLowerCase()
  const description = getNodeDescription(type)?.toLowerCase() || ''
  const category = typeCategory(type).toLowerCase()

  let score = 0

  // 1. Exact name match (highest priority)
  if (normalizedName === normalizedSearch) {
    score += 1000
  }

  // 2. Partial name match
  if (normalizedName.includes(normalizedSearch)) {
    score += 500
  }

  // 3. Starts with search term
  if (normalizedName.startsWith(normalizedSearch)) {
    score += 250
  }

  // 4. Description match
  if (description.includes(normalizedSearch)) {
    score += 100
  }

  // 5. Category match
  if (category.includes(normalizedSearch)) {
    score += 50
  }

  // Add common operator boost
  const boost = COMMON_OPERATORS_BOOST[type] || 0
  score += boost

  return score
}

// Rank node types by relevance to search term.
// Returns sorted array with highest scores first.
export function rankNodeTypes(
  types: NodeType[],
  searchTerm: string
): RankedNodeType[] {
  const ranked = types
    .map(type => ({
      type,
      score: calculateRelevanceScore(type, searchTerm),
    }))
    .filter(item => item.score > 0)

  // Sort by score (descending), then by name length (ascending), then alphabetically
  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    const nameA = typeDisplayName(a.type)
    const nameB = typeDisplayName(b.type)
    if (nameA.length !== nameB.length) {
      return nameA.length - nameB.length
    }
    return nameA.localeCompare(nameB)
  })

  return ranked
}

// Get popular operators that exist in the provided list of types.
// Useful for showing default operators when search is empty.
export function getPopularOperators(availableTypes: NodeType[]): NodeType[] {
  const availableSet = new Set(availableTypes)
  return POPULAR_OPERATORS.filter(type => availableSet.has(type))
}
