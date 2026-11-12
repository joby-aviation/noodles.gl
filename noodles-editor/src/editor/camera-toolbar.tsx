// The map's camera switches (viewport-camera.ts), in its top-left corner as Blender's viewport
// header has them: whether the map shows the viewport or looks through the active camera, and
// the lock that pins the one you are in. Numpad 0 toggles camera view, as in Blender.

import cx from 'classnames'
import { useEffect } from 'react'
import { shouldBlockKeyboardShortcut } from '../noodles/utils/input-detection'
import { analytics } from '../utils/analytics'
import type { CameraControl } from './camera-control'
import s from './camera-toolbar.module.css'
import { setKey } from './doc-ops'
import { docStore } from './doc-store'
import { pendingKeys } from './pending-keys'
import { type Camera, useViewportCamera, viewportCamera } from './viewport-camera'

export function toggleCameraView(camera: Camera | undefined) {
  const on = !viewportCamera().lookThrough
  viewportCamera().setLookThrough(on, camera)
  analytics.track('camera_view_toggled', { on, via: 'shortcut' })
}

// Every unkeyed change to the camera keyed at the playhead, one undo step
function keyCamera(nodeId: string, changes: Record<string, number>) {
  const store = docStore()
  const time = store.get().time
  const keys = Object.keys(changes).map(p => `${nodeId}.${p}`)
  store.edit(d => {
    for (const [p, v] of Object.entries(changes)) setKey(d, `${nodeId}.${p}`, time, v)
  }, 'key-camera')
  pendingKeys().clear(keys)
  analytics.track('camera_keyed', { params: keys.length })
}

export function CameraToolbar({
  control,
  camera,
  cameraName,
  changes,
}: {
  control: CameraControl
  // The active camera's view now, which a viewport that has never moved starts from
  camera: Camera | undefined
  cameraName: string | undefined
  // The camera's keyframed parameters changed but not keyed, by name
  changes?: Record<string, number>
}) {
  const lookThrough = useViewportCamera(st => st.lookThrough)
  const lock = useViewportCamera(st => st.lock)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Numpad0' || e.metaKey || e.ctrlKey || e.altKey) return
      // Not while typing or in a dialog, as the editor's other shortcuts
      if (shouldBlockKeyboardShortcut(e)) return
      e.preventDefault()
      toggleCameraView(camera)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera])

  const show = (on: boolean) => {
    if (on === lookThrough) return
    viewportCamera().setLookThrough(on, camera)
    analytics.track('camera_view_toggled', { on, via: 'toolbar' })
  }

  return (
    <div className={s.toolbar}>
      <fieldset className={s.segmented} aria-label="Map shows">
        <button
          type="button"
          className={cx(s.segment, !lookThrough && s.segmentOn)}
          aria-pressed={!lookThrough}
          title="The viewport: look around freely. Exports still use the camera."
          onClick={() => show(false)}
        >
          Viewport
        </button>
        <button
          type="button"
          className={cx(s.segment, lookThrough && s.segmentOn)}
          aria-pressed={lookThrough}
          title="Look through the active camera, as exports do (Numpad 0)"
          onClick={() => show(true)}
        >
          <i className="pi pi-video" />
          {cameraName ?? 'Camera'}
        </button>
      </fieldset>
      <button
        type="button"
        className={cx(s.lock, lock && s.lockOn)}
        aria-pressed={lock}
        title={
          lookThrough
            ? lock
              ? 'Camera locked: moving the map moves the camera. Click to unlock.'
              : 'Lock the camera view: moving the map moves the camera'
            : lock
              ? 'Viewport locked: the timeline leaves the view here. Click to unlock.'
              : 'Lock the viewport: scrubbing the timeline stays here'
        }
        onClick={() => {
          viewportCamera().setLock(!lock)
          analytics.track('camera_lock_toggled', {
            on: !lock,
            view: lookThrough ? 'camera' : 'viewport',
          })
        }}
      >
        <i className={cx('pi', lock ? 'pi-lock' : 'pi-lock-open')} />
      </button>
      {changes && control.nodeId && (
        <>
          <button
            type="button"
            className={s.keyChanges}
            title={`Key the camera's changes at the playhead: ${Object.keys(changes).join(', ')}`}
            onClick={() => control.nodeId && keyCamera(control.nodeId, changes)}
          >
            <span className={s.keyDiamond} />
            Key
          </button>
          <button
            type="button"
            className={s.dropChanges}
            title="Drop the camera's unkeyed changes"
            onClick={() => pendingKeys().clear()}
          >
            <i className="pi pi-times" />
          </button>
        </>
      )}
      {lock && lookThrough && control.reason && (
        <div className={s.reason} role="status">
          {control.reason} Unlock to look around in the viewport.
        </div>
      )}
    </div>
  )
}
