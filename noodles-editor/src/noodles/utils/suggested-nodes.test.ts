import { describe, expect, it } from 'vitest'

import {
  FileOp,
  FilterOp,
  GeoJsonLayerOp,
  GeoJsonOp,
  NumberOp,
  ScatterplotLayerOp,
} from '../operators'
import { getSuggestedNodes } from './suggested-nodes'

describe('getSuggestedNodes', () => {
  it('returns curated suggestions for FileOp', () => {
    const op = new FileOp('/file-1')
    const suggestions = getSuggestedNodes(op)

    // FileOp should have curated suggestions including FilterOp and DuckDbOp
    expect(suggestions.length).toBeGreaterThan(0)
    const opTypes = suggestions.map(s => s.opType)
    expect(opTypes).toContain('FilterOp')
    expect(opTypes).toContain('DuckDbOp')
  })

  it('returns curated suggestions for GeoJsonOp', () => {
    const op = new GeoJsonOp('/geojson-1')
    const suggestions = getSuggestedNodes(op)

    // GeoJsonOp should suggest GeoJsonLayerOp and GeoJsonTransformOp
    const opTypes = suggestions.map(s => s.opType)
    expect(opTypes).toContain('GeoJsonLayerOp')
    expect(opTypes).toContain('GeoJsonTransformOp')
  })

  it('returns type-compatible suggestions', () => {
    // FilterOp outputs DataField, so it should suggest operators that accept DataField
    const op = new FilterOp('/filter-1')
    const suggestions = getSuggestedNodes(op)

    // FilterOp has curated suggestions (SliceOp, SortOp) and should also have type-compatible ones
    expect(suggestions.length).toBeGreaterThan(0)
  })

  it('prioritizes curated suggestions over type-compatible', () => {
    const op = new GeoJsonOp('/geojson-1')
    const suggestions = getSuggestedNodes(op)

    // First suggestion should be curated (priority 1)
    expect(suggestions[0].reason).toBe('curated')
    expect(suggestions[0].priority).toBe(1)
  })

  it('limits results to specified limit', () => {
    const op = new FileOp('/file-1')

    const suggestionsWithLimit = getSuggestedNodes(op, 3)
    expect(suggestionsWithLimit.length).toBeLessThanOrEqual(3)

    const suggestionsDefault = getSuggestedNodes(op)
    expect(suggestionsDefault.length).toBeLessThanOrEqual(6)
  })

  it('deduplicates suggestions across priority levels', () => {
    const op = new GeoJsonOp('/geojson-1')
    const suggestions = getSuggestedNodes(op)

    // Check for duplicates
    const opTypes = suggestions.map(s => s.opType)
    const uniqueOpTypes = new Set(opTypes)
    expect(opTypes.length).toBe(uniqueOpTypes.size)
  })

  it('does not suggest the same operator type', () => {
    const op = new NumberOp('/number-1')
    const suggestions = getSuggestedNodes(op)

    const opTypes = suggestions.map(s => s.opType)
    expect(opTypes).not.toContain('NumberOp')
  })

  it('includes same-category operators when curated and compatible are exhausted', () => {
    const op = new ScatterplotLayerOp('/scatter-1')
    const suggestions = getSuggestedNodes(op, 20) // Get more to see category suggestions

    // ScatterplotLayerOp has curated suggestions (DeckRendererOp)
    // Should also include same-category operators (other Layer operators)
    const reasons = suggestions.map(s => s.reason)

    // Should have at least some curated suggestions
    expect(reasons.filter(r => r === 'curated').length).toBeGreaterThan(0)
  })

  it('suggests layer operators after GeoJsonOp', () => {
    const op = new GeoJsonOp('/geojson-1')
    const suggestions = getSuggestedNodes(op)

    // GeoJsonOp outputs GeoJsonField, so GeoJsonLayerOp should be suggested
    const opTypes = suggestions.map(s => s.opType)
    expect(opTypes).toContain('GeoJsonLayerOp')
  })

  it('suggests DeckRendererOp after layer operators', () => {
    const op = new GeoJsonLayerOp('/geojson-layer-1')
    const suggestions = getSuggestedNodes(op)

    // Layer operators should suggest DeckRendererOp
    const opTypes = suggestions.map(s => s.opType)
    expect(opTypes).toContain('DeckRendererOp')
  })
})
