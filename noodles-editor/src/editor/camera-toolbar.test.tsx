import type { EditorDoc } from '@noodles.gl/planner'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { CameraToolbar } from './camera-toolbar'
import { docStore } from './doc-store'
import { pendingKeys } from './pending-keys'
import { useViewportCamera, viewportCamera } from './viewport-camera'

const control = { nodeId: 'deck', enabled: true, reason: null }
const camera = { longitude: 0, latitude: 0, zoom: 2, pitch: 0, bearing: 0 }

beforeEach(() =>
  useViewportCamera.setState({ project: 'x', lookThrough: true, lock: false, viewport: undefined })
)
afterEach(() => cleanup())

it('toggles camera view with Numpad 0', () => {
  render(<CameraToolbar control={control} camera={camera} cameraName="deck" />)
  fireEvent.keyDown(window, { code: 'Numpad0', key: '0' })
  expect(viewportCamera()).toMatchObject({ lookThrough: false, viewport: camera })
})

it('leaves Numpad 0 to a dialog that holds the focus', () => {
  const { getByText } = render(
    <>
      <CameraToolbar control={control} camera={camera} cameraName="deck" />
      <div className="nokey">
        <button type="button">Settings</button>
      </div>
    </>
  )
  fireEvent.keyDown(getByText('Settings'), { code: 'Numpad0', key: '0' })
  expect(viewportCamera().lookThrough).toBe(true)
})

it('keys every unkeyed camera change at the playhead with Key', () => {
  docStore().load({
    version: 1,
    name: 'key',
    nodes: [{ id: 'deck', op: 'deck', x: 0, y: 0, params: {} }],
    edges: [],
    timeline: {
      tracks: [
        { target: 'deck.zoom', keyframes: [] },
        { target: 'deck.pitch', keyframes: [] },
      ],
    } as unknown as EditorDoc['timeline'],
  })
  pendingKeys().set(docStore().get().doc, { 'deck.zoom': 9, 'deck.pitch': 30 })
  const { getByText } = render(
    <CameraToolbar
      control={control}
      camera={camera}
      cameraName="deck"
      changes={{ zoom: 9, pitch: 30 }}
    />
  )
  fireEvent.click(getByText('Key'))
  const tracks = docStore().get().doc.timeline?.tracks ?? []
  expect(tracks.map(t => [t.target, t.keyframes.map(k => k.value)])).toEqual([
    ['deck.zoom', [9]],
    ['deck.pitch', [30]],
  ])
  expect(pendingKeys().values).toEqual({})
})
