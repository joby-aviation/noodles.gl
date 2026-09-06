import { beforeEach, describe, expect, it } from 'vitest'
import { TableEditorOp, ViewerOp } from '../../operators'
import { getOpStore, setOp } from '../../store'
import type { ReactFlowEdge, ReactFlowNode } from '../../types'
import { convertViewerToTableEditor } from '../operator-conversion'

describe('convertViewerToTableEditor', () => {
  let mockSetNodes: (updater: (nodes: ReactFlowNode[]) => ReactFlowNode[]) => void
  let mockSetEdges: (updater: (edges: ReactFlowEdge[]) => ReactFlowEdge[]) => void
  let capturedNodes: ReactFlowNode[] | null = null
  let capturedEdges: ReactFlowEdge[] | null = null

  beforeEach(() => {
    // Reset captured state
    capturedNodes = null
    capturedEdges = null

    // Mock setNodes/setEdges to capture the updater function results
    mockSetNodes = updater => {
      const dummyNodes: ReactFlowNode[] = [
        {
          id: '/test-viewer',
          type: 'ViewerOp',
          position: { x: 100, y: 100 },
          data: undefined,
        },
      ]
      capturedNodes = updater(dummyNodes)
    }

    mockSetEdges = updater => {
      const dummyEdges: ReactFlowEdge[] = []
      capturedEdges = updater(dummyEdges)
    }
  })

  it('converts ViewerOp with array data to TableEditorOp', () => {
    // Create a ViewerOp with tabular data
    const viewerOp = new ViewerOp('/test-viewer')
    const testData = [
      { name: 'Alice', age: 30, active: true },
      { name: 'Bob', age: 25, active: false },
    ]
    viewerOp.inputs.data.setValue(testData)
    setOp('/test-viewer', viewerOp)

    // Perform conversion
    const result = convertViewerToTableEditor('/test-viewer', mockSetNodes, mockSetEdges)

    // Verify conversion succeeded
    expect(result).toBe(true)

    // Verify the operator was replaced with TableEditorOp
    const store = getOpStore()
    const convertedOp = store.getOp('/test-viewer')
    expect(convertedOp).toBeInstanceOf(TableEditorOp)

    // Note: Data is not automatically transferred because TableEditorOp expects
    // data to flow through connections. In a real scenario, the data input
    // would be connected to an upstream operator that provides the data.
    // The conversion preserves the connection, so data will flow correctly.

    // Verify schema was inferred and stored in node data
    const schema = (convertedOp as TableEditorOp).inputs.schema.value
    expect(schema).toBeDefined()
    expect(schema.columns).toHaveLength(3)
    expect(schema.columns[0].name).toBe('name')
    expect(schema.columns[0].type).toBe('string')
    expect(schema.columns[1].name).toBe('age')
    expect(schema.columns[1].type).toBe('number')
    expect(schema.columns[2].name).toBe('active')
    expect(schema.columns[2].type).toBe('boolean')

    // Verify node type was updated
    expect(capturedNodes).not.toBeNull()
    expect(capturedNodes![0].type).toBe('TableEditorOp')

    // Verify schema was saved to node data for undo/redo
    expect(capturedNodes![0].data?.inputs?.schema).toEqual(schema)
  })

  it('returns false when operator is not a ViewerOp', () => {
    // Create a different operator type
    const tableEditorOp = new TableEditorOp('/test-table')
    setOp('/test-table', tableEditorOp)

    // Attempt conversion
    const result = convertViewerToTableEditor('/test-table', mockSetNodes, mockSetEdges)

    // Verify conversion failed
    expect(result).toBe(false)
  })

  it('returns false when data is not an array', () => {
    // Create a ViewerOp with non-array data
    const viewerOp = new ViewerOp('/test-viewer')
    viewerOp.inputs.data.setValue({ key: 'value' })
    setOp('/test-viewer', viewerOp)

    // Attempt conversion
    const result = convertViewerToTableEditor('/test-viewer', mockSetNodes, mockSetEdges)

    // Verify conversion failed
    expect(result).toBe(false)
  })

  it('returns false when data is an empty array', () => {
    // Create a ViewerOp with empty array
    const viewerOp = new ViewerOp('/test-viewer')
    viewerOp.inputs.data.setValue([])
    setOp('/test-viewer', viewerOp)

    // Attempt conversion
    const result = convertViewerToTableEditor('/test-viewer', mockSetNodes, mockSetEdges)

    // Verify conversion failed
    expect(result).toBe(false)
  })

  it('returns false when data contains non-objects', () => {
    // Create a ViewerOp with array of primitives
    const viewerOp = new ViewerOp('/test-viewer')
    viewerOp.inputs.data.setValue([1, 2, 3])
    setOp('/test-viewer', viewerOp)

    // Attempt conversion
    const result = convertViewerToTableEditor('/test-viewer', mockSetNodes, mockSetEdges)

    // Verify conversion failed
    expect(result).toBe(false)
  })

  it('preserves locked state when converting', () => {
    // Create a locked ViewerOp
    const viewerOp = new ViewerOp('/test-viewer')
    viewerOp.locked.next(true)
    const testData = [{ name: 'Alice', age: 30 }]
    viewerOp.inputs.data.setValue(testData)
    setOp('/test-viewer', viewerOp)

    // Perform conversion
    convertViewerToTableEditor('/test-viewer', mockSetNodes, mockSetEdges)

    // Verify locked state was preserved
    const store = getOpStore()
    const convertedOp = store.getOp('/test-viewer')
    expect(convertedOp!.locked.value).toBe(true)
  })

  it('removes duplicate edge IDs while converting', () => {
    const viewerOp = new ViewerOp('/test-viewer')
    viewerOp.inputs.data.setValue([{ name: 'Alice' }])
    setOp('/test-viewer', viewerOp)
    const edge = {
      id: '/source.out.data->/test-viewer.par.data',
      source: '/source',
      target: '/test-viewer',
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    }
    mockSetEdges = updater => {
      capturedEdges = updater([edge, { ...edge }])
    }

    convertViewerToTableEditor('/test-viewer', mockSetNodes, mockSetEdges)

    expect(capturedEdges).toEqual([edge])
  })
})
