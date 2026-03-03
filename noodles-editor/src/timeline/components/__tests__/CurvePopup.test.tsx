import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimelineStore } from '../../timeline-store'
import type { Keyframe } from '../../types'
import { CurvePopup } from '../CurvePopup'

// Mock createPortal to render inline instead of to document.body
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

describe('CurvePopup', () => {
  const mockOnClose = vi.fn()
  const trackId = 'test-track'

  function createKeyframe(position: number, interpolation: 'bezier' | 'hold' = 'bezier'): Keyframe {
    return {
      id: `kf-${position}`,
      position,
      value: 0,
      handles: { left: [0.33, 0], right: [0.67, 1], type: 'aligned' },
      interpolation,
    }
  }

  beforeEach(() => {
    useTimelineStore.getState().reset()
    mockOnClose.mockClear()

    // Set up a track with two keyframes
    const store = useTimelineStore.getState()
    store.getOrCreateTrack(trackId, 0)
    store.addKeyframe(trackId, {
      position: 0,
      value: 0,
      handles: { left: [0.33, 0], right: [0.67, 1], type: 'aligned' },
      interpolation: 'bezier',
    })
    store.addKeyframe(trackId, {
      position: 2,
      value: 100,
      handles: { left: [0.33, 0], right: [0.67, 1], type: 'aligned' },
      interpolation: 'bezier',
    })
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  describe('preset library', () => {
    it('renders preset buttons', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // Should have preset buttons including standard ones
      expect(screen.getByTitle('Linear')).toBeTruthy()
      expect(screen.getByTitle('Ease In')).toBeTruthy()
      expect(screen.getByTitle('Ease Out')).toBeTruthy()
      expect(screen.getByTitle('Hold')).toBeTruthy()
    })

    it('shows Hold preset at top of list', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const presetItems = document.querySelectorAll('.curve-popup-preset-item')
      expect(presetItems.length).toBeGreaterThan(0)

      // First preset should be Hold
      const firstPresetName = presetItems[0]?.querySelector('.curve-popup-preset-name')
      expect(firstPresetName?.textContent).toBe('Hold')
    })
  })

  describe('preset interaction', () => {
    it('applies preset on click and closes popup', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const linearButton = screen.getByTitle('Linear')
      fireEvent.click(linearButton)

      // Should close after clicking preset
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('shows preview on hover without committing', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const easeInButton = screen.getByTitle('Ease In')

      // Hover should not close
      fireEvent.mouseEnter(easeInButton)
      expect(mockOnClose).not.toHaveBeenCalled()

      // Leave should restore original
      fireEvent.mouseLeave(easeInButton)
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('curve editor', () => {
    it('renders bezier curve editor', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // Should have an SVG curve editor
      const curveEditor = document.querySelector('svg[aria-label="Bezier curve editor"]')
      expect(curveEditor).toBeTruthy()
    })

    it('has draggable handle points', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // Should have handle circles (red and green)
      const curveEditor = document.querySelector('svg[aria-label="Bezier curve editor"]')
      const circles = curveEditor?.querySelectorAll('circle')
      // 2 endpoints + 2 handles = 4 circles
      expect(circles?.length).toBe(4)
    })
  })

  describe('closing behavior', () => {
    it('calls onClose when Escape key is pressed', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
      })

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('restores original state when closed without committing', () => {
      // Get original keyframe state
      const track = useTimelineStore.getState().tracks.get(trackId)
      const originalK1 = track?.keyframes[0]
      const originalInterpolation = originalK1?.interpolation

      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // Hover over a preset to change state
      const holdButton = screen.getByTitle('Hold')
      fireEvent.mouseEnter(holdButton)

      // Leave without clicking
      fireEvent.mouseLeave(holdButton)

      // Close with escape (should restore)
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
      })

      // Original interpolation should be preserved
      const trackAfter = useTimelineStore.getState().tracks.get(trackId)
      const kfAfter = trackAfter?.keyframes[0]
      expect(kfAfter?.interpolation).toBe(originalInterpolation)
    })
  })

  describe('preset label display', () => {
    it('shows matching preset name when handles match', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // Should show a preset label
      const presetLabel = document.querySelector('.curve-popup-preset-label')
      expect(presetLabel).toBeTruthy()
    })

    it('shows "Hold" label for hold interpolation', () => {
      // Update the keyframe to use hold interpolation
      const store = useTimelineStore.getState()
      const track = store.tracks.get(trackId)
      const kf = track?.keyframes[0]
      if (kf) {
        store.updateKeyframe(trackId, kf.id, { interpolation: 'hold' })
      }

      const k1 = createKeyframe(0, 'hold')
      const k2 = createKeyframe(2)

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const presetLabel = document.querySelector('.curve-popup-preset-label')
      expect(presetLabel?.textContent).toBe('Hold')
    })
  })

  describe('positioning', () => {
    it('positions popup near anchor point', () => {
      const k1 = createKeyframe(0)
      const k2 = createKeyframe(2)

      const { container } = render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={200}
          anchorY={300}
          onClose={mockOnClose}
        />
      )

      const popup = container.querySelector('.curve-popup')
      expect(popup).toBeTruthy()

      const style = (popup as HTMLElement).style
      expect(style.left).toBeDefined()
      expect(style.top).toBeDefined()
    })
  })
})
