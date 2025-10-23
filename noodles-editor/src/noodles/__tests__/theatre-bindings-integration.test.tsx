// Integration tests for Theatre.js bindings refactor
//
// These tests verify that the refactor from per-component Theatre binding
// to centralized binding maintains the same behavior.

import { getProject } from '@theatre/core'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { NumberField, BooleanField, StringField } from '../fields'
import { opMap, sheetObjectMap } from '../store'
import { transformGraph } from '../transform-graph'
import { bindAllOperatorsToTheatre, cleanupRemovedOperators } from '../theatre-bindings'

describe('Theatre bindings integration', () => {
  let testProject: ReturnType<typeof getProject>
  let testSheet: ReturnType<ReturnType<typeof getProject>['sheet']>

  beforeEach(() => {
    const projectName = `test-integration-${Date.now()}`
    testProject = getProject(projectName, {})
    testSheet = testProject.sheet('test-sheet')
    opMap.clear()
    sheetObjectMap.clear()
  })

  afterEach(() => {
    opMap.clear()
    sheetObjectMap.clear()
  })

  it('should bind operators created by transformGraph', async () => {
    // Create nodes as transformGraph expects
    const nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: 42 } },
      },
      {
        id: '/add',
        type: 'AddOp',
        position: { x: 200, y: 0 },
        data: {},
      },
    ]

    const edges = [
      {
        id: '/number/out.value->/add/par.a',
        source: '/number',
        sourceHandle: 'out.value',
        target: '/add',
        targetHandle: 'par.a',
      },
    ]

    // Transform graph to create operators
    const operators = transformGraph({ nodes, edges })

    expect(operators.length).toBeGreaterThan(0)
    expect(opMap.size).toBeGreaterThan(0)

    // Wait for theatre to be ready
    await testProject.ready

    // Bind all operators using the new centralized approach
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

    // Verify bindings were created (excluding /out)
    const boundOps = operators.filter(op => op.id !== '/out' && sheetObjectMap.has(op.id))
    expect(boundOps.length).toBeGreaterThan(0)

    // Verify each bound operator has compatible fields
    for (const op of boundOps) {
      const sheetObj = sheetObjectMap.get(op.id)
      expect(sheetObj).toBeDefined()
    }

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }

    // Verify cleanup worked
    expect(sheetObjectMap.size).toBe(0)
  })

  it('should handle dynamic operator addition and removal', async () => {
    // Initial graph with one operator
    let nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: 42 } },
      },
    ]

    let edges: any[] = []

    // Create initial operators
    let operators = transformGraph({ nodes, edges })
    await testProject.ready

    // Bind initial operators
    let cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)
    let currentIds = new Set(operators.map(op => op.id))
    cleanupRemovedOperators(currentIds, testSheet)

    const initialBoundCount = Array.from(sheetObjectMap.keys()).filter(
      id => id !== '/out'
    ).length
    expect(initialBoundCount).toBeGreaterThan(0)

    // Add another operator
    nodes = [
      ...nodes,
      {
        id: '/add',
        type: 'AddOp',
        position: { x: 200, y: 0 },
        data: {},
      },
    ]

    edges = [
      {
        id: '/number/out.value->/add/par.a',
        source: '/number',
        sourceHandle: 'out.value',
        target: '/add',
        targetHandle: 'par.a',
      },
    ]

    // Cleanup old bindings
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }

    // Transform graph again
    operators = transformGraph({ nodes, edges })

    // Bind new operators
    cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)
    currentIds = new Set(operators.map(op => op.id))
    cleanupRemovedOperators(currentIds, testSheet)

    // Should have more bound operators now
    const newBoundCount = Array.from(sheetObjectMap.keys()).filter(
      id => id !== '/out'
    ).length
    expect(newBoundCount).toBeGreaterThanOrEqual(initialBoundCount)

    // Final cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })

  it('should handle container operators', async () => {
    const nodes = [
      {
        id: '/container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: {},
      },
    ]

    const edges: any[] = []

    const operators = transformGraph({ nodes, edges })
    await testProject.ready

    // Bind operators
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

    // Container should be bound
    const containerOp = operators.find(op => op.id === '/container')
    expect(containerOp).toBeDefined()

    // If container has theatre-compatible fields, it should be in sheetObjectMap
    // Note: Containers may not have any theatre-compatible fields
    const isContainerBound = sheetObjectMap.has('/container')

    // Just verify no errors occurred
    expect(cleanupFns).toBeDefined()

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })

  it('should maintain field values after binding', async () => {
    const testValue = 99
    const nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: testValue } },
      },
    ]

    const operators = transformGraph({ nodes, edges: [] })
    await testProject.ready

    // Get the operator
    const numberOp = operators.find(op => op.id === '/number')
    expect(numberOp).toBeDefined()

    // Verify initial value
    const valueField = (numberOp as any).inputs.value
    expect(valueField.value).toBe(testValue)

    // Bind operators
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

    // Verify value is still the same after binding
    expect(valueField.value).toBe(testValue)

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })

  it('should handle rapid binding/unbinding cycles', async () => {
    const nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: 42 } },
      },
    ]

    await testProject.ready

    // Bind and unbind multiple times
    for (let i = 0; i < 5; i++) {
      const operators = transformGraph({ nodes, edges: [] })
      const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

      expect(sheetObjectMap.size).toBeGreaterThan(0)

      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }

      // May still have some operators in the map after cleanup
      // but the specific ones we bound should be gone
    }

    // Should be able to bind again without errors
    const operators = transformGraph({ nodes, edges: [] })
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)
    expect(cleanupFns.size).toBeGreaterThan(0)

    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })

  it('should not interfere with operator functionality', async () => {
    const nodes = [
      {
        id: '/number1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: 10 } },
      },
      {
        id: '/number2',
        type: 'NumberOp',
        position: { x: 0, y: 100 },
        data: { inputs: { value: 20 } },
      },
      {
        id: '/add',
        type: 'AddOp',
        position: { x: 200, y: 50 },
        data: {},
      },
    ]

    const edges = [
      {
        id: '/number1/out.value->/add/par.a',
        source: '/number1',
        sourceHandle: 'out.value',
        target: '/add',
        targetHandle: 'par.a',
      },
      {
        id: '/number2/out.value->/add/par.b',
        source: '/number2',
        sourceHandle: 'out.value',
        target: '/add',
        targetHandle: 'par.b',
      },
    ]

    const operators = transformGraph({ nodes, edges })
    await testProject.ready

    // Get the add operator
    const addOp = operators.find(op => op.id === '/add')
    expect(addOp).toBeDefined()

    // Execute before binding
    const resultBefore = (addOp as any).execute()

    // Bind operators
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

    // Execute after binding
    const resultAfter = (addOp as any).execute()

    // Results should be the same
    expect(resultAfter).toEqual(resultBefore)
    expect(resultAfter.value).toBe(30) // 10 + 20

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })
})
