import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimelineStore } from '../../timeline-store'
import type { Keyframe } from '../../types'
import { KeyframeValuePopup } from '../KeyframeValuePopup'

// Mock createPortal to render inline instead of to document.body
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

describe('KeyframeValuePopup', () => {
  const mockOnClose = vi.fn()
  const trackId = 'test-track'

  beforeEach(() => {
    useTimelineStore.getState().reset()
    mockOnClose.mockClear()
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  function createKeyframe(value: unknown, position = 0): Keyframe {
    return {
      id: 'kf-1',
      position,
      value: value as Keyframe['value'],
      handles: { left: [0.33, 0], right: [0.67, 1], type: 'aligned' },
      interpolation: 'bezier',
    }
  }

  function setupTrack(keyframe: Keyframe) {
    const store = useTimelineStore.getState()
    store.getOrCreateTrack(trackId, keyframe.value)
    store.addKeyframe(trackId, {
      position: keyframe.position,
      value: keyframe.value,
      handles: keyframe.handles,
      interpolation: keyframe.interpolation,
    })
  }

  describe('value type detection', () => {
    it('renders number input for number values', () => {
      const keyframe = createKeyframe(42)
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // Number values show a scrub input (div with scrub class)
      const scrubInput = document.querySelector('.kf-value-input.scrub')
      expect(scrubInput).toBeTruthy()
      expect(scrubInput?.textContent).toContain('42')
    })

    it('renders checkbox for boolean values', () => {
      const keyframe = createKeyframe(true)
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeTruthy()
      expect((checkbox as HTMLInputElement).checked).toBe(true)
    })

    it('renders text input for string values', () => {
      const keyframe = createKeyframe('hello')
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const textInput = screen.getByRole('textbox')
      expect(textInput).toBeTruthy()
      expect((textInput as HTMLInputElement).value).toBe('hello')
    })

    it('renders color picker for RGBA values', () => {
      const keyframe = createKeyframe({ r: 1, g: 0, b: 0, a: 1 })
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const colorInput = document.querySelector('input[type="color"]')
      expect(colorInput).toBeTruthy()
      // RGBA (1,0,0,1) should show as #ff0000
      expect((colorInput as HTMLInputElement).value).toBe('#ff0000')
    })

    it('renders Vec2 component inputs', () => {
      const keyframe = createKeyframe({ x: 10, y: 20 })
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // Should have X and Y labels
      expect(screen.getByText('X')).toBeTruthy()
      expect(screen.getByText('Y')).toBeTruthy()
    })

    it('renders Vec3 component inputs', () => {
      const keyframe = createKeyframe({ x: 10, y: 20, z: 30 })
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('X')).toBeTruthy()
      expect(screen.getByText('Y')).toBeTruthy()
      expect(screen.getByText('Z')).toBeTruthy()
    })

    it('renders Point2D component inputs', () => {
      const keyframe = createKeyframe({ lng: -122.4, lat: 37.8 })
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Lng')).toBeTruthy()
      expect(screen.getByText('Lat')).toBeTruthy()
    })

    it('renders Point3D component inputs', () => {
      const keyframe = createKeyframe({ lng: -122.4, lat: 37.8, alt: 1000 })
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Lng')).toBeTruthy()
      expect(screen.getByText('Lat')).toBeTruthy()
      expect(screen.getByText('Alt')).toBeTruthy()
    })
  })

  describe('value editing', () => {
    it('updates boolean value on checkbox change', () => {
      const keyframe = createKeyframe(false)
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const checkbox = screen.getByRole('checkbox')
      fireEvent.click(checkbox)

      // Check that the store was updated
      const track = useTimelineStore.getState().tracks.get(trackId)
      const updatedKf = track?.keyframes[0]
      expect(updatedKf?.value).toBe(true)
    })

    it('updates string value on text input change', () => {
      const keyframe = createKeyframe('hello')
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const textInput = screen.getByRole('textbox')
      fireEvent.change(textInput, { target: { value: 'world' } })

      const track = useTimelineStore.getState().tracks.get(trackId)
      const updatedKf = track?.keyframes[0]
      expect(updatedKf?.value).toBe('world')
    })
  })

  describe('closing behavior', () => {
    it('calls onClose when close button is clicked', () => {
      const keyframe = createKeyframe(42)
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      const closeButton = screen.getByRole('button', { name: /close/i })
      fireEvent.click(closeButton)

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when Escape key is pressed', () => {
      const keyframe = createKeyframe(42)
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
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

    it('stops Delete from bubbling out of popup inputs', () => {
      const keyframe = createKeyframe('hello')
      setupTrack(keyframe)
      const parentKeyDown = vi.fn()
      document.addEventListener('keydown', parentKeyDown)

      try {
        render(
          <KeyframeValuePopup
            trackId={trackId}
            keyframe={keyframe}
            anchorX={100}
            anchorY={100}
            onClose={mockOnClose}
          />
        )

        const textInput = screen.getByRole('textbox')
        fireEvent.keyDown(textInput, { key: 'Delete' })
        fireEvent.keyDown(textInput, { key: 'Backspace' })

        expect(parentKeyDown).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('keydown', parentKeyDown)
      }
    })
  })

  describe('positioning', () => {
    it('positions popup above anchor point', () => {
      const keyframe = createKeyframe(42)
      setupTrack(keyframe)

      const { container } = render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={200}
          anchorY={300}
          onClose={mockOnClose}
        />
      )

      const popup = container.querySelector('.keyframe-value-popup')
      expect(popup).toBeTruthy()

      // Popup should have inline style with positioning
      const style = (popup as HTMLElement).style
      expect(style.left).toBeDefined()
      expect(style.top).toBeDefined()
    })
  })

  describe('timecode display', () => {
    it('shows timecode in header', () => {
      const keyframe = createKeyframe(42, 2.5) // 2.5 seconds
      setupTrack(keyframe)

      render(
        <KeyframeValuePopup
          trackId={trackId}
          keyframe={keyframe}
          anchorX={100}
          anchorY={100}
          onClose={mockOnClose}
        />
      )

      // At 30fps, 2.5 seconds = 75 frames = 00:02:15
      const header = document.querySelector('.kf-popup-header')
      expect(header?.textContent).toContain('00:02:15')
    })
  })
})
