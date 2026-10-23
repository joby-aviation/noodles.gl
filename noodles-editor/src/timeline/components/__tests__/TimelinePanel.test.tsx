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
