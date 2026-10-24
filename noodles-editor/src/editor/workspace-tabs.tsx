// Workspace tabs in the top bar, as Blender's: each is a named layout of the editor's areas.

import cx from 'classnames'
import { trackWorkspaceSelected } from '../noodles/utils/editor-analytics'
import { WORKSPACES } from './workspace'
import { useWorkspaceStore } from './workspace-store'
import s from './workspace-tabs.module.css'

export function WorkspaceTabs() {
  const active = useWorkspaceStore(state => state.active)
  const setActive = useWorkspaceStore(state => state.setActive)
  return (
    <div className={s.tabs} role="tablist" aria-label="Workspace">
      {WORKSPACES.map(w => (
        <button
          key={w.id}
          type="button"
          role="tab"
          aria-selected={w.id === active}
          className={cx(s.tab, w.id === active && s.active)}
          onClick={() => {
            if (w.id === active) return
            trackWorkspaceSelected(w.id)
            setActive(w.id)
          }}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}
