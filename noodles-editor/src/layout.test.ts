import { describe, expect, it } from 'vitest'
import { mapPaneMode } from './layout'

describe('mapPaneMode', () => {
  it('draws the map behind the graph once a Graph area shows, with or without a Map area', () => {
    expect(mapPaneMode('underlay', true, true)).toBe('underlay')
    expect(mapPaneMode('underlay', false, true)).toBe('underlay')
  })

  it('floats the map with no area to sit in', () => {
    expect(mapPaneMode('underlay', false, false)).toBe('floating')
    expect(mapPaneMode('docked', false, true)).toBe('floating')
    expect(mapPaneMode('floating', true, true)).toBe('floating')
  })

  it('docks the map in its area otherwise', () => {
    expect(mapPaneMode('docked', true, false)).toBe('docked')
    expect(mapPaneMode('underlay', true, false)).toBe('docked')
  })
})
