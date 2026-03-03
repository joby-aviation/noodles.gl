import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

  function getStoreKeyframes(): { k1: Keyframe; k2: Keyframe } {
    const track = useTimelineStore.getState().tracks.get(trackId)
    const k1 = track?.keyframes.find(keyframe => keyframe.position === 0) ?? track?.keyframes[0]
    const k2 = track?.keyframes.find(keyframe => keyframe.position === 2) ?? track?.keyframes[1]
    if (!k1 || !k2) {
      throw new Error('Expected two keyframes in test setup')
    }
    return { k1, k2 }
  }

  afterEach(() => {
    cleanup()
    useTimelineStore.getState().reset()
  })

  describe('preset library', () => {
    it('renders preset buttons', () => {
      const { k1, k2 } = getStoreKeyframes()

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
      const { k1, k2 } = getStoreKeyframes()

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

      const holdButton = screen.getByTitle('Hold')
      const presetsContainer = holdButton.parentElement
      const firstPreset = presetsContainer?.querySelector('button:first-of-type')
      expect(firstPreset?.getAttribute('title')).toBe('Hold')
    })
  })

  describe('preset interaction', () => {
    it('applies preset on click and closes popup', () => {
      const { k1, k2 } = getStoreKeyframes()

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
      const { k1, k2 } = getStoreKeyframes()

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
      const { k1, k2 } = getStoreKeyframes()

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
      const { k1, k2 } = getStoreKeyframes()

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
      const { k1, k2 } = getStoreKeyframes()

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

    it('closes cleanly after hover preview without committing', () => {
      const { k1, k2 } = getStoreKeyframes()

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

      // Close with escape
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
      })

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('preset label display', () => {
    it('shows matching preset name when handles match', () => {
      const store = useTimelineStore.getState()
      const { k1 } = getStoreKeyframes()
      store.updateKeyframe(trackId, k1.id, { interpolation: 'bezier' })
      store.setKeyframeHandles(trackId, k1.id, { left: [0, 0], right: [1, 1], type: 'aligned' })
      const { k1: updatedK1, k2 } = getStoreKeyframes()

      render(
        <CurvePopup
          trackId={trackId}
          k1={updatedK1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const curveEditor = screen.getByLabelText('Bezier curve editor')
      const presetLabel = curveEditor.parentElement?.lastElementChild
      expect(presetLabel?.textContent).toBe('Linear')
    })

    it('shows "Hold" label for hold interpolation', () => {
      // Update the keyframe to use hold interpolation
      const store = useTimelineStore.getState()
      const { k1 } = getStoreKeyframes()
      store.updateKeyframe(trackId, k1.id, { interpolation: 'hold' })

      const { k1: updatedK1, k2 } = getStoreKeyframes()

      render(
        <CurvePopup
          trackId={trackId}
          k1={updatedK1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const curveEditor = screen.getByLabelText('Bezier curve editor')
      const presetLabel = curveEditor.parentElement?.lastElementChild
      expect(presetLabel?.textContent).toBe('Hold')
    })
  })

  describe('multi-keyframe apply', () => {
    it('renders multi-apply indicator when applyToSelected=true and multiple keyframes are selected', () => {
      const store = useTimelineStore.getState()
      const secondTrack = 'second-track'
      store.getOrCreateTrack(secondTrack, 0)
      const id1 = store.addKeyframe(trackId, { position: 0.5, value: 50, interpolation: 'linear' })
      const id2 = store.addKeyframe(secondTrack, { position: 0.5, value: 50, interpolation: 'linear' })
      store.selectKeyframe(id1)
      store.selectKeyframe(id2, true)

      const { k1, k2 } = getStoreKeyframes()

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          applyToSelected={true}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText(/Applying to \d+ keyframes/)).toBeTruthy()
    })

    it('does not render multi-apply indicator when applyToSelected=false', () => {
      const { k1, k2 } = getStoreKeyframes()

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          applyToSelected={false}
          onClose={mockOnClose}
        />
      )

      expect(screen.queryByText(/Applying to \d+ keyframes/)).toBeNull()
    })

    it('applies easing to all selected keyframes when applyToSelected=true', () => {
      const store = useTimelineStore.getState()
      const secondTrack = 'second-track-easing'
      store.getOrCreateTrack(secondTrack, 0)
      const id1 = store.addKeyframe(trackId, { position: 0.5, value: 50, interpolation: 'linear' })
      const id2 = store.addKeyframe(secondTrack, { position: 0.5, value: 50, interpolation: 'linear' })
      store.selectKeyframe(id1)
      store.selectKeyframe(id2, true)

      const { k1, k2 } = getStoreKeyframes()

      const { container } = render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          applyToSelected={true}
          onClose={mockOnClose}
        />
      )

      fireEvent.click(within(container).getByTitle('Hold'))

      // Both selected keyframes should now have hold interpolation
      const kf1 = useTimelineStore.getState().tracks.get(trackId)?.keyframes.find(kf => kf.id === id1)
      const kf2 = useTimelineStore.getState().tracks.get(secondTrack)?.keyframes.find(kf => kf.id === id2)
      expect(kf1?.interpolation).toBe('hold')
      expect(kf2?.interpolation).toBe('hold')
      expect(mockOnClose).toHaveBeenCalled()
    })

    it('applies easing only to k1 when applyToSelected=false', () => {
      const store = useTimelineStore.getState()
      const secondTrack = 'second-track-single'
      store.getOrCreateTrack(secondTrack, 0)
      const id1 = store.addKeyframe(trackId, { position: 0.5, value: 50, interpolation: 'linear' })
      const id2 = store.addKeyframe(secondTrack, { position: 0.5, value: 50, interpolation: 'linear' })
      store.selectKeyframe(id1)
      store.selectKeyframe(id2, true)

      const { k1: actualK1, k2 } = getStoreKeyframes()

      const { container } = render(
        <CurvePopup
          trackId={trackId}
          k1={actualK1}
          k2={k2}
          anchorX={100}
          anchorY={100}
          applyToSelected={false}
          onClose={mockOnClose}
        />
      )

      fireEvent.click(within(container).getByTitle('Hold'))

      // Only k1 (in trackId at position 0) should change to hold
      const k1After = useTimelineStore.getState().tracks.get(trackId)?.keyframes.find(kf => kf.id === actualK1.id)
      expect(k1After?.interpolation).toBe('hold')
      // id2 in secondTrack should be unchanged
      const kf2 = useTimelineStore.getState().tracks.get(secondTrack)?.keyframes.find(kf => kf.id === id2)
      expect(kf2?.interpolation).toBe('linear')
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('positioning', () => {
    it('positions popup near anchor point', () => {
      const { k1, k2 } = getStoreKeyframes()

      render(
        <CurvePopup
          trackId={trackId}
          k1={k1}
          k2={k2}
          anchorX={200}
          anchorY={300}
          onClose={mockOnClose}
        />
      )

      const curveEditor = screen.getByLabelText('Bezier curve editor')
      const popup = curveEditor.closest('div[style]')
      expect(popup).toBeTruthy()

      const style = (popup as HTMLElement).style
      expect(style.left).toBeDefined()
      expect(style.top).toBeDefined()
    })
  })
})
