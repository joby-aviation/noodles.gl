import { describe, expect, it } from 'vitest'
import { DataField, NumberField } from '../fields'
import { ArcLayerOp, CodeOp, NumberOp } from '../operators'
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
    ['get', 'Get'],
    ['val', 'Val'],
  ])('%s -> %s', (name, label) => {
    expect(humanizeFieldName(name)).toBe(label)
  })
})

describe('getFieldDocs', () => {
  it('uses the label and description declared on the field', () => {
    const field = new NumberField(1, { label: 'Line thickness', description: 'How wide.' })
    expect(getFieldDocs('getWidth', field, new ArcLayerOp('/arc'))).toEqual({
      label: 'Line thickness',
      description: 'How wide.',
    })
  })

  it('accepts docs on fields whose constructor takes a subfield first', () => {
    const field = new DataField(undefined, { label: 'Rows', description: 'Input rows.' })
    expect(getFieldDocs('data', field)).toEqual({ label: 'Rows', description: 'Input rows.' })
  })

  it('falls back to the shared deck.gl prop docs on layer operators', () => {
    const op = new ArcLayerOp('/arc')
    expect(getFieldDocs('getSourcePosition', op.inputs.getSourcePosition, op)).toEqual({
      label: 'Source position',
      description: LAYER_FIELD_DOCS.getSourcePosition.description,
    })
    expect(getFieldDocs('parameters', op.inputs.parameters, op).label).toBe('Render parameters')
  })

  it('does not apply layer prop docs to other operators', () => {
    const op = new NumberOp('/num')
    expect(getFieldDocs('val', op.inputs.val, op)).toEqual({ label: 'Val', description: undefined })
    expect(getFieldDocs('opacity', new NumberField(1), op).description).toBeUndefined()
  })

  it('shows user-named custom fields as typed', () => {
    const op = new CodeOp('/code')
    op.addCustomInput({ id: 'a', name: 'maxSpeed', type: 'number', order: 0, defaultValue: 5 })
    expect(getFieldDocs('maxSpeed', op.getAllInputs().maxSpeed, op).label).toBe('maxSpeed')
  })

  it('humanizes the key when nothing else applies', () => {
    expect(getFieldDocs('elevationScale', new NumberField(1))).toEqual({
      label: 'Elevation scale',
      description: undefined,
    })
  })
})
