import { renderHook } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasCoordinates, viewStateForBounds } from '../../components/tools/detect-coordinates'
import { publishEnvironment, readEnvironment, resetEnvironment } from '../../environment'
import { useFileSystemStore } from '../../filesystem-store'
import { clearOps } from '../../store'
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
  const nodes = flow.addNodes.mock.lastCall?.[0] as Node<{ inputs: { viewState?: unknown } }>[]
  const basemap = nodes.find(n => n.type === 'MaplibreBasemapOp')
  return { imported, viewState: basemap?.data.inputs.viewState }
}

describe('useFileImport', () => {
  beforeEach(() => {
    clearOps()
    vi.clearAllMocks()
    useFileSystemStore.setState({ currentProjectName: 'import-test', activeStorageType: 'memory' })
  })

  afterEach(() => {
    resetEnvironment()
    clearOps()
  })

  it('fits imported data to the render surface size', async () => {
    const defaultSize = readEnvironment('renderSurface')
    const size = { width: 600, height: 1800 }
    publishEnvironment('renderSurface', size)

    const { imported, viewState } = await importCsv()

    const { detection } = imported
    if (!hasCoordinates(detection)) throw new Error('expected coordinates to be detected')
    expect(viewState).toEqual(viewStateForBounds(detection.bounds, size))
    // A tall surface frames the same points differently from the default one
    expect(viewState).not.toEqual(viewStateForBounds(detection.bounds, defaultSize))
  })
})
