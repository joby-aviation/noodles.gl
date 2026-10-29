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

  it('refuses a stop zoom another stop has', () => {
    const onChange = inspect()
    const box = screen
      .getAllByLabelText('Stop zoom')
      .find(e => (e as HTMLInputElement).value === '5')
    fireEvent.change(box as HTMLElement, { target: { value: '12' } })
    fireEvent.blur(box as HTMLElement)
    expect(onChange).not.toHaveBeenCalled()
    expect((box as HTMLInputElement).value).toBe('5')
  })

  it('switches a ramp to a bezier curve, eased in and out to start', () => {
    const onChange = inspect()
    fireEvent.change(screen.getByLabelText('Curve'), { target: { value: 'bezier' } })
    expect(onChange).toHaveBeenLastCalledWith('paint', 'line-width', [
      'interpolate',
      ['cubic-bezier', 0.42, 0, 0.58, 1],
      ['zoom'],
      5,
      1,
      12,
      4,
    ])
  })

  it('draws a bezier’s handles between every pair of stops, and dragging one reshapes the curve', () => {
    const onChange = vi.fn()
    const bezierRoad = {
      ...road,
      paint: {
        'line-width': [
          'interpolate',
          ['cubic-bezier', 0.42, 0, 0.58, 1],
          ['zoom'],
          5,
          1,
          9,
          3,
          12,
          4,
        ],
      },
    }
    render(
      <LayerInspector
        layer={bezierRoad}
        layerOverride={undefined}
        spec={spec}
        zoom={8}
        onChange={onChange}
      />
    )
    const handles = screen.getAllByLabelText(/Bezier handle/)
    // Two segments, two handles each
    expect(handles).toHaveLength(4)
    expect(document.querySelector('[class*=bezierBox]')).toBeNull()
    const leaving = handles[0]
    const at = leaving.getBoundingClientRect()
    leaving.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: at.x, clientY: at.y })
    )
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: at.x - 1000, clientY: at.y }))
    window.dispatchEvent(new PointerEvent('pointerup', {}))
    const [, , value] = onChange.mock.lastCall as [string, string, unknown[]]
    // Dragged to the segment's start: x1 is 0; the other handle stays
    expect(value[1]).toEqual(['cubic-bezier', 0, expect.any(Number), 0.58, 1])
  })

  it('applies a color and a number as they are typed, once they read as one', () => {
    const onChange = inspect()
    const color = screen.getByDisplayValue('#888888')
    fireEvent.focus(color)
    fireEvent.change(color, { target: { value: 'rgb(255, 0' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(color, { target: { value: 'rgb(255, 0, 0)' } })
    expect(onChange).toHaveBeenLastCalledWith('paint', 'line-color', 'rgb(255, 0, 0)')
    // Still typing: the box keeps what was typed
    expect((color as HTMLInputElement).value).toBe('rgb(255, 0, 0)')
    const stop = screen.getAllByRole('textbox').find(e => (e as HTMLInputElement).value === '4')
    fireEvent.focus(stop as HTMLElement)
    fireEvent.change(stop as HTMLElement, { target: { value: '7' } })
    expect(onChange).toHaveBeenLastCalledWith('paint', 'line-width', [
      'interpolate',
      ['linear'],
      ['zoom'],
      5,
      1,
      12,
      7,
    ])
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
