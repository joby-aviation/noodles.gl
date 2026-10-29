// A Switch passes a host operator's table (a Geocoder's results) as it passes a planner table:
// the rows the host handed over, read where the Switch is wired.
import { type EditorDoc, lowerDocument, OPERATOR_INDEX } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { registerHostOperators } from '../host/host-ops'

beforeAll(() => registerHostOperators())

it('passes a host operator’s table through a Switch', () => {
  const results = OPERATOR_INDEX.get('GeocoderOp')?.outputs.find(o => o.type === 'table')
  expect(results, 'a Geocoder has a table output').toBeDefined()
  const doc: EditorDoc = {
    version: 1,
    name: 'switch',
    nodes: [
      { id: 'places', op: 'GeocoderOp', x: 0, y: 0, params: {} },
      { id: 'rows', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS lng, 2.0 AS lat' } },
      { id: 'pick', op: 'switch', x: 0, y: 0, params: { index: 0 } },
      { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[lng, lat]' } },
      { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
    ],
    edges: [
      {
        id: 'a',
        source: 'places',
        sourcePort: results?.name ?? '',
        target: 'pick',
        targetPort: 'in',
        index: 0,
      },
      { id: 'b', source: 'rows', sourcePort: 'out', target: 'pick', targetPort: 'in', index: 1 },
      { id: 'c', source: 'pick', sourcePort: 'out', target: 'dots', targetPort: 'in' },
      { id: 'd', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
    ],
  }
  const hostTable = (id: string, port: string) =>
    id === 'places' && port === results?.name ? 'SELECT 3.0 AS lng, 4.0 AS lat' : undefined
  const lowered = lowerDocument(doc, { hostTable })
  expect(lowered.errors).toEqual([])
  expect(lowered.outputs.pick.out).toBe(`places#${results?.name}`)
})
