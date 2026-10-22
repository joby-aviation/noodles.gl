import type { Edge } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEdgeConnectionStore } from '../store'

describe('EdgeConnectionStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useEdgeConnectionStore.setState({
      connectionMap: new Map(),
      _edgeSignature: '',
    })
  })

  describe('updateFromEdges', () => {
    it('builds connection map from edges', () => {
      const edges: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
        {
          id: 'e2',
          source: '/c',
          target: '/d',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
      ]

      useEdgeConnectionStore.getState().updateFromEdges(edges)

      const { connectionMap } = useEdgeConnectionStore.getState()
      expect(connectionMap.has('/b::par.input')).toBe(true)
      expect(connectionMap.has('/d::par.data')).toBe(true)
      expect(connectionMap.has('/a::par.input')).toBe(false) // source, not target
    })

    it('filters out ReferenceEdges', () => {
      const edges: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
        {
          id: 'e2',
          source: '/c',
          target: '/d',
          sourceHandle: 'out.data',
          targetHandle: 'par.code',
          type: 'ReferenceEdge',
        },
      ]

      useEdgeConnectionStore.getState().updateFromEdges(edges)

      const { connectionMap } = useEdgeConnectionStore.getState()
      expect(connectionMap.has('/b::par.input')).toBe(true)
      expect(connectionMap.has('/d::par.code')).toBe(false) // ReferenceEdge filtered
    })

    it('does not update when edge structure is unchanged', () => {
      const edges: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
      ]

      useEdgeConnectionStore.getState().updateFromEdges(edges)
      const firstSignature = useEdgeConnectionStore.getState()._edgeSignature
      const firstMap = useEdgeConnectionStore.getState().connectionMap

      // Call again with same structural data (simulating position-only changes)
      const edgesCopy: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
      ]
      useEdgeConnectionStore.getState().updateFromEdges(edgesCopy)

      // Should be same reference (no update)
      expect(useEdgeConnectionStore.getState()._edgeSignature).toBe(firstSignature)
      expect(useEdgeConnectionStore.getState().connectionMap).toBe(firstMap)
    })

    it('updates when edges are added', () => {
      const edges1: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
      ]
      useEdgeConnectionStore.getState().updateFromEdges(edges1)

      expect(useEdgeConnectionStore.getState().connectionMap.size).toBe(1)

      const edges2: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
        {
          id: 'e2',
          source: '/c',
          target: '/d',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
      ]
      useEdgeConnectionStore.getState().updateFromEdges(edges2)

      expect(useEdgeConnectionStore.getState().connectionMap.size).toBe(2)
      expect(useEdgeConnectionStore.getState().connectionMap.has('/d::par.data')).toBe(true)
    })

    it('updates when edges are removed', () => {
      const edges1: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
        {
          id: 'e2',
          source: '/c',
          target: '/d',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
      ]
      useEdgeConnectionStore.getState().updateFromEdges(edges1)

      expect(useEdgeConnectionStore.getState().connectionMap.size).toBe(2)

      const edges2: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
      ]
      useEdgeConnectionStore.getState().updateFromEdges(edges2)

      expect(useEdgeConnectionStore.getState().connectionMap.size).toBe(1)
      expect(useEdgeConnectionStore.getState().connectionMap.has('/d::par.data')).toBe(false)
    })

    it('handles empty edges array', () => {
      useEdgeConnectionStore.getState().updateFromEdges([])

      expect(useEdgeConnectionStore.getState().connectionMap.size).toBe(0)
    })

    it('handles edges with missing target or targetHandle', () => {
      const edges: Edge[] = [
        {
          id: 'e1',
          source: '/a',
          target: '/b',
          sourceHandle: 'out.val',
          targetHandle: 'par.input',
        },
        { id: 'e2', source: '/c', target: '', sourceHandle: 'out.data', targetHandle: 'par.data' },
        { id: 'e3', source: '/d', target: '/e', sourceHandle: 'out.val' } as Edge, // missing targetHandle
      ]

      useEdgeConnectionStore.getState().updateFromEdges(edges)

      const { connectionMap } = useEdgeConnectionStore.getState()
      expect(connectionMap.size).toBe(1) // Only the valid edge
      expect(connectionMap.has('/b::par.input')).toBe(true)
    })
  })
})
