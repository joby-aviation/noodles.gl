import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LayerRow } from './map-style-configurator'

const layer = { id: 'water', type: 'fill', paint: { 'fill-color': '#00f' } } as never

describe('LayerRow visibility toggle', () => {
  afterEach(() => cleanup())

  it('hides a visible layer', () => {
    const onVisibilityChange = vi.fn()
    render(
      <LayerRow
        layer={layer}
        layerOverride={undefined}
        onVisibilityChange={onVisibilityChange}
        onColorChange={() => {}}
      />
    )
    fireEvent.click(screen.getByTitle('Hide layer'))
    expect(onVisibilityChange).toHaveBeenCalledWith(false)
  })

  it('shows a hidden layer', () => {
    const onVisibilityChange = vi.fn()
    render(
      <LayerRow
        layer={layer}
        layerOverride={{ layerId: 'water', layoutOverrides: { visibility: 'none' } }}
        onVisibilityChange={onVisibilityChange}
        onColorChange={() => {}}
      />
    )
    fireEvent.click(screen.getByTitle('Show layer'))
    expect(onVisibilityChange).toHaveBeenCalledWith(true)
  })
})
