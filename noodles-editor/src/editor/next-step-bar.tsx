// The next step for the project, one at a time (#787): a small bar with the suggestion and a
// button that does it, or shows where to. It sits on the graph canvas when the workspace shows
// the graph, and over the map when it doesn't. It changes as the project does; there is
// nothing to dismiss. See next-step.ts for the steps.

import { Panel } from '@xyflow/react'
import { type ReactNode, useEffect, useState } from 'react'
import { EXPORT_EVENT, type ExportStatus, exportStatus } from '../render/headless-api'
import { analytics } from '../utils/analytics'
import { docStore, useEditor } from './doc-store'
import {
  addCameraMove,
  cameraMoveRefusal,
  layerToColor,
  type NextStep,
  nextStep,
} from './next-step'
import s from './next-step-bar.module.css'
import { getUIStore } from './ui-store'
import { setEditorShown, useEditorShown } from './workspace-store'

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

/**
 * What the step's button does: the step itself where it can be one click. A note for the bar
 * when it can't be: the camera is one another node, a wire or an expression drives.
 */
export function runNextStep(step: NextStep): string | undefined {
  switch (step.id) {
    case 'load-data':
      getUIStore().setDataImporterOpen(true)
      return
    case 'color-by-column': {
      const id = layerToColor(docStore().get().doc)
      if (!id) return
      docStore().set({ selection: [id] })
      // Its color channels are in the Properties area, which the workspace may not show
      setEditorShown('properties', true)
      return
    }
    case 'animate-camera': {
      getUIStore().setTimelineExpanded(true)
      const refused = cameraMoveRefusal(docStore().get().doc)
      if (refused) return `${refused} Keyframe what drives it on the timeline.`
      docStore().edit(d => {
        addCameraMove(d)
      }, 'next-step-camera')
      return
    }
    case 'export-video':
      getUIStore().setHighlightedControl('export')
      return
  }
}

/**
 * The bar, on the graph canvas (inside <ReactFlow>) or over the map: wherever the workspace
 * shows it, so it is on screen in a workspace without the graph too.
 */
export function NextStepBar({ over }: { over: 'graph' | 'map' }) {
  const graphShown = useEditorShown('graph')
  const doc = useEditor(st => st.doc)
  const exported = useExported()
  const step = graphShown === (over === 'graph') ? nextStep(doc, { exported }) : undefined
  const stepId = step?.id
  const [note, setNote] = useState<{ step: string; text: string }>()
  // Once per step shown, not per render
  useEffect(() => {
    if (stepId) analytics.track('next_step_shown', { step: stepId })
  }, [stepId])
  if (!step) return null
  const body: ReactNode = (
    <>
      <span className={s.text} role="status">
        {note?.step === step.id ? note.text : step.text}
      </span>
      <button
        type="button"
        className={s.action}
        onClick={() => {
          analytics.track('next_step_clicked', { step: step.id })
          const text = runNextStep(step)
          setNote(text ? { step: step.id, text } : undefined)
        }}
      >
        {step.action}
      </button>
    </>
  )
  return over === 'graph' ? (
    <Panel position="top-center" className={s.bar}>
      {body}
    </Panel>
  ) : (
    <div className={`${s.bar} ${s.overMap}`}>{body}</div>
  )
}
