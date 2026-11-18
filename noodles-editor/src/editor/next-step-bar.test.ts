// What the next-step bar's button does for each step (#787)
import type { EditorDoc } from '@noodles.gl/planner'
import { afterEach, describe, expect, it } from 'vitest'
import { docStore } from './doc-store'
import { nextStep } from './next-step'
import { runNextStep } from './next-step-bar'
import { getUIStore } from './ui-store'

const project = (nodes: EditorDoc['nodes']): EditorDoc => ({
  version: 1,
  name: 'p',
  nodes,
  edges: [],
})
const step = (id: Parameters<typeof runNextStep>[0]['id']) => ({ id, text: '', action: '' })

afterEach(() => {
  getUIStore().setDataImporterOpen(false)
  getUIStore().setHighlightedControl(null)
})

describe('runNextStep', () => {
  it('opens the importer for data, and points at Export for a video', () => {
    runNextStep(step('load-data'))
    expect(getUIStore().dataImporterOpen).toBe(true)
    runNextStep(step('export-video'))
    expect(getUIStore().highlightedControl).toBe('export')
  })

  it('selects the layer to color, and adds a camera move the next step reads', () => {
    docStore().load(
      project([
        { id: 'rows', op: 'file', x: 0, y: 0, params: { url: '@/d.csv', format: 'csv' } },
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[lng, lat]' } },
        { id: 'deck', op: 'deck', x: 0, y: 0, params: {} },
      ])
    )
    runNextStep(step('color-by-column'))
    expect(docStore().get().selection).toEqual(['dots'])
    runNextStep(step('animate-camera'))
    const { doc } = docStore().get()
    expect(doc.timeline?.tracks.map(t => t.target)).toEqual(['deck.bearing'])
    // One undo step takes the move back
    docStore().undo()
    expect(docStore().get().doc.timeline?.tracks ?? []).toEqual([])
    expect(nextStep(doc)?.id).toBe('color-by-column')
  })
})
