import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Map as MapLibre } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapToolOverlay } from './map-tool-overlay'
import { useMapToolStore } from './map-tool-store'

// A stand-in for maplibre whose camera maps lng/lat straight to canvas pixels, so a
// click at (x, y) places a vertex at lng x, lat y.
function stubMap() {
  const canvas = document.createElement('canvas')
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '400px',
    height: '300px',
  })
  document.body.appendChild(canvas)
  const map = {
    getCanvas: () => canvas,
    project: ([lng, lat]: [number, number]) => ({ x: lng, y: lat }),
    unproject: ([x, y]: [number, number]) => ({ lng: x, lat: y }),
    on: () => {},
    off: () => {},
  }
  return { mapRef: { current: map as unknown as MapLibre }, canvas }
}

function renderOverlay({ detached = false } = {}) {
  const { mapRef, canvas } = stubMap()
  const onSaveDrawing = vi.fn()
  const onSendDrawing = vi.fn()
  render(
    <div style={{ position: 'fixed', left: 0, top: 0, width: 400, height: 300 }}>
      <MapToolOverlay
        mapRef={mapRef}
        onSaveDrawing={onSaveDrawing}
        onSaveMeasurement={vi.fn()}
        onSendDrawing={onSendDrawing}
        detached={detached}
      />
    </div>
  )
  const surface = document.querySelector('svg')?.parentElement as HTMLElement
  const clickAt = (x: number, y: number) => fireEvent.click(surface, { clientX: x, clientY: y })
  return { canvas, clickAt, onSaveDrawing, onSendDrawing }
}

describe('MapToolOverlay drawing', () => {
  let canvas: HTMLCanvasElement | undefined

  beforeEach(() => {
    useMapToolStore.setState({ activeTool: 'draw', drawMode: 'polygon' })
  })

  afterEach(() => {
    cleanup()
    canvas?.remove()
    useMapToolStore.setState({ activeTool: null })
  })

  it('closes a polygon when the first point is clicked again', () => {
    const overlay = renderOverlay()
    canvas = overlay.canvas
    overlay.clickAt(50, 50)
    overlay.clickAt(150, 50)
    overlay.clickAt(150, 150)
    expect(screen.getByText(/Click the first point/)).toBeTruthy()

    overlay.clickAt(53, 52)
    expect(screen.getByText(/^Polygon · /)).toBeTruthy()
    expect(screen.getByText('Clip data to shape')).toBeTruthy()
  })

  it('turns a finished line into a polygon from the shape list', () => {
    useMapToolStore.setState({ drawMode: 'line' })
    const overlay = renderOverlay()
    canvas = overlay.canvas
    overlay.clickAt(50, 50)
    overlay.clickAt(150, 50)
    overlay.clickAt(150, 150)
    fireEvent.click(screen.getByText('Finish line'))
    expect(screen.getByText(/^Line · /)).toBeTruthy()
    expect(screen.queryByText('Clip data to shape')).toBeNull()

    fireEvent.click(screen.getByLabelText('Close into a polygon'))
    expect(screen.getByText(/^Polygon · /)).toBeTruthy()
    expect(screen.getByText('Clip data to shape')).toBeTruthy()
  })

  it('hands the drawing to the chosen follow-up', () => {
    const overlay = renderOverlay()
    canvas = overlay.canvas
    overlay.clickAt(50, 50)
    overlay.clickAt(150, 50)
    overlay.clickAt(150, 150)
    fireEvent.click(screen.getByText('Close shape'))
    fireEvent.click(screen.getByText('Find points inside'))

    expect(overlay.onSendDrawing).toHaveBeenCalledTimes(1)
    const [followUp, features] = overlay.onSendDrawing.mock.calls[0]
    expect(followUp.recipeId).toBe('point-in-polygon')
    expect(features[0].geometry.type).toBe('Polygon')
    expect(useMapToolStore.getState().activeTool).toBeNull()
  })

  it('pins the click surface above the graph when the map is drawn behind it', () => {
    const overlay = renderOverlay({ detached: true })
    canvas = overlay.canvas
    const surface = document.querySelector('svg')?.parentElement as HTMLElement
    expect(surface.parentElement).toBe(document.body)
    expect(surface.style.width).toBe('400px')
    expect(surface.style.height).toBe('300px')

    overlay.clickAt(50, 50)
    overlay.clickAt(150, 50)
    overlay.clickAt(150, 150)
    overlay.clickAt(52, 51)
    expect(screen.getByText(/^Polygon · /)).toBeTruthy()
  })

  it('says so when the clipboard refuses the copy', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)
    const overlay = renderOverlay()
    canvas = overlay.canvas
    overlay.clickAt(50, 50)
    overlay.clickAt(150, 50)
    overlay.clickAt(150, 150)
    fireEvent.click(screen.getByText('Close shape'))
    fireEvent.click(screen.getByText('Copy GeoJSON'))
    await act(async () => {})
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Copy failed/)).toBeTruthy()
    vi.restoreAllMocks()
  })
})
