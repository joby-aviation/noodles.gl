import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { docStore, EMPTY_DOC } from '../../../editor/doc-store'
import {
  getRenderSurfaceSize,
  resetRenderSurfaceSize,
  setRenderSurfaceSize,
} from '../../../render/render-surface-size'
import { hasCoordinates, viewStateForBounds } from '../../components/tools/detect-coordinates'
import { useFileSystemStore } from '../../filesystem-store'
import { readAssetBinary } from '../../storage'
import { useFileImport } from '../use-file-import'

const flow = vi.hoisted(() => ({
  addNodes: vi.fn(),
  setEdges: vi.fn(),
  setNodes: vi.fn(),
  fitView: vi.fn(),
  getNodes: vi.fn(() => []),
  getEdges: vi.fn(() => []),
}))

vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useReactFlow: () => flow,
}))

vi.mock('../../../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

const csv = 'lat,lng\n40.7,-74.0\n34.1,-118.2\n41.9,-87.6\n'

async function importCsv() {
  const { result } = renderHook(() => useFileImport({ getBasePosition: () => ({ x: 0, y: 0 }) }))
  const imported = await result.current.importFile(
    new File([csv], 'cities.csv', { type: 'text/csv' }),
    { x: 0, y: 0 },
    'test'
  )
  // The import's deck holds the camera fitted to the data
  const deck = docStore()
    .get()
    .doc.nodes.find(n => n.op === 'deck')
  const p = deck?.params ?? {}
  return {
    imported,
    viewState: { longitude: p.longitude, latitude: p.latitude, zoom: p.zoom },
  }
}

describe('useFileImport', () => {
  beforeEach(() => {
    docStore().load(EMPTY_DOC)
    vi.clearAllMocks()
    useFileSystemStore.setState({ currentProjectName: 'import-test', activeStorageType: 'memory' })
  })

  afterEach(() => {
    resetRenderSurfaceSize()
  })

  it('fits imported data to the render surface size', async () => {
    const defaultSize = getRenderSurfaceSize()
    const size = { width: 600, height: 1800 }
    setRenderSurfaceSize(size)

    const { imported, viewState } = await importCsv()

    const { detection } = imported
    if (!hasCoordinates(detection)) throw new Error('expected coordinates to be detected')
    const fit = (s: { width: number; height: number }) => {
      const { longitude, latitude, zoom } = viewStateForBounds(detection.bounds, s)
      return { longitude, latitude, zoom }
    }
    expect(viewState).toEqual(fit(size))
    // A tall surface frames the same points differently from the default one
    expect(viewState).not.toEqual(fit(defaultSize))
  })

  describe('a shapefile', () => {
    const bytes = (n: number) => new File([new Uint8Array(n)], 'x')
    const named = (name: string, n: number) => new File([new Uint8Array(n)], name)
    const hook = () =>
      renderHook(() => useFileImport({ getBasePosition: () => ({ x: 0, y: 0 }) })).result

    it('copies the .shx, .dbf and .prj picked with the .shp, under its name', async () => {
      const shp = named('Places.shp', 100)
      const files = [shp, named('Places.SHX', 8), named('places.dbf', 33), named('Places.prj', 5)]
      const imported = await hook().current.importFile(shp, { x: 0, y: 0 }, 'test', [
        ...files,
        bytes(1),
      ])
      expect(imported.format).toBe('shapefile')
      // Where the engine looks for them: beside the .shp, extensions in lower case
      for (const [name, size] of [
        ['Places.shx', 8],
        ['Places.dbf', 33],
        ['Places.prj', 5],
      ] as const) {
        const read = await readAssetBinary('memory', 'import-test', name)
        expect(read.success && read.data.byteLength, name).toBe(size)
      }
      const source = docStore()
        .get()
        .doc.nodes.find(n => n.op === 'geojson')
      expect(source?.params.url).toBe('@/Places.shp')
    })

    it('asks for the .shx when it is missing, and imports nothing', async () => {
      const shp = named('roads.shp', 100)
      await expect(
        hook().current.importFile(shp, { x: 0, y: 0 }, 'test', [shp, named('roads.dbf', 33)])
      ).rejects.toThrow('roads.shp needs the .shx beside it')
      expect(docStore().get().doc.nodes).toEqual([])
    })
  })
})
