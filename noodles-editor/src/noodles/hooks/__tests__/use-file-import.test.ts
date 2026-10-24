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
})
