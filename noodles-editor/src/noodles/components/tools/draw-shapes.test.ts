import { describe, expect, it } from 'vitest'
import {
  buildShape,
  closeIntoPolygon,
  DRAW_FOLLOW_UPS,
  describeShape,
  featuresFor,
  followUpsFor,
  openIntoLine,
} from './draw-shapes'
import { getRecipe } from './geo-recipes'

const a = { lng: 0, lat: 0 }
const b = { lng: 1, lat: 0 }
const c = { lng: 1, lat: 1 }

const point = buildShape([a], 'point') as GeoJSON.Feature
const line = buildShape([a, b, c], 'line') as GeoJSON.Feature
const polygon = buildShape([a, b, c], 'polygon') as GeoJSON.Feature

describe('buildShape', () => {
  it('needs enough points for the kind of shape', () => {
    expect(buildShape([], 'point')).toBeNull()
    expect(buildShape([a], 'line')).toBeNull()
    expect(buildShape([a, b], 'polygon')).toBeNull()
  })

  it('closes polygon rings by repeating the first vertex', () => {
    expect(polygon.geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    })
  })
})

describe('closeIntoPolygon', () => {
  it('joins the ends of a line', () => {
    expect(closeIntoPolygon(line)?.geometry).toEqual(polygon.geometry)
  })

  it('does not double the closing vertex of a line that already ends at its start', () => {
    const looped = openIntoLine(polygon) as GeoJSON.Feature
    expect(closeIntoPolygon(looped)?.geometry).toEqual(polygon.geometry)
  })

  it('refuses lines too short to enclose an area', () => {
    expect(closeIntoPolygon(buildShape([a, b], 'line') as GeoJSON.Feature)).toBeNull()
    expect(closeIntoPolygon(polygon)).toBeNull()
  })

  it('keeps the feature properties', () => {
    const named = { ...line, properties: { name: 'route' } }
    expect(closeIntoPolygon(named)?.properties).toEqual({ name: 'route' })
  })
})

describe('openIntoLine', () => {
  it('turns a polygon into its closed outline', () => {
    expect(openIntoLine(polygon)?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    })
  })

  it('ignores anything that is not a polygon', () => {
    expect(openIntoLine(line)).toBeNull()
  })
})

describe('describeShape', () => {
  it('names the shape and its size', () => {
    expect(describeShape(point)).toBe('Point')
    expect(describeShape(line)).toMatch(/^Line · .*km$/)
    expect(describeShape(polygon)).toMatch(/^Polygon · .*km²$/)
  })
})

describe('follow-ups', () => {
  it('only offers polygon follow-ups when a polygon was drawn', () => {
    expect(followUpsFor([line]).map(f => f.id)).toEqual(['along', 'buffer'])
    expect(followUpsFor([polygon]).map(f => f.id)).toEqual(['clip', 'points-inside', 'buffer'])
    expect(followUpsFor([point]).map(f => f.id)).toEqual(['buffer'])
    expect(followUpsFor([])).toEqual([])
  })

  it('passes a recipe only the geometry it reads', () => {
    const clip = DRAW_FOLLOW_UPS.find(f => f.id === 'clip')
    if (!clip) throw new Error('missing clip follow-up')
    expect(featuresFor(clip, [line, polygon, point])).toEqual([polygon])
  })

  it('merges several polygons into one boundary for recipes that read one feature', () => {
    const clip = DRAW_FOLLOW_UPS.find(f => f.id === 'clip')
    const buffer = DRAW_FOLLOW_UPS.find(f => f.id === 'buffer')
    if (!clip || !buffer) throw new Error('missing follow-up')
    const far = buildShape(
      [
        { lng: 10, lat: 10 },
        { lng: 11, lat: 10 },
        { lng: 11, lat: 11 },
      ],
      'polygon'
    ) as GeoJSON.Feature
    const merged = featuresFor(clip, [polygon, far])
    expect(merged).toHaveLength(1)
    expect(merged[0].geometry.type).toBe('MultiPolygon')
    expect(featuresFor(buffer, [polygon, far])).toHaveLength(2)
  })

  it('wires each drawing into an input its recipe really has', () => {
    for (const followUp of DRAW_FOLLOW_UPS) {
      const recipe = getRecipe(followUp.recipeId)
      expect(recipe, followUp.recipeId).toBeDefined()
      expect(recipe?.inputs.map(i => i.key)).toContain(followUp.shapeInput)
    }
  })
})
