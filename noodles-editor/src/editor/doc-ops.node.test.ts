import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type EditorDoc, lowerDocument, OPERATOR_INDEX } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../runtime/deck-ops'
import {
  addNode,
  connect,
  copyNodes,
  pasteNodes,
  removeEdges,
  removeNodes,
  renameNode,
  setKey,
  setParam,
  validConnection,
} from './doc-ops'
import { DocStore } from './doc-store'
import { driveWith } from './drivers'
import { isEditorDoc, loadDoc } from './load-doc'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'ops',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
    { id: 'k', op: 'number', name: 'k', x: 0, y: 0, params: { value: 3 } },
    {
      id: 'dots',
      op: 'scatter',
      x: 0,
      y: 0,
      params: { position: '[x, y]', radiusScale: { expr: "ch('k/value') * 2.0" } },
    },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers', index: 0 },
  ],
})

describe('document operations', () => {
  it('replaces the wire on a single input and appends to a multi input in order', () => {
    const d = doc()
    const other = addNode(d, 'sql', 0, 0)
    connect(d, other.id, 'out', 'dots', 'in')
    expect(d.edges.filter(e => e.target === 'dots' && e.targetPort === 'in')).toHaveLength(1)
    const more = addNode(d, 'scatter', 0, 0)
    connect(d, 'src', 'out', more.id, 'in')
    connect(d, more.id, 'out', 'map', 'layers')
    expect(d.edges.filter(e => e.targetPort === 'layers').map(e => e.index)).toEqual([0, 1])
    removeEdges(d, ['e2'])
    expect(d.edges.filter(e => e.targetPort === 'layers').map(e => e.index)).toEqual([0])
    expect(lowerDocument(d).errors).toEqual([])
  })

  it('appends to a list parameter in order, as a Switch Value takes cameras', () => {
    registerDeckOperators()
    const d = doc()
    for (const id of ['sf', 'ny']) d.nodes.push({ id, op: 'view-state', x: 0, y: 0, params: {} })
    d.nodes.push({ id: 'shots', op: 'switch-value', x: 0, y: 0, params: {} })
    connect(d, 'sf', 'viewState', 'shots', 'par:values')
    connect(d, 'ny', 'viewState', 'shots', 'par:values')
    expect(
      d.edges.filter(e => e.targetPort === 'par:values').map(e => [e.source, e.index])
    ).toEqual([
      ['sf', 0],
      ['ny', 1],
    ])
    // Another parameter port still takes one wire
    connect(d, 'k', 'out', 'dots', 'par:radiusScale')
    connect(d, addNode(d, 'number', 0, 0).id, 'out', 'dots', 'par:radiusScale')
    expect(d.edges.filter(e => e.targetPort === 'par:radiusScale')).toHaveLength(1)
  })

  it('inserts a wire at a slot of a multi input and moves one already there', () => {
    const d = doc()
    const layers = () =>
      d.edges
        .filter(e => e.targetPort === 'layers')
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(e => e.source)
    const b = addNode(d, 'scatter', 0, 0)
    const c = addNode(d, 'scatter', 0, 0)
    connect(d, 'src', 'out', b.id, 'in')
    connect(d, 'src', 'out', c.id, 'in')
    connect(d, b.id, 'out', 'map', 'layers', 0)
    expect(layers()).toEqual([b.id, 'dots'])
    connect(d, c.id, 'out', 'map', 'layers', 1)
    expect(layers()).toEqual([b.id, c.id, 'dots'])
    // Boundary 3 is after the last slot
    connect(d, b.id, 'out', 'map', 'layers', 3)
    expect(layers()).toEqual([c.id, 'dots', b.id])
    connect(d, b.id, 'out', 'map', 'layers', 0)
    expect(layers()).toEqual([b.id, c.id, 'dots'])
    // Either boundary of a wire's own slot leaves it where it is
    connect(d, c.id, 'out', 'map', 'layers', 2)
    expect(layers()).toEqual([b.id, c.id, 'dots'])
    expect(
      d.edges
        .filter(e => e.targetPort === 'layers')
        .map(e => e.index)
        .sort()
    ).toEqual([0, 1, 2])
    expect(lowerDocument(d).errors).toEqual([])
  })

  it('refuses a wire that would make a cycle or join mismatched types', () => {
    const d = doc()
    expect(validConnection(d, 'dots', 'out', 'src', 'in0')).toBe(false)
    expect(validConnection(d, 'k', 'out', 'dots', 'par:radiusScale')).toBe(true)
  })

  it('names new nodes uniquely, without the Op suffix', () => {
    const d = doc()
    expect(addNode(d, 'scatter', 0, 0).name).toBe('scatter1')
    expect(addNode(d, 'scatter', 0, 0).name).toBe('scatter2')
  })

  it('removes nodes with their wires and keyframes', () => {
    const d = doc()
    setKey(d, 'dots.opacity', 0, 1)
    removeNodes(d, ['dots'])
    expect(d.edges).toEqual([])
    expect(d.timeline?.tracks).toEqual([])
  })

  it('keys a keyframed number at the playhead instead of overwriting it', () => {
    const d = doc()
    setKey(d, 'dots.opacity', 0, 1)
    setParam(d, 'dots', 'opacity', 0.5, 2)
    expect(d.timeline?.tracks[0].keyframes.map(k => [k.time, k.value])).toEqual([
      [0, 1],
      [2, 0.5],
    ])
    expect(d.nodes.find(n => n.id === 'dots')?.params.opacity).toBeUndefined()
    setParam(d, 'dots', 'radiusUnits', 'meters', 2)
    expect(d.nodes.find(n => n.id === 'dots')?.params.radiusUnits).toBe('meters')
  })

  it('keeps references working across a rename, and refuses a taken name', () => {
    const d = doc()
    expect(renameNode(d, 'k', 'size')).toBe(true)
    expect(d.nodes.find(n => n.id === 'dots')?.params.radiusScale).toEqual({
      expr: "ch('size/value') * 2.0",
    })
    expect(lowerDocument(d).errors).toEqual([])
    expect(renameNode(d, 'src', 'size')).toBe(false)
  })
})

describe('deleting what drives a parameter', () => {
  // A deck whose pitch a Number drives, the Number driven by Time, as the menu makes them
  const driven = () => {
    const d: EditorDoc = {
      version: 1,
      name: 'drive',
      nodes: [{ id: 'map', op: 'deck', x: 600, y: 0, params: {} }],
      edges: [],
    }
    const number = addNode(d, 'number', 0, 0)
    number.params.value = 30
    return { d, number }
  }
  const pitchDef = () => OPERATOR_INDEX.get('number')?.params.find(p => p.name === 'value')

  it('a wired Number driven by Time: deleting Time, then the Number, leaves a document that lowers', () => {
    const { d, number } = driven()
    expect(connect(d, number.id, 'out', 'map', 'par:pitch')).toBeDefined()
    const def = pitchDef()
    if (!def) throw new Error('no value')
    const time = driveWith(d, number, def, { op: 'time', label: 'Time' }, 30)
    expect(time).toBeDefined()
    removeNodes(d, [time as string])
    expect(lowerDocument(d).errors).toEqual([])
    removeNodes(d, [number.id])
    expect(d.edges).toEqual([])
    expect(lowerDocument(d).errors).toEqual([])
  })

  it('a reference to a deleted Number keeps the value it read, rather than pointing at nothing', () => {
    const { d, number } = driven()
    setParam(d, 'map', 'pitch', { ref: `${number.name}/value` })
    setParam(d, 'map', 'bearing', { ref: `${number.name}/value` })
    removeNodes(d, [number.id])
    expect(d.nodes[0].params).toMatchObject({ pitch: 30, bearing: 30 })
    expect(lowerDocument(d).errors).toEqual([])
  })

  it('a reference to a deleted parameter that is itself driven goes back to its default', () => {
    const { d, number } = driven()
    number.params.value = { expr: 'T * 2' }
    setParam(d, 'map', 'pitch', { ref: `${number.name}/value` })
    removeNodes(d, [number.id])
    expect(d.nodes[0].params.pitch).toBeUndefined()
  })
})

describe('copy and paste', () => {
  it('pastes nodes with new ids and names, keeping the wires between them', () => {
    const d = doc()
    const clip = copyNodes(d, ['src', 'dots'])
    expect(clip.edges.map(e => e.id)).toEqual(['e1'])
    const ids = pasteNodes(d, clip, undefined)
    const pasted = d.nodes.filter(n => ids.includes(n.id))
    expect(pasted.map(n => n.op)).toEqual(['sql', 'scatter'])
    expect(new Set(d.nodes.map(n => n.id)).size).toBe(d.nodes.length)
    expect(d.edges.filter(e => ids.includes(e.source) && ids.includes(e.target))).toHaveLength(1)
    // A pasted node named like its original gets a name of its own.
    const k = pasteNodes(d, copyNodes(d, ['k']), undefined)
    expect(d.nodes.find(n => n.id === k[0])?.name).toBe('k1')
    expect(lowerDocument(d).errors).toEqual([])
  })
})

describe('DocStore', () => {
  it('coalesces a gesture into one undo step, and undoes and redoes whole documents', () => {
    const store = new DocStore(doc())
    for (const v of [0.2, 0.4, 0.6]) store.edit(d => setParam(d, 'dots', 'opacity', v), 'p:opacity')
    store.edit(d => setParam(d, 'dots', 'radiusUnits', 'meters'))
    const opacity = () => store.get().doc.nodes.find(n => n.id === 'dots')?.params.opacity
    expect(opacity()).toBe(0.6)
    store.undo()
    store.undo()
    expect(opacity()).toBeUndefined()
    store.redo()
    expect(opacity()).toBe(0.6)
    expect(store.get().dirty).toBe(true)
    store.load(doc())
    expect(store.canUndo()).toBe(false)
    expect(store.get().dirty).toBe(false)
  })
})

describe('loadDoc', () => {
  const examples = readdirSync(resolve('src/examples'), { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(resolve(`src/examples/${d.name}/noodles.json`)))
    .map(d => d.name)

  it.each(examples)('opens the %s example as a document', async name => {
    const json = JSON.parse(readFileSync(resolve(`src/examples/${name}/noodles.json`), 'utf8'))
    const { doc } = await loadDoc(json, name)
    expect(isEditorDoc(doc)).toBe(true)
    expect(doc.name).toBe(name)
    // A saved document opens as itself.
    expect((await loadDoc(JSON.parse(JSON.stringify(doc)))).doc).toEqual(doc)
  })
})
