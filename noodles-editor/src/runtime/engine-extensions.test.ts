// Extensions wired into a planner layer reach the deck layer the engine builds.
import type { EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import {
  instantiateExtensions,
  instantiateLayer,
  instantiateWidget,
} from '../noodles/utils/instantiate-vis'
import { DuckDbEngine } from './duckdb'
import { Engine } from './engine'
import { registerHostOperators } from './host/host-ops'
import { HostRunner } from './host/host-runner'

const doc: EditorDoc = {
  version: 1,
  name: 'extended',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
    { id: 'bright', op: 'brightness-contrast', x: 0, y: 0, params: { brightness: 0.25 } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    {
      id: 'e2',
      source: 'bright',
      sourcePort: 'extension',
      target: 'dots',
      targetPort: 'par:extensions',
    },
    { id: 'e3', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
}

describe('Engine extensions', () => {
  it('attaches extensions to a planner layer, the same instances while nothing changes', async () => {
    registerHostOperators()
    const sql = await DuckDbEngine.open()
    const engine = new Engine(sql, {
      host: {
        runner: new HostRunner(),
        layer: instantiateLayer,
        widget: instantiateWidget,
        view: v => v,
        extensions: values => {
          const list = values as { extension: unknown; props?: Record<string, unknown> }[]
          return {
            extensions: instantiateExtensions(list.map(v => v.extension)) ?? [],
            props: Object.assign({}, ...list.map(v => v.props ?? {})),
          }
        },
      },
    })
    await engine.setDoc(doc, 0)
    await engine.settle()
    const [layer] = engine.vis().deckProps.layers as { props: Record<string, unknown> }[]
    const extensions = layer.props.extensions as unknown[]
    expect(extensions).toHaveLength(1)
    expect(layer.props.brightnessContrast).toEqual({ brightness: 0.25, contrast: 0 })
    // A second vis keeps the extension instances, so deck does not reset the layer
    const [again] = engine.vis().deckProps.layers as { props: Record<string, unknown> }[]
    expect((again.props.extensions as unknown[])[0]).toBe(extensions[0])
    await sql.close()
  })
})
