// The next step for the project, one at a time (#787): a small bar on the graph canvas with
// the suggestion and a button that does it, or shows where to. It changes as the project
// does; there is nothing to dismiss. See next-step.ts for the steps.

import { Panel } from '@xyflow/react'
import { useEffect, useState } from 'react'
import { EXPORT_EVENT, type ExportStatus, exportStatus } from '../render/headless-api'
import { analytics } from '../utils/analytics'
import { docStore, useEditor } from './doc-store'
import { addCameraMove, layerToColor, type NextStep, nextStep } from './next-step'
import s from './next-step-bar.module.css'
import { getUIStore } from './ui-store'

// Whether a video export finished since the page loaded
function useExported(): boolean {
  const [exported, setExported] = useState(() => exportStatus().state === 'done')
  useEffect(() => {
    const listen = (e: Event) => {
      if ((e as CustomEvent<ExportStatus>).detail.state === 'done') setExported(true)
    }
    window.addEventListener(EXPORT_EVENT, listen)
    return () => window.removeEventListener(EXPORT_EVENT, listen)
  }, [])
  return exported
}

/** What the step's button does: the step itself where it can be one click. */
export function runNextStep(step: NextStep) {
  switch (step.id) {
    case 'load-data':
      getUIStore().setDataImporterOpen(true)
      break
    case 'color-by-column': {
      const id = layerToColor(docStore().get().doc)
      if (id) docStore().set({ selection: [id] })
      break
    }
    case 'animate-camera':
      docStore().edit(d => {
        addCameraMove(d)
      }, 'next-step-camera')
      getUIStore().setTimelineExpanded(true)
      break
    case 'export-video':
      getUIStore().setHighlightedControl('export')
      break
  }
}

// Rendered inside <ReactFlow>
export function NextStepBar() {
  const doc = useEditor(st => st.doc)
  const exported = useExported()
  const step = nextStep(doc, { exported })
  // Once per step shown, not per render
  const stepId = step?.id
  useEffect(() => {
    if (stepId) analytics.track('next_step_shown', { step: stepId })
  }, [stepId])
  if (!step) return null
  return (
    <Panel position="top-center" className={s.bar}>
      <span className={s.text} role="status">
        {step.text}
      </span>
      <button
        type="button"
        className={s.action}
        onClick={() => {
          analytics.track('next_step_clicked', { step: step.id })
          runNextStep(step)
        }}
      >
        {step.action}
      </button>
    </Panel>
  )
}
