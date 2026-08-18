import { describe, expect, it } from 'vitest'
import { type Box, clientToMapPoint, mapPointToOverlay, type Point } from './overlay-coords'

// A map filling a 800x600 pane at the top-left of the window, no scaling
const simpleRect: Box = { left: 0, top: 0, width: 800, height: 600 }
const simpleSize = { width: 800, height: 600 }

describe('clientToMapPoint', () => {
  it('is the identity for an unscaled map at the window origin', () => {
    expect(clientToMapPoint({ x: 100, y: 200 }, simpleRect, simpleSize)).toEqual({ x: 100, y: 200 })
  })

  it('subtracts the pane offset, which is what split view introduces', () => {
    // Pane pushed right by a 300px sidebar and down by a 40px menu bar
    const rect: Box = { left: 300, top: 40, width: 800, height: 600 }
    expect(clientToMapPoint({ x: 400, y: 140 }, rect, simpleSize)).toEqual({ x: 100, y: 100 })
  })

  it('undoes a CSS scale applied to an ancestor', () => {
    // A 800x600 canvas displayed at half size
    const rect: Box = { left: 0, top: 0, width: 400, height: 300 }
    expect(clientToMapPoint({ x: 200, y: 150 }, rect, simpleSize)).toEqual({ x: 400, y: 300 })
  })

  it('handles a non-uniform scale on each axis independently', () => {
    const rect: Box = { left: 0, top: 0, width: 400, height: 600 }
    expect(clientToMapPoint({ x: 200, y: 300 }, rect, simpleSize)).toEqual({ x: 400, y: 300 })
  })

  it('returns null for a collapsed pane rather than dividing by zero', () => {
    expect(clientToMapPoint({ x: 0, y: 0 }, { ...simpleRect, width: 0 }, simpleSize)).toBeNull()
    expect(clientToMapPoint({ x: 0, y: 0 }, { ...simpleRect, height: 0 }, simpleSize)).toBeNull()
  })
})

describe('mapPointToOverlay', () => {
  it('is the identity when canvas and overlay share an unscaled box', () => {
    const result = mapPointToOverlay(
      { x: 100, y: 200 },
      simpleRect,
      simpleSize,
      simpleRect,
      simpleSize
    )
    expect(result).toEqual({ x: 100, y: 200 })
  })

  it('round-trips with clientToMapPoint under scale and offset', () => {
    // Half-scale pane offset by a sidebar, overlay sharing the map's box
    const rect: Box = { left: 300, top: 40, width: 400, height: 300 }
    const client: Point = { x: 500, y: 190 }
    const mapPoint = clientToMapPoint(client, rect, simpleSize)
    expect(mapPoint).not.toBeNull()
    const back = mapPointToOverlay(mapPoint!, rect, simpleSize, rect, {
      width: 800,
      height: 600,
    })
    // Overlay layout space is the unscaled 800x600, so the result is the map point
    expect(back!.x).toBeCloseTo(mapPoint!.x, 6)
    expect(back!.y).toBeCloseTo(mapPoint!.y, 6)
  })

  it('places geometry correctly when the map is letterboxed inside a larger overlay', () => {
    // Fixed display mode: a 400x300 map centred in an 800x600 pane
    const canvasRect: Box = { left: 200, top: 150, width: 400, height: 300 }
    const canvasSize = { width: 400, height: 300 }
    const overlayRect: Box = { left: 0, top: 0, width: 800, height: 600 }
    // The map's top-left corner sits 200,150 into the overlay
    const corner = mapPointToOverlay({ x: 0, y: 0 }, canvasRect, canvasSize, overlayRect, {
      width: 800,
      height: 600,
    })
    expect(corner).toEqual({ x: 200, y: 150 })
    // And its centre sits at the overlay centre
    const centre = mapPointToOverlay({ x: 200, y: 150 }, canvasRect, canvasSize, overlayRect, {
      width: 800,
      height: 600,
    })
    expect(centre).toEqual({ x: 400, y: 300 })
  })

  it('returns null for a zero-sized canvas or overlay', () => {
    const zero = { width: 0, height: 0 }
    expect(mapPointToOverlay({ x: 0, y: 0 }, simpleRect, zero, simpleRect, simpleSize)).toBeNull()
    expect(
      mapPointToOverlay(
        { x: 0, y: 0 },
        simpleRect,
        simpleSize,
        { ...simpleRect, width: 0 },
        simpleSize
      )
    ).toBeNull()
  })
})
