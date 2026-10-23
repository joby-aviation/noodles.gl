import { describe, expect, it } from 'vitest'
import { opTypes } from '../../operators'
import {
  decodeSourceRef,
  defaultValuesFor,
  encodeSourceRef,
  GEO_RECIPES,
  GROUP_LABELS,
  getRecipe,
  RECIPES_BY_GROUP,
} from './geo-recipes'

describe('geo recipes', () => {
  it('references only registered operator types', () => {
    for (const recipe of GEO_RECIPES) {
      expect(opTypes, `${recipe.id} -> ${recipe.opType}`).toHaveProperty(recipe.opType)
    }
  })

  it('declares inputs and outputs that exist on the operator', () => {
    for (const recipe of GEO_RECIPES) {
      const OpClass = opTypes[recipe.opType]
      const op = new OpClass(`/test-${recipe.id}`)
      for (const input of recipe.inputs) {
        expect(op.inputs, `${recipe.id}.${input.key}`).toHaveProperty(input.key)
      }
      for (const param of recipe.params) {
        expect(op.inputs, `${recipe.id}.${param.key}`).toHaveProperty(param.key)
      }
      expect(op.outputs, `${recipe.id} -> ${recipe.output}`).toHaveProperty(recipe.output)
    }
  })

  it('has unique ids and a label for every group', () => {
    const ids = GEO_RECIPES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const recipe of GEO_RECIPES) {
      expect(GROUP_LABELS[recipe.group]).toBeTruthy()
    }
  })

  it('groups every recipe exactly once', () => {
    const grouped = RECIPES_BY_GROUP.flatMap(g => g.recipes)
    expect(grouped).toHaveLength(GEO_RECIPES.length)
  })

  it('looks recipes up by id', () => {
    expect(getRecipe('buffer')?.opType).toBe('BufferOp')
    expect(getRecipe('nope')).toBeUndefined()
  })

  it('collects parameter defaults', () => {
    expect(defaultValuesFor(getRecipe('buffer')!)).toEqual({ radius: 1, units: 'kilometers' })
    expect(defaultValuesFor(getRecipe('centroid')!)).toEqual({})
  })
})

describe('source refs', () => {
  it('round-trips a nested node path', () => {
    const ref = { source: '/container/data', sourceHandle: 'out.featureCollection' }
    expect(decodeSourceRef(encodeSourceRef(ref))).toEqual(ref)
  })

  it('rejects malformed values', () => {
    expect(decodeSourceRef('')).toBeNull()
    expect(decodeSourceRef('no-separator')).toBeNull()
    expect(decodeSourceRef('|out.data')).toBeNull()
  })
})
