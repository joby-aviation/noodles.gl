import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { CameraToolbar } from './camera-toolbar'
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
