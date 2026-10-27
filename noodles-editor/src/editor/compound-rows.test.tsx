import { type DocNode, type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { compoundsFor } from './compound-params'
import { ColorGroupRows } from './compound-rows'
import { docStore } from './doc-store'
import { NodeFields } from './field-adapter'

afterEach(() => cleanup())

const nodeIn = (id: string) =>
  docStore()
    .get()
    .doc.nodes.find(n => n.id === id) as DocNode

// Each layer colors with its own ramp, so choosing Ramp keeps the layer's, whatever ramp
// another node uses
it('keeps the layer’s own ramp when Color switches to Ramp', () => {
  const doc: EditorDoc = {
    version: 1,
    name: 'test',
    nodes: [
      { id: 'colors', op: 'color-ramp', x: 0, y: 0, params: { ramp: 'turbo' } },
      { id: 'dots', op: 'scatter', x: 0, y: 0, params: { color: 'tint', ramp: 'inferno' } },
    ],
    edges: [],
  }
  docStore().load(doc)
  const node = nodeIn('dots')
  const op = OPERATOR_INDEX.get('scatter')
  if (!op) throw new Error('no scatter operator')
  const compounds = compoundsFor(op, node.params)
  const group = compounds.colors[0]
  const { getByRole } = render(
    <ColorGroupRows
      node={node}
      doc={docStore().get().doc}
      group={group}
      fields={new NodeFields(docStore(), node)}
      wired={new Set()}
      showRamp={compounds.rampIn === group.channel}
    />
  )
  fireEvent.click(getByRole('button', { name: 'Ramp' }))
  expect(nodeIn('dots').params.ramp).toBe('inferno')
})
