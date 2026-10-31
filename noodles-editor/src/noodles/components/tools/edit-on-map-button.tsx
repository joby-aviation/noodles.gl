import cx from 'classnames'
import { useEditor } from '../../../editor/doc-store'
import { analytics } from '../../../utils/analytics'
import s from './edit-on-map-button.module.css'
import { resolveEditTarget } from './edit-target'
import { useMapToolStore } from './map-tool-store'

interface EditOnMapButtonProps {
  nodeId: string
  // Where the button sits, for analytics
  from: 'properties' | 'node'
  className?: string
}

// Opens the Draw tool on a node's geometry. Renders nothing for nodes it can't edit.
export function EditOnMapButton({ nodeId, from, className }: EditOnMapButtonProps) {
  // The document, since wires, expressions and keyframes can lock the geometry
  const doc = useEditor(st => st.doc)
  const editing = useMapToolStore(state => state.editTarget)
  const startEditing = useMapToolStore(state => state.startEditing)
  const mapReady = useMapToolStore(state => state.mapReady)
  const target = resolveEditTarget(doc, nodeId)
  if (!target) return null

  const active = editing?.nodeId === target.nodeId
  const label = target.nodeId === nodeId ? 'Edit on map' : 'Edit shapes on map'
  // The tools draw through the basemap, so a blank map style leaves nothing to edit on
  const unavailable = target.locked
    ? `${target.locked}, so edits on the map would not stick`
    : mapReady
      ? undefined
      : 'Needs a map: set a map style on the deck to edit shapes on the map'

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
