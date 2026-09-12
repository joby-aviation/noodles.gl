import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileUrlField } from './fields'
import { BitmapLayerOp } from './operators'
import { DeckProjectAssetResolver } from './utils/deck-project-asset-resolver'
import { memoryProjectStore } from './utils/memory-project-store'

const PROJECT_NAME = 'bitmap-layer-test'
const PROJECT_CONTEXT = {
  currentProjectName: PROJECT_NAME,
  activeStorageType: 'memory' as const,
}

type TestLayer = {
  type: string
  id: string
  image?: string
  bounds?: number[]
  updateTriggers?: object
}

const resolvers: DeckProjectAssetResolver[] = []

function createResolver() {
  const resolver = new DeckProjectAssetResolver()
  resolvers.push(resolver)
  return resolver
}

async function resolveAndCommit(resolver: DeckProjectAssetResolver, layers: TestLayer[]) {
  const resolution = await resolver.resolveLayers(layers, PROJECT_CONTEXT)
  if (!resolution) throw new Error('Asset resolution was unexpectedly cancelled')
  if (!resolver.commit(resolution)) throw new Error('Asset resolution was unexpectedly stale')
  return resolution
}

async function createTinyPng(color: [number, number, number, number]) {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const imageData = context.createImageData(1, 1)
  imageData.data.set(color)
  context.putImageData(imageData, 0, 0)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Unable to encode test PNG'))
    }, 'image/png')
  })
}

function bitmapProps(overrides: Record<string, unknown> = {}) {
  return {
    visible: true,
    opacity: 1,
    image: '',
    bounds: [
      [-97.1, 32.8],
      [-96.9, 33],
    ],
    desaturate: 0,
    transparentColor: null,
    tintColor: null,
    parameters: { depthTest: true },
    extensions: [],
    ...overrides,
  } as unknown as Parameters<BitmapLayerOp['execute']>[0]
}

afterEach(() => {
  for (const resolver of resolvers.splice(0)) resolver.dispose()
  memoryProjectStore.deleteProject(PROJECT_NAME)
  vi.restoreAllMocks()
})

describe('BitmapLayerOp', () => {
  it('offers image uploads through a FileUrlField', () => {
    const op = new BitmapLayerOp('/bitmap')

    expect(op.inputs.image).toBeInstanceOf(FileUrlField)
    expect((op.inputs.image as FileUrlField).accept).toBe('.png,.jpg,.jpeg,.gif,.webp,.svg')
  })

  it('purely passes image references through for runtime materialization', () => {
    const op = new BitmapLayerOp('/bitmap')

    const project = op.execute(bitmapProps({ image: '@/airport.png' }))
    const external = op.execute(bitmapProps({ image: 'https://example.com/diagram.png' }))

    expect((project.layer as unknown as { image: string }).image).toBe('@/airport.png')
    expect((external.layer as unknown as { image: string }).image).toBe(
      'https://example.com/diagram.png'
    )
  })

  it('flattens BboxField southwest and northeast points for Deck.gl', () => {
    const op = new BitmapLayerOp('/bitmap')

    const result = op.execute(
      bitmapProps({
        image: '@/airport.png',
        bounds: [
          [-97.05, 32.85],
          [-96.95, 32.95],
        ],
      })
    )
    const layer = result.layer as unknown as { bounds: number[] }

    expect(layer.bounds).toEqual([-97.05, 32.85, -96.95, 32.95])
  })

  it('preserves a legacy flat Deck.gl bounding box', () => {
    const op = new BitmapLayerOp('/bitmap')

    const result = op.execute(
      bitmapProps({
        image: '@/airport.png',
        bounds: [-97.05, 32.85, -96.95, 32.95],
      })
    )
    const layer = result.layer as unknown as { bounds: number[] }

    expect(layer.bounds).toEqual([-97.05, 32.85, -96.95, 32.95])
  })
})

describe('DeckProjectAssetResolver', () => {
  it('materializes a valid project PNG with the correct MIME type and unchanged bounds', async () => {
    const resolver = createResolver()
    memoryProjectStore.writeAsset(
      PROJECT_NAME,
      'airport.PNG',
      await createTinyPng([255, 0, 0, 255])
    )
    let imageBlob: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(source => {
      if (!(source instanceof Blob)) throw new Error('Expected an image Blob')
      imageBlob = source
      return 'blob:airport-diagram'
    })
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const resolution = await resolveAndCommit(resolver, [
      {
        type: 'BitmapLayer',
        id: '/bitmap',
        image: '@/airport.PNG',
        bounds: [-97.1, 32.8, -96.9, 33],
      },
    ])
    const [layer] = resolution.layers

    expect(layer.image).toBe('blob:airport-diagram')
    expect(layer.bounds).toEqual([-97.1, 32.8, -96.9, 33])
    expect(imageBlob?.type).toBe('image/png')
    expect(revokeObjectURL).not.toHaveBeenCalled()

    if (!imageBlob) throw new Error('The runtime resolver did not create an image Blob')
    const bitmap = await createImageBitmap(imageBlob)
    expect([bitmap.width, bitmap.height]).toEqual([1, 1])
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.drawImage(bitmap, 0, 0)
    expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([255, 0, 0, 255])
    bitmap.close()
  })

  it('leaves external URLs and non-bitmap layers unchanged', async () => {
    const resolver = createResolver()
    const layers = [
      { type: 'BitmapLayer', id: '/bitmap', image: 'https://example.com/diagram.png' },
      { type: 'GeoJsonLayer', id: '/geojson' },
    ]
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    const resolution = await resolveAndCommit(resolver, layers)

    expect(resolution.layers).toEqual(layers)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('does not reread an unchanged bitmap execution from unrelated vis updates', async () => {
    const resolver = createResolver()
    memoryProjectStore.writeAsset(PROJECT_NAME, 'airport.png', new Blob(['airport']))
    const descriptor = {
      type: 'BitmapLayer',
      id: '/bitmap',
      image: '@/airport.png',
      updateTriggers: {},
    }
    const readAssetBinary = vi.spyOn(memoryProjectStore, 'readAssetBinary')
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:airport')

    const first = await resolveAndCommit(resolver, [descriptor])
    const unrelatedRendererUpdate = await resolveAndCommit(resolver, [descriptor])
    const unrelatedLayerUpdate = await resolveAndCommit(resolver, [{ ...descriptor }])

    expect(first.layers[0].image).toBe('blob:airport')
    expect(unrelatedRendererUpdate.layers[0].image).toBe('blob:airport')
    expect(unrelatedLayerUpdate.layers[0].image).toBe('blob:airport')
    expect(readAssetBinary).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()

    const reexecutedDescriptor = { ...descriptor, updateTriggers: {} }
    const operatorUpdate = await resolveAndCommit(resolver, [reexecutedDescriptor])
    expect(operatorUpdate.layers[0].image).toBe('blob:airport')
    expect(readAssetBinary).toHaveBeenCalledTimes(2)
    expect(createObjectURL).toHaveBeenCalledOnce()
  })

  it('reuses unchanged content and revokes changed images after renderer commit', async () => {
    const resolver = createResolver()
    memoryProjectStore.writeAsset(PROJECT_NAME, 'first.png', new Blob(['first']))
    memoryProjectStore.writeAsset(PROJECT_NAME, 'second.webp', new Blob(['second']))
    const createdBlobs: Blob[] = []
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(source => {
      if (!(source instanceof Blob)) throw new Error('Expected an image Blob')
      createdBlobs.push(source)
      return `blob:image-${createdBlobs.length}`
    })
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const first = await resolveAndCommit(resolver, [
      { type: 'BitmapLayer', id: '/bitmap', image: '@/first.png' },
    ])
    resolver.releaseRetiredUrlsThrough(first.generation)
    const cached = await resolveAndCommit(resolver, [
      { type: 'BitmapLayer', id: '/bitmap', image: '@/first.png' },
    ])
    resolver.releaseRetiredUrlsThrough(cached.generation)
    const second = await resolveAndCommit(resolver, [
      { type: 'BitmapLayer', id: '/bitmap', image: '@/second.webp' },
    ])

    expect(first.layers[0].image).toBe('blob:image-1')
    expect(cached.layers[0].image).toBe('blob:image-1')
    expect(second.layers[0].image).toBe('blob:image-2')
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(createdBlobs.map(blob => blob.type)).toEqual(['image/png', 'image/webp'])
    expect(revokeObjectURL).not.toHaveBeenCalled()

    resolver.releaseRetiredUrlsThrough(second.generation)
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:image-1')

    const external = await resolveAndCommit(resolver, [
      { type: 'BitmapLayer', id: '/bitmap', image: 'https://example.com/diagram.png' },
    ])
    resolver.releaseRetiredUrlsThrough(external.generation)
    expect(external.layers[0].image).toBe('https://example.com/diagram.png')
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:image-2')
  })

  it('reloads changed bytes when a project image is replaced at the same path', async () => {
    const resolver = createResolver()
    const redPng = await createTinyPng([255, 0, 0, 255])
    const bluePng = await createTinyPng([0, 0, 255, 255])
    memoryProjectStore.writeAsset(PROJECT_NAME, 'airport.png', redPng)
    const createdBlobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(source => {
      if (!(source instanceof Blob)) throw new Error('Expected an image Blob')
      createdBlobs.push(source)
      return `blob:replacement-${createdBlobs.length}`
    })
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const first = await resolveAndCommit(resolver, [
      { type: 'BitmapLayer', id: '/bitmap', image: '@/airport.png' },
    ])
    memoryProjectStore.writeAsset(PROJECT_NAME, 'airport.png', bluePng)
    const replaced = await resolveAndCommit(resolver, [
      { type: 'BitmapLayer', id: '/bitmap', image: '@/airport.png' },
    ])
    const unchanged = await resolveAndCommit(resolver, [
      { type: 'BitmapLayer', id: '/bitmap', image: '@/airport.png' },
    ])

    expect(first.layers[0].image).toBe('blob:replacement-1')
    expect(replaced.layers[0].image).toBe('blob:replacement-2')
    expect(unchanged.layers[0].image).toBe('blob:replacement-2')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    resolver.releaseRetiredUrlsThrough(unchanged.generation)
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:replacement-1')

    const replacementBitmap = await createImageBitmap(createdBlobs[1])
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.drawImage(replacementBitmap, 0, 0)
    expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([0, 0, 255, 255])
    replacementBitmap.close()
  })

  it('does not create an object URL when disposal overtakes an asset read', async () => {
    const resolver = createResolver()
    const pngBytes = await (await createTinyPng([255, 255, 255, 255])).arrayBuffer()
    let signalReadStarted: () => void = () => {}
    let finishRead: (contents: ArrayBuffer | null) => void = () => {}
    const readStarted = new Promise<void>(resolve => {
      signalReadStarted = resolve
    })
    const pendingRead = new Promise<ArrayBuffer | null>(resolve => {
      finishRead = resolve
    })
    vi.spyOn(memoryProjectStore, 'readAssetBinary').mockImplementation(async () => {
      signalReadStarted()
      return await pendingRead
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    const resolution = resolver.resolveLayers(
      [{ type: 'BitmapLayer', id: '/bitmap', image: '@/airport.png' }],
      PROJECT_CONTEXT
    )
    await readStarted
    resolver.dispose()
    finishRead(pngBytes)

    await expect(resolution).resolves.toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('revokes a resolved URL if disposal happens before renderer commit', async () => {
    const resolver = createResolver()
    memoryProjectStore.writeAsset(PROJECT_NAME, 'airport.png', new Blob(['airport']))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const resolution = await resolver.resolveLayers(
      [{ type: 'BitmapLayer', id: '/bitmap', image: '@/airport.png' }],
      PROJECT_CONTEXT
    )
    if (!resolution) throw new Error('Asset resolution was unexpectedly cancelled')
    resolver.dispose()

    expect(resolver.commit(resolution)).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pending')
  })

  it('reports that project assets require a loaded project', async () => {
    const resolver = createResolver()

    await expect(
      resolver.resolveLayers([{ type: 'BitmapLayer', id: '/bitmap', image: '@/airport.png' }], {
        ...PROJECT_CONTEXT,
        currentProjectName: null,
      })
    ).rejects.toThrow('No project loaded')
  })
})
