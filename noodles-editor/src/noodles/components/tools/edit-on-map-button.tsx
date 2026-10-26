import { useStore } from '@xyflow/react'
import cx from 'classnames'
import { getFieldPath } from '../../../timeline/field-bindings'
import { getTimelineStore, useTimelineStore } from '../../../timeline/timeline-store'
import { analytics } from '../../../utils/analytics'
import { getOp } from '../../store'
import s from './edit-on-map-button.module.css'
import { type EditableOp, resolveEditTarget } from './edit-target'
import { useMapToolStore } from './map-tool-store'

interface EditOnMapButtonProps {
  nodeId: string
  // Where the button sits, for analytics
  from: 'properties' | 'node'
  className?: string
}

// Opens the Draw tool on a node's geometry. Renders nothing for nodes it can't edit.
// A field is keyframed when its own track, or any channel's track, has keyframes
function isKeyframed(opId: string, input: string): boolean {
  const field = getOp(opId)?.inputs[input]
  const channelKeys = (field?.constructor as { channelKeys?: readonly string[] } | undefined)
    ?.channelKeys
  const timeline = getTimelineStore()
  return channelKeys
    ? channelKeys.some(key => timeline.hasKeyframesForField(getFieldPath(opId, input, [key])))
    : timeline.hasKeyframesForField(getFieldPath(opId, input))
}

export function EditOnMapButton({ nodeId, from, className }: EditOnMapButtonProps) {
  const edges = useStore(state => state.edges)
  // Re-render when keyframes change, since they can lock the geometry
  useTimelineStore(state => state.tracks)
  const editing = useMapToolStore(state => state.editTarget)
  const startEditing = useMapToolStore(state => state.startEditing)
  const mapReady = useMapToolStore(state => state.mapReady)
  const target = resolveEditTarget(
    nodeId,
    id => getOp(id) as unknown as EditableOp | undefined,
    edges,
    isKeyframed
  )
  if (!target) return null

  const active = editing?.opId === target.opId
  const label = target.opId === nodeId ? 'Edit on map' : 'Edit shapes on map'
  // The tools draw through the basemap, so a blank map style leaves nothing to edit on
  const unavailable = target.locked
    ? `${target.locked}, so edits on the map would not stick`
    : mapReady
      ? undefined
      : 'Needs a map: set a map style on the basemap to edit shapes on the map'

  return (
    <button
      type="button"
      className={cx(s.button, { [s.active]: active || unavailable }, className)}
      disabled={active || Boolean(unavailable)}
      title={unavailable}
      onClick={() => {
        startEditing(target)
        analytics.track('draw_edit_started', { kind: target.kind, from })
      }}
    >
      <i className="pi pi-pencil" /> {active ? 'Editing on map' : label}
    </button>
  )
}
