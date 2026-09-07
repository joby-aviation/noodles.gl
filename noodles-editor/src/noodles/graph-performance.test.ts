import { beforeEach, describe, expect, it } from 'vitest'
import { type Edge as ReactFlowEdge, type Node as ReactFlowNode } from '@xyflow/react'
import { clearOps, getOpStore } from './store'

// Performance baseline tests for graph operations
// These establish baseline metrics before the graph-store refactor
//
// Run with: npm test graph-performance

describe('Graph Performance Baseline', () => {
  beforeEach(() => {
    clearOps()
  })

  it('should measure load time for large graph (100 nodes)', () => {
    const nodeCount = 100
    const nodes: ReactFlowNode[] = []
    const edges: ReactFlowEdge[] = []

    // Generate nodes
    const startGenerate = performance.now()
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        id: `/node-${i}`,
        type: 'NumberOp',
        position: { x: (i % 10) * 200, y: Math.floor(i / 10) * 100 },
        data: {
          inputs: { value: i },
        },
      })
    }

    // Generate edges (chain: node-0 → node-1 → node-2 → ...)
    for (let i = 0; i < nodeCount - 1; i++) {
      edges.push({
        id: `e-${i}`,
        source: `/node-${i}`,
        target: `/node-${i + 1}`,
        sourceHandle: 'out.value',
        targetHandle: 'par.value',
      })
    }
    const generateTime = performance.now() - startGenerate

    // Simulate graph load (what transformGraph does)
    const startLoad = performance.now()
    const store = getOpStore()

    // This is a simplified simulation - actual transformGraph does more
    for (const node of nodes) {
      // In real code, operators are instantiated here
      store.setOp(node.id, { id: node.id } as never)
    }
    const loadTime = performance.now() - startLoad

    console.log(`[Baseline] Generate ${nodeCount} nodes/edges: ${generateTime.toFixed(2)}ms`)
    console.log(`[Baseline] Load ${nodeCount} operators: ${loadTime.toFixed(2)}ms`)
    console.log(`[Baseline] Total: ${(generateTime + loadTime).toFixed(2)}ms`)

    // Baseline expectations (generous, will tighten after measurements)
    expect(generateTime).toBeLessThan(100)
    expect(loadTime).toBeLessThan(500)

    // Record for comparison
    return { generateTime, loadTime, nodeCount, edgeCount: edges.length }
  })

  it('should measure node update performance', () => {
    const iterations = 1000
    const nodes: ReactFlowNode[] = []

    // Create initial nodes
    for (let i = 0; i < 10; i++) {
      nodes.push({
        id: `/node-${i}`,
        type: 'NumberOp',
        position: { x: i * 100, y: 0 },
        data: { inputs: { value: 0 } },
      })
    }

    // Measure update time
    const startUpdate = performance.now()
    for (let i = 0; i < iterations; i++) {
      // Simulate position update (what setNodes does on drag)
      const nodeId = `/node-${i % 10}`
      const node = nodes.find(n => n.id === nodeId)
      if (node) {
        node.position = { x: node.position.x + 1, y: node.position.y }
      }
    }
    const updateTime = performance.now() - startUpdate

    console.log(`[Baseline] ${iterations} node updates: ${updateTime.toFixed(2)}ms`)
    console.log(`[Baseline] Avg per update: ${(updateTime / iterations).toFixed(3)}ms`)

    expect(updateTime).toBeLessThan(100)
    return { updateTime, iterations, avgPerUpdate: updateTime / iterations }
  })

  it('should measure edge connection performance', () => {
    const edgeCount = 1000
    const edges: ReactFlowEdge[] = []

    const startConnect = performance.now()
    for (let i = 0; i < edgeCount; i++) {
      edges.push({
        id: `e-${i}`,
        source: `/node-${i % 10}`,
        target: `/node-${(i + 1) % 10}`,
        sourceHandle: 'out.value',
        targetHandle: 'par.value',
      })
    }
    const connectTime = performance.now() - startConnect

    console.log(`[Baseline] ${edgeCount} edge connections: ${connectTime.toFixed(2)}ms`)
    console.log(`[Baseline] Avg per edge: ${(connectTime / edgeCount).toFixed(3)}ms`)

    expect(connectTime).toBeLessThan(50)
    return { connectTime, edgeCount, avgPerEdge: connectTime / edgeCount }
  })

  it('should measure batch update performance', () => {
    const batchSize = 50
    const nodes: ReactFlowNode[] = []

    // Create nodes
    for (let i = 0; i < batchSize; i++) {
      nodes.push({
        id: `/node-${i}`,
        type: 'NumberOp',
        position: { x: i * 100, y: 0 },
        data: { inputs: { value: i } },
      })
    }

    // Measure batch update (simulating what batch() should do)
    const startBatch = performance.now()
    getOpStore().batch(() => {
      for (let i = 0; i < batchSize; i++) {
        const node = nodes[i]
        getOpStore().setOp(node.id, { id: node.id, value: node.data.inputs.value } as never)
      }
    })
    const batchTime = performance.now() - startBatch

    console.log(`[Baseline] Batch update ${batchSize} nodes: ${batchTime.toFixed(2)}ms`)

    expect(batchTime).toBeLessThan(100)
    return { batchTime, batchSize }
  })
})
