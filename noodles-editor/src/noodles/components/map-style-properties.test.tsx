import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadStyleSpec, type StyleSpec } from '../../utils/map-style-props'
import { LayerInspector } from './map-style-properties'

let spec: StyleSpec
beforeAll(async () => {
  spec = await loadStyleSpec()
})
afterEach(() => cleanup())

const road = {
  id: 'roads',
  type: 'line',
  paint: {
    'line-color': '#888888',
    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 4],
  },
  layout: { 'line-cap': 'round' },
}

const inspect = (layerOverride?: Parameters<typeof LayerInspector>[0]['layerOverride']) => {
  const onChange = vi.fn()
  render(
    <LayerInspector
      layer={road}
      layerOverride={layerOverride}
      spec={spec}
      zoom={8}
      onChange={onChange}
    />
  )
  return onChange
}

describe('the layer inspector', () => {
  it('lists what the style sets first, by group, and folds the rest away', () => {
    inspect()
    expect(screen.getByText('paint')).toBeTruthy()
    expect(screen.getByText('layout')).toBeTruthy()
    expect(screen.getByText(/Other properties/)).toBeTruthy()
    expect(screen.getByDisplayValue('round')).toBeTruthy()
  })

  it('edits a zoom ramp stop, and adds a stop at the preview’s zoom', () => {
    const onChange = inspect()
    const box = screen.getAllByRole('textbox').find(e => (e as HTMLInputElement).value === '4')
    fireEvent.change(box as HTMLElement, { target: { value: '6' } })
    fireEvent.blur(box as HTMLElement)
    expect(onChange).toHaveBeenLastCalledWith('paint', 'line-width', [
      'interpolate',
      ['linear'],
      ['zoom'],
      5,
      1,
      12,
      6,
    ])
    fireEvent.click(screen.getByText('+ Stop at zoom 8'))
    const [, , ramp] = onChange.mock.lastCall as [string, string, unknown[]]
    expect(ramp.slice(3)).toEqual([5, 1, 8, 1 + (3 * 3) / 7, 12, 4])
  })

  it('makes a constant follow the zoom, and puts a changed value back', () => {
    const onChange = inspect({ layerId: 'roads', paintOverrides: { 'line-opacity': 0.5 } })
    fireEvent.click(screen.getByLabelText('opacity: by zoom'))
    expect(onChange).toHaveBeenLastCalledWith('paint', 'line-opacity', [
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      0.5,
      16,
      0.5,
    ])
    fireEvent.click(screen.getByLabelText('opacity: reset'))
    expect(onChange).toHaveBeenLastCalledWith('paint', 'line-opacity', undefined)
  })
})
