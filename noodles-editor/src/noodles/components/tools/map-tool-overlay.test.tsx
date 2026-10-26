import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Map as MapLibre } from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type EditSession, MapToolOverlay } from './map-tool-overlay'
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

function renderOverlay({
  detached = false,
  editSession = null,
  onSaveEdits = vi.fn(() => true),
}: {
  detached?: boolean
  editSession?: EditSession | null
  onSaveEdits?: ReturnType<typeof vi.fn>
} = {}) {
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
        editSession={editSession}
        onSaveEdits={onSaveEdits}
      />
    </div>
  )
  const surface = document.querySelector('svg')?.parentElement as HTMLElement
  const clickAt = (x: number, y: number) => fireEvent.click(surface, { clientX: x, clientY: y })
  return { canvas, clickAt, surface, onSaveDrawing, onSendDrawing, onSaveEdits }
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

  it('drags a vertex of an existing GeoEditor shape and saves it back', () => {
    const session: EditSession = {
      opId: '/geo-editor',
      kind: 'geo-editor',
      label: 'geo-editor',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [50, 50],
                [150, 50],
                [150, 150],
                [50, 50],
              ],
            ],
          },
          properties: { name: 'zone' },
        },
      ],
    }
    useMapToolStore.setState({ editTarget: session })
    const overlay = renderOverlay({ editSession: session })
    canvas = overlay.canvas
    expect(screen.getByText('Editing geo-editor')).toBeTruthy()
    const save = screen.getByText(/Save to geo-editor/).closest('button') as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.mouseDown(overlay.surface, { clientX: 151, clientY: 151, button: 0 })
    fireEvent.mouseMove(window, { clientX: 200, clientY: 180 })
    fireEvent.mouseUp(window, { clientX: 200, clientY: 180 })
    // The click that ends a drag must not start a new shape
    overlay.clickAt(200, 180)
    expect(screen.queryByText(/Add 2 more points/)).toBeNull()

    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    const [target, features] = overlay.onSaveEdits.mock.calls[0]
    expect(target.opId).toBe('/geo-editor')
    expect(features).toHaveLength(1)
    expect(features[0].properties).toEqual({ name: 'zone' })
    expect(features[0].geometry.coordinates[0]).toEqual([
      [50, 50],
      [150, 50],
      [200, 180],
      [50, 50],
    ])
  })

  it('moves a Point node to wherever the map is clicked', () => {
    const session: EditSession = {
      opId: '/point',
      kind: 'point',
      label: 'point',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 10] }, properties: {} },
      ],
    }
    useMapToolStore.setState({ drawMode: 'point', editTarget: session })
    const overlay = renderOverlay({ editSession: session })
    canvas = overlay.canvas
    expect(screen.queryByText('Polygon')).toBeNull()
    overlay.clickAt(120, 90)
    overlay.clickAt(300, 200)
    expect(screen.getAllByText('Point')).toHaveLength(1)
    fireEvent.click(screen.getByText(/Save to point/))
    const [, features] = overlay.onSaveEdits.mock.calls[0]
    expect(features).toEqual([
      { type: 'Feature', geometry: { type: 'Point', coordinates: [300, 200] }, properties: {} },
    ])
  })
})
