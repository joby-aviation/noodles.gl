// Layer props that name a project file, `@/plane.png`, as file nodes' urls do. Deck fetches an
// icon atlas or a mesh itself, and a path relative to the page fetches nothing: the engine
// hands deck an object URL of the file's bytes instead.
import type { EditorDoc } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { Engine } from '../engine'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAPPING = '{"plane":{"x":0,"y":0,"width":128,"height":128,"mask":true}}'
const FILES: Record<string, Uint8Array> = {
  'data.csv': new TextEncoder().encode('Longitude,Latitude\n-122.4,37.8\n-118.2,34.1\n'),
  'plane.png': PNG,
  'mapping.json': new TextEncoder().encode(MAPPING),
  'plane.ply': new TextEncoder().encode('ply\n'),
}

const engineFor = () =>
  new Engine(duck, {
    registerFile: async (name, bytes) => duck.registerFile(name, bytes),
    readAsset: async name => {
      const bytes = FILES[name]
      if (!bytes) throw new Error(`${name} not found`)
      return bytes
    },
  })

const doc = (layer: EditorDoc['nodes'][number]): EditorDoc => ({
  version: 1,
  name: 'assets',
  nodes: [
    { id: 'data', op: 'file', x: 0, y: 0, params: { url: '@/data.csv', format: 'csv' } },
    {
      id: 'with-icon',
      op: 'attribute',
      x: 0,
      y: 0,
      params: { name: 'icon', expression: "'plane'" },
    },
    layer,
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'data', sourcePort: 'out', target: 'with-icon', targetPort: 'in' },
    { id: 'e2', source: 'with-icon', sourcePort: 'out', target: layer.id, targetPort: 'in' },
    { id: 'e3', source: layer.id, sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
})

const icons = (params: Record<string, unknown>) =>
  doc({
    id: 'planes',
    op: 'icon',
    x: 0,
    y: 0,
    params: { position: '[Longitude, Latitude]', icon: 'icon', ...params },
  })

const layerProps = (engine: Engine, id: string) => {
  const layer = engine.vis().deckProps.layers.find(l => l.id.startsWith(`${id}:`))
  expect(layer).toBeDefined()
  const props = layer?.props as unknown as Record<string | symbol, unknown>
  // Deck's async props (an atlas, a mesh) read as what they loaded; the URL given stays here
  const given = props[Symbol.for('asyncPropOriginal')] as Record<string, unknown>
  return { ...props, ...given }
}

it('hands deck an @/ icon atlas and mapping as object URLs of the project files', async () => {
  const engine = engineFor()
  await engine.setDoc(icons({ iconAtlas: '@/plane.png', iconMapping: '@/mapping.json' }))
  await engine.settle()
  expect(engine.errors()).toEqual([])
  const props = layerProps(engine, 'planes')
  expect(props.iconAtlas).toMatch(/^blob:.*#plane\.png$/)
  const atlas = await fetch(String(props.iconAtlas))
  expect(atlas.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await atlas.arrayBuffer())).toEqual(PNG)
  expect(props.iconMapping).toMatch(/^blob:.*#mapping\.json$/)
  expect(await (await fetch(String(props.iconMapping))).text()).toBe(MAPPING)
})

it('says which layer names a project file it could not read', async () => {
  const engine = engineFor()
  await engine.setDoc(icons({ iconAtlas: '@/missing.png', iconMapping: MAPPING }))
  await engine.settle()
  expect(engine.errors()).toEqual([
    { nodeId: 'planes', message: "Couldn't read @/missing.png: missing.png not found" },
  ])
  // Not the page-relative path, which deck would fetch and draw nothing from
  expect(layerProps(engine, 'planes').iconAtlas).toBe('')
})

it('tints icons with the Icon color param when no color channel is bound', async () => {
  const engine = engineFor()
  await engine.setDoc(
    icons({ iconAtlas: '@/plane.png', iconMapping: MAPPING, iconColor: [255, 128, 0] })
  )
  await engine.settle()
  const getColor = layerProps(engine, 'planes').getColor as (d: unknown) => number[]
  expect(getColor({ position: [0, 0, 0], text: 'plane' })).toEqual([255, 128, 0, 255])
})

it('keeps a mesh file’s extension, which picks its loader', async () => {
  const engine = engineFor()
  await engine.setDoc(
    doc({
      id: 'meshes',
      op: 'mesh',
      x: 0,
      y: 0,
      params: { position: '[Longitude, Latitude]', mesh: '@/plane.ply' },
    })
  )
  await engine.settle()
  expect(engine.errors()).toEqual([])
  const props = layerProps(engine, 'meshes')
  expect(props.mesh).toMatch(/^blob:.*#plane\.ply$/)
  expect((props.loaders as { id: string }[])[0].id).toBe('ply')
})

it('draws a project file’s new bytes once it is written again', async () => {
  const engine = engineFor()
  await engine.setDoc(icons({ iconAtlas: '@/plane.png', iconMapping: MAPPING }))
  await engine.settle()
  const before = String(layerProps(engine, 'planes').iconAtlas)

  const redrawn = new Uint8Array([...PNG, 1])
  FILES['plane.png'] = redrawn
  try {
    await engine.assetChanged('plane.png')
    const after = String(layerProps(engine, 'planes').iconAtlas)
    expect(after).not.toBe(before)
    expect(new Uint8Array(await (await fetch(after)).arrayBuffer())).toEqual(redrawn)
    // The old bytes are given back
    await expect(fetch(before)).rejects.toThrow()
  } finally {
    FILES['plane.png'] = PNG
  }
})

it('gives back a file’s object URL once no layer names it', async () => {
  const engine = engineFor()
  await engine.setDoc(icons({ iconAtlas: '@/plane.png', iconMapping: MAPPING }))
  await engine.settle()
  const atlas = String(layerProps(engine, 'planes').iconAtlas)
  await engine.setDoc(icons({ iconAtlas: '', iconMapping: MAPPING }))
  await engine.settle()
  await expect(fetch(atlas)).rejects.toThrow()
})
