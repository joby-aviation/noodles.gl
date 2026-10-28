import { describe, expect, it } from 'vitest'
import {
  loadStyleSpec,
  propLabel,
  rampAt,
  rampExpression,
  rampFrom,
  scaleNumbers,
  withLayerProp,
  zoomRampOf,
} from './map-style-props'

const ops = new Set(['interpolate', 'step', 'zoom', 'get', 'literal', 'match'])

describe('the style spec', () => {
  it('lists a line layer’s paint and layout properties with their types and ranges', async () => {
    const spec = await loadStyleSpec()
    const props = spec.props('line')
    const width = props.find(p => p.name === 'line-width')
    expect(width).toMatchObject({
      group: 'paint',
      type: 'number',
      minimum: 0,
      units: 'pixels',
      zoom: true,
      interpolated: true,
    })
    expect(props.find(p => p.name === 'line-cap')).toMatchObject({
      group: 'layout',
      type: 'enum',
      values: ['butt', 'round', 'square'],
    })
    expect(props.some(p => p.name === 'visibility')).toBe(false)
    expect(spec.operators.has('interpolate')).toBe(true)
  })

  it('names a property without its layer type', () => {
    expect(propLabel('line-width', 'line')).toBe('width')
    expect(propLabel('text-halo-color', 'symbol')).toBe('text halo color')
  })
})

describe('zoom ramps', () => {
  it('reads interpolate, step and legacy stops over the zoom, and writes them back', () => {
    const linear = ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 4]
    expect(zoomRampOf(linear, ops)).toEqual({
      curve: 'linear',
      base: 1,
      stops: [
        [5, 1],
        [12, 4],
      ],
    })
    expect(rampExpression(zoomRampOf(linear, ops)!)).toEqual(linear)
    const exp = ['interpolate', ['exponential', 1.5], ['zoom'], 5, '#000', 12, '#fff']
    expect(zoomRampOf(exp, ops)).toMatchObject({ curve: 'exponential', base: 1.5 })
    expect(rampExpression(zoomRampOf(exp, ops)!)).toEqual(exp)
    const step = ['step', ['zoom'], 0, 10, 1]
    expect(zoomRampOf(step, ops)).toEqual({
      curve: 'step',
      base: 1,
      stops: [
        [0, 0],
        [10, 1],
      ],
    })
    expect(rampExpression(zoomRampOf(step, ops)!)).toEqual(step)
    expect(
      zoomRampOf(
        {
          base: 1.2,
          stops: [
            [4, 1],
            [10, 3],
          ],
        },
        ops
      )
    ).toEqual({
      curve: 'exponential',
      base: 1.2,
      stops: [
        [4, 1],
        [10, 3],
      ],
    })
  })

  it('leaves data expressions and constants alone', () => {
    expect(
      zoomRampOf(['interpolate', ['linear'], ['get', 'pop'], 0, 1, 10, 2], ops)
    ).toBeUndefined()
    expect(
      zoomRampOf(['interpolate', ['linear'], ['zoom'], 5, ['get', 'w'], 10, 2], ops)
    ).toBeUndefined()
    expect(zoomRampOf({ property: 'pop', stops: [[0, 1]] }, ops)).toBeUndefined()
    expect(zoomRampOf(3, ops)).toBeUndefined()
    // An array of numbers is a constant, not an expression
    expect(zoomRampOf([2, 1], ops)).toBeUndefined()
  })

  it('starts a ramp from a constant, reads a value between stops, and scales numeric stops', () => {
    const ramp = rampFrom(2, true)
    expect(ramp.stops).toEqual([
      [6, 2],
      [16, 2],
    ])
    expect(
      rampAt(
        {
          curve: 'linear',
          base: 1,
          stops: [
            [0, 0],
            [10, 10],
          ],
        },
        4
      )
    ).toBe(4)
    expect(
      rampAt(
        {
          curve: 'step',
          base: 1,
          stops: [
            [0, 0],
            [10, 10],
          ],
        },
        4
      )
    ).toBe(0)
    expect(scaleNumbers(['interpolate', ['linear'], ['zoom'], 5, 1, 12, 4], 2)).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      5,
      2,
      12,
      8,
    ])
    expect(scaleNumbers(3, 2)).toBe(6)
  })
})

describe('changing a layer property', () => {
  it('sets a property, and putting it back drops the layer’s entry when nothing is left', () => {
    const set = withLayerProp({ layers: [], global: {} }, 'roads', 'paint', 'line-width', 3)
    expect(set.layers).toEqual([{ layerId: 'roads', paintOverrides: { 'line-width': 3 } }])
    const both = withLayerProp(set, 'roads', 'layout', 'line-cap', 'round')
    expect(both.layers[0]).toMatchObject({ layoutOverrides: { 'line-cap': 'round' } })
    const back = withLayerProp(
      withLayerProp(both, 'roads', 'layout', 'line-cap', undefined),
      'roads',
      'paint',
      'line-width',
      undefined
    )
    expect(back.layers).toEqual([])
  })
})
