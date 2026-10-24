import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../utils/analytics'
import {
  createPanelVisibilityTracker,
  resetMapInteractionTracking,
  trackDeckInteraction,
  trackMapLibreGesture,
} from './editor-analytics'

vi.mock('../../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

const track = vi.mocked(analytics.track)

describe('map_interacted', () => {
  beforeEach(() => {
    track.mockClear()
    resetMapInteractionTracking()
  })

  it('sends each kind once per page load', () => {
    trackDeckInteraction({ isPanning: true })
    trackDeckInteraction({ isPanning: true })
    trackDeckInteraction({ isZooming: true })
    trackDeckInteraction({ isPanning: true, isRotating: true })
    expect(track.mock.calls).toEqual([
      ['map_interacted', { kind: 'pan' }],
      ['map_interacted', { kind: 'zoom' }],
      ['map_interacted', { kind: 'rotate' }],
    ])
  })

  it('ignores MapLibre camera changes that no user input caused', () => {
    trackMapLibreGesture('zoom', { originalEvent: undefined })
    expect(track).not.toHaveBeenCalled()

    trackMapLibreGesture('zoom', { originalEvent: new Event('wheel') })
    expect(track.mock.calls).toEqual([['map_interacted', { kind: 'zoom' }]])
  })

  it('ignores deck interaction states that are not a gesture', () => {
    trackDeckInteraction({})
    trackDeckInteraction({ isPanning: false, isZooming: false })
    expect(track).not.toHaveBeenCalled()
  })
})

describe('createPanelVisibilityTracker', () => {
  beforeEach(() => {
    track.mockClear()
  })

  it('records the starting state, then sends panel_toggled on each flip', () => {
    const onResize = createPanelVisibilityTracker('properties')
    onResize(true)
    onResize(true)
    expect(track).not.toHaveBeenCalled()

    onResize(false)
    onResize(false)
    onResize(true)
    expect(track.mock.calls).toEqual([
      ['panel_toggled', { panel: 'properties', visible: false }],
      ['panel_toggled', { panel: 'properties', visible: true }],
    ])
  })
})
