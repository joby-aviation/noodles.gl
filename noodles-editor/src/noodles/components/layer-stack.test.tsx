import type { EditorDoc } from '@noodles.gl/planner'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { docStore } from '../../editor/doc-store'
import { LayerStack } from './layer-stack'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'stack',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
    { id: 'spare', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
})

beforeEach(() => docStore().load(doc()))
afterEach(() => cleanup())

it('always shows the scene, where the output settings are, with no toggle', () => {
  const { getByText, queryByRole } = render(<LayerStack />)
  // The deck node is listed without opening anything
  expect(getByText('map')).toBeTruthy()
  expect(queryByRole('button', { name: /^Scene/ })).toBeNull()
})

it('still folds the nodes that draw nothing', () => {
  const { getByRole, queryByText } = render(<LayerStack />)
  expect(queryByText('spare')).toBeNull()
  fireEvent.click(getByRole('button', { name: /Not drawn/ }))
  expect(queryByText('spare')).not.toBeNull()
})
