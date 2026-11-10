// The app's border-box sizing comes from the PrimeReact theme
import 'primereact/resources/themes/viva-dark/theme.css'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTimelineStore } from '../../timeline-store'
import { TimelinePanel } from '../TimelinePanel'
import s from '../TimelinePanel.module.css'

function renderPanel(height: number) {
  const { container } = render(
    <ReactFlowProvider>
      <TimelinePanel height={height} />
    </ReactFlowProvider>
  )
  const labels = container.querySelector<HTMLElement>(`.${s.timelineTrackLabels}`)
  const scrollArea = container.querySelector<HTMLElement>(`.${s.timelineScrollArea}`)
  if (!labels || !scrollArea) throw new Error('Expected timeline columns to render')
  return { labels, scrollArea }
}

describe('TimelinePanel layout', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
    useTimelineStore.getState().reset()
  })

  it.each([150, 250, 400])('does not overflow vertically with no tracks at %ipx', height => {
    const { labels, scrollArea } = renderPanel(height)

    expect(scrollArea.scrollHeight).toBe(scrollArea.clientHeight)
    expect(labels.scrollHeight).toBe(labels.clientHeight)
  })

  it('scrolls both columns the same distance when tracks overflow', () => {
    const store = useTimelineStore.getState()
    for (let i = 0; i < 12; i++) {
      const track = store.getOrCreateTrack(`/op-${i} / value`, 0)
      store.addKeyframe(track.id, { position: 0, value: 0, interpolation: 'linear' })
    }

    const { labels, scrollArea } = renderPanel(200)

    expect(scrollArea.scrollHeight).toBeGreaterThan(scrollArea.clientHeight)
    expect(scrollArea.scrollHeight - scrollArea.clientHeight).toBe(
      labels.scrollHeight - labels.clientHeight
    )
  })
})

describe('TimelinePanel scrubbing', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
    useTimelineStore.getState().reset()
  })

  function mouse(target: EventTarget, type: string, clientX: number) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX }))
  }

  it('pauses playback while the ruler is dragged and resumes on release', () => {
    const { container } = render(
      <ReactFlowProvider>
        <TimelinePanel height={300} />
      </ReactFlowProvider>
    )
    const ruler = container.querySelector<HTMLElement>(`.${s.timelineRuler}`)
    if (!ruler) throw new Error('Expected ruler')
    const left = ruler.getBoundingClientRect().left

    useTimelineStore.getState().play()
    mouse(ruler, 'mousedown', left + 50)
    expect(useTimelineStore.getState()).toMatchObject({ scrubSource: 'ruler', playing: false })

    mouse(document, 'mousemove', left + 100)
    const scrubbed = useTimelineStore.getState().position
    expect(scrubbed).toBeGreaterThan(0)

    mouse(document, 'mouseup', left + 100)
    expect(useTimelineStore.getState()).toMatchObject({ scrubSource: null, playing: true })
  })

  it('ends a scrub and resumes playback when the panel unmounts mid-drag', () => {
    const { container, unmount } = render(
      <ReactFlowProvider>
        <TimelinePanel height={300} />
      </ReactFlowProvider>
    )
    const ruler = container.querySelector<HTMLElement>(`.${s.timelineRuler}`)
    if (!ruler) throw new Error('Expected ruler')

    useTimelineStore.getState().play()
    mouse(ruler, 'mousedown', ruler.getBoundingClientRect().left + 50)
    unmount()

    expect(useTimelineStore.getState()).toMatchObject({ scrubSource: null, playing: true })
    useTimelineStore.getState().setPosition(1)
    mouse(document, 'mousemove', 400)
    expect(useTimelineStore.getState().position).toBe(1)
  })

  it('clears a marker connection drag on pointercancel and on unmount', () => {
    const store = useTimelineStore.getState()
    store.addMarker(1)
    const { container, unmount } = render(
      <ReactFlowProvider>
        <TimelinePanel height={300} />
      </ReactFlowProvider>
    )
    const port = container.querySelector<HTMLElement>(`.${s.timeMarkerPort}`)
    if (!port) throw new Error('Expected marker port')
    const pointerDown = () =>
      port.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))

    pointerDown()
    expect(useTimelineStore.getState().connectingFromMarkerId).not.toBeNull()
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
    expect(useTimelineStore.getState().connectingFromMarkerId).toBeNull()

    pointerDown()
    expect(useTimelineStore.getState().connectingFromMarkerId).not.toBeNull()
    unmount()
    expect(useTimelineStore.getState().connectingFromMarkerId).toBeNull()
  })
})
