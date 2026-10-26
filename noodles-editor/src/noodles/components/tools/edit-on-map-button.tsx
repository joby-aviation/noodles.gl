import cx from 'classnames'
import { analytics } from '../../../utils/analytics'
import { getOp } from '../../store'
import s from './edit-on-map-button.module.css'
import { type EditableOp, resolveEditTarget } from './edit-target'
import { useMapToolStore } from './map-tool-store'

interface EditOnMapButtonProps {
  nodeId: string
  // Incoming edges of the node, used to find a GeoEditor or Point behind a layer
  edges?: { source: string; target: string; targetHandle?: string | null }[]
  // Where the button sits, for analytics
  from: 'properties' | 'node'
  className?: string
}

// Opens the Draw tool on a node's geometry. Renders nothing for nodes it can't edit.
export function EditOnMapButton({ nodeId, edges = [], from, className }: EditOnMapButtonProps) {
  const editing = useMapToolStore(state => state.editTarget)
  const startEditing = useMapToolStore(state => state.startEditing)
  const target = resolveEditTarget(
    nodeId,
    id => getOp(id) as unknown as EditableOp | undefined,
    edges
  )
  if (!target) return null

  const active = editing?.opId === target.opId
  const label = target.opId === nodeId ? 'Edit on map' : 'Edit shapes on map'

  return (
    <button
      type="button"
      className={cx(s.button, { [s.active]: active }, className)}
      disabled={active}
      onClick={() => {
        startEditing(target)
        analytics.track('draw_edit_started', { kind: target.kind, from })
      }}
    >
      <i className="pi pi-pencil" /> {active ? 'Editing on map' : label}
    </button>
  )
}
