import { describe, expect, it } from 'vitest'
import { CompoundPropsField, DataField, LayerField, NumberField } from '../fields'
import { CodeOp } from '../operators'
import { getFieldDocs, humanizeFieldName, LAYER_FIELD_DOCS } from './field-docs'

describe('humanizeFieldName', () => {
  it.each([
    ['opacity', 'Opacity'],
    ['widthUnits', 'Width units'],
    ['getSourcePosition', 'Source position'],
    ['getS2Token', 'S2 token'],
    ['tilesetUrl', 'Tileset URL'],
    ['gpuAggregation', 'GPU aggregation'],
    ['_full3d', 'Full 3D'],
    ['max_width', 'Max width'],
    ['URLPath', 'URL path'],
    ['geojson', 'GeoJSON'],
    ['inputGeojson', 'Input GeoJSON'],
    ['kml', 'KML'],
    // Object.prototype keys must not be read as special-cased words
    ['constructor', 'Constructor'],
    ['toString', 'To string'],
    ['__proto__', 'Proto'],
    ['get', 'Get'],
    ['val', 'Val'],
  ])('%s -> %s', (name, label) => {
    expect(humanizeFieldName(name)).toBe(label)
  })
})

// Stand-ins for a layer operator and another operator: only their outputs matter here
const arcLayer = { outputs: { layer: new LayerField() } }
const number = { outputs: { val: new NumberField(0) } }

describe('getFieldDocs', () => {
  it('uses the label and description declared on the field', () => {
    const field = new NumberField(1, { label: 'Line thickness', description: 'How wide.' })
    expect(getFieldDocs('getWidth', field, arcLayer)).toEqual({
      label: 'Line thickness',
      description: 'How wide.',
    })
  })

  it('accepts docs on fields whose constructor takes a subfield first', () => {
    const field = new DataField(undefined, { label: 'Rows', description: 'Input rows.' })
    expect(getFieldDocs('data', field)).toEqual({ label: 'Rows', description: 'Input rows.' })
  })

  it('falls back to the shared deck.gl prop docs on layer operators', () => {
    expect(getFieldDocs('getSourcePosition', new DataField(), arcLayer)).toEqual({
      label: 'Source position',
      description: LAYER_FIELD_DOCS.getSourcePosition.description,
    })
    expect(getFieldDocs('parameters', new CompoundPropsField({}), arcLayer).label).toBe(
      'Render parameters'
    )
  })

  it('does not apply layer prop docs to other operators', () => {
    expect(getFieldDocs('data', new NumberField(1), number)).toEqual({
      label: 'Data',
      description: undefined,
    })
    expect(getFieldDocs('opacity', new NumberField(1), number).description).toBeUndefined()
  })

  it('shows user-named custom fields as typed', () => {
    const op = new CodeOp('/code')
    op.addCustomInput({ id: 'a', name: 'maxSpeed', type: 'number', order: 0, defaultValue: 5 })
    expect(getFieldDocs('maxSpeed', op.getAllInputs().maxSpeed, op).label).toBe('maxSpeed')
  })

  it('ignores inherited keys when looking up layer prop docs', () => {
    expect(getFieldDocs('constructor', new NumberField(1), arcLayer)).toEqual({
      label: 'Constructor',
      description: undefined,
    })
  })

  it('humanizes the key when nothing else applies', () => {
    expect(getFieldDocs('elevationScale', new NumberField(1))).toEqual({
      label: 'Elevation scale',
      description: undefined,
    })
  })
})
