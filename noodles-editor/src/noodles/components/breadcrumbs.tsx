import { nameOf } from '@noodles.gl/planner'
import cx from 'classnames'
import { type FC, Fragment } from 'react'
import { docStore, useEditor } from '../../editor/doc-store'
import { analytics } from '../../utils/analytics'
import s from './breadcrumbs.module.css'

interface BreadcrumbsProps {
  projectName?: string
  hasUnsavedChanges?: boolean
}

// The project and the subnets the network editor is inside, each a step back up to it
export const Breadcrumbs: FC<BreadcrumbsProps> = ({ projectName, hasUnsavedChanges }) => {
  const network = useEditor(st => st.network)
  const doc = useEditor(st => st.doc)
  const segments: { id?: string; name: string }[] = []
  for (let at = network; at; ) {
    const n = doc.nodes.find(x => x.id === at)
    if (!n) break
    segments.unshift({ id: n.id, name: nameOf(n) })
    at = n.parent
  }
  segments.unshift({ id: undefined, name: projectName || 'Untitled' })

  const go = (id: string | undefined) => {
    docStore().set({ network: id, selection: [] })
    analytics.track('container_navigated', { method: 'breadcrumb', direction: 'up' })
  }

  return (
    <div className={s.bar}>
      {segments.map((segment, index) => (
        <Fragment key={segment.id ?? '/'}>
          {index > 0 && <span className={s.separator}> / </span>}
          <button
            type="button"
            className={cx(s.segment, segment.id === network && s.active)}
            onClick={() => go(segment.id)}
          >
            {segment.name}
            {index === 0 && hasUnsavedChanges && (
              <span className={s.unsavedIndicator} title="Unsaved changes">
                *
              </span>
            )}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
