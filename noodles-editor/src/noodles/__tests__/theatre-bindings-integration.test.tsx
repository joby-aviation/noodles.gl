import { getProject } from '@theatre/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Edge } from '../noodles'
import {
  clearOps,
  getAllOps,
  getAllSheetObjectIds,
  getOpStore,
  getSheetObject,
  hasSheetObject,
} from '../store'
import { bindAllOperatorsToTheatre, cleanupRemovedOperators } from '../theatre-bindings'
import { transformGraph } from '../transform-graph'

describe('Theatre bindings integration', () => {
  let testProject: ReturnType<typeof getProject>
  let testSheet: ReturnType<ReturnType<typeof getProject>['sheet']>
  let testCounter = 0

  beforeEach(() => {
    // Create a unique test project (3-32 chars per Theatre requirement)
    const projectName = `integration-${testCounter++}`
    testProject = getProject(projectName, {})
    testSheet = testProject.sheet('test-sheet')
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  it('should bind operators created by transformGraph', () => {
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
        id: '/number.out.val->/add.par.a',
        source: '/number',
        sourceHandle: 'out.val',
        target: '/add',
        targetHandle: 'par.a',
      },
    ]

    // Transform graph to create operators
    const operators = transformGraph({ nodes, edges })

    expect(operators.length).toBeGreaterThan(0)
    expect(getAllOps().length).toBeGreaterThan(0)

    // Bind all operators using the new centralized approach
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

    // Verify bindings were created
    const boundOps = operators.filter(op => hasSheetObject(op.id))
    expect(boundOps.length).toBeGreaterThan(0)

    // Verify each bound operator has compatible fields
    for (const op of boundOps) {
      const sheetObj = getSheetObject(op.id)
      expect(sheetObj).toBeDefined()
    }

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }

    // Verify cleanup worked
    expect(getOpStore().sheetObjects.size).toBe(0)
  })

  it('should handle dynamic operator addition and removal', () => {
    // Initial graph with one operator
    let nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: 42 } },
      },
    ]

    let edges: Edge<any, any>[] = []

    // Create initial operators
    let operators = transformGraph({ nodes, edges })

    // Bind initial operators
    let cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)
    let currentIds = new Set(operators.map(op => op.id))
    cleanupRemovedOperators(currentIds, testSheet)

    const initialBoundCount = getAllSheetObjectIds().length
    expect(initialBoundCount).toBe(1)

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
    const newBoundCount = getAllSheetObjectIds().filter(id => id !== '/out').length
    expect(newBoundCount).toBeGreaterThanOrEqual(initialBoundCount)

    // Final cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })

  it('should handle container operators', () => {
    const nodes = [
      {
        id: '/container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: {},
      },
      {
        id: '/container/number-in-container',
        type: 'NumberOp',
        position: { x: 200, y: 0 },
        data: { inputs: { value: 7 } },
      },
    ]

    const edges: Edge<any, any>[] = []

    const operators = transformGraph({ nodes, edges })

    // Bind operators
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

    // Both container and child operator should be found
    const containerOp = operators.find(op => op.id === '/container')
    const childOp = operators.find(op => op.id === '/container/number-in-container')
    expect(containerOp).toBeDefined()
    expect(childOp).toBeDefined()

    // Child operator inside container should be bound to Theatre
    // (Container itself may not have compatible fields)
    expect(hasSheetObject('/container/number-in-container')).toBe(true)

    // Verify cleanup functions were created
    expect(cleanupFns).toBeDefined()

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })

  it('should maintain field values after binding', () => {
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

    // Get the operator
    const numberOp = operators.find(op => op.id === '/number')
    expect(numberOp).toBeDefined()

    // Find any number field in the operator's inputs
    const numberFields = Object.values((numberOp as any).inputs || {}).filter(
      (field: any) => field && typeof field.value === 'number'
    )

    if (numberFields.length > 0) {
      const valueField = numberFields[0] as any
      const initialValue = valueField.value

      // Bind operators
      const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

      // Verify value is still the same after binding
      expect(valueField.value).toBe(initialValue)

      // Cleanup
      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }
    } else {
      // If no number fields, just verify binding works without error
      const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)
      expect(cleanupFns).toBeDefined()
      for (const cleanup of cleanupFns.values()) {
        cleanup()
      }
    }
  })

  it('should handle rapid binding/unbinding cycles', () => {
    const nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: 42 } },
      },
    ]

    // Bind and unbind multiple times
    for (let i = 0; i < 5; i++) {
      const operators = transformGraph({ nodes, edges: [] })
      const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

      expect(getOpStore().sheetObjects.size).toBeGreaterThan(0)

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

  it('should not interfere with operator functionality', () => {
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
        id: '/number1.out.val->/add.par.a',
        source: '/number1',
        sourceHandle: 'out.val',
        target: '/add',
        targetHandle: 'par.a',
      },
      {
        id: '/number2.out.val->/add.par.b',
        source: '/number2',
        sourceHandle: 'out.val',
        target: '/add',
        targetHandle: 'par.b',
      },
    ]

    const operators = transformGraph({ nodes, edges })

    // Verify operators were created
    expect(operators.length).toBeGreaterThan(0)

    // Bind all operators - this should not throw any errors
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)
    expect(cleanupFns).toBeDefined()

    // Verify that operators can still access their inputs after binding
    for (const op of operators) {
      if ((op as any).inputs) {
        const inputs = (op as any).inputs
        // Just verify inputs are still accessible
        expect(inputs).toBeDefined()
        expect(typeof inputs).toBe('object')
      }
    }

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }
  })

  it('should handle naming collisions for operators with same base name at different hierarchy levels', () => {
    // This test verifies the fix for issue #131
    // Operators with the same base name at different levels should not collide
    const nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { value: 2 } },
      },
      {
        id: '/container',
        type: 'ContainerOp',
        position: { x: 200, y: 0 },
        data: {},
      },
      {
        id: '/container/number',
        type: 'NumberOp',
        position: { x: 200, y: 100 },
        data: { inputs: { value: 4 } },
      },
      {
        id: '/container/subcontainer',
        type: 'ContainerOp',
        position: { x: 400, y: 0 },
        data: {},
      },
      {
        id: '/container/subcontainer/number',
        type: 'NumberOp',
        position: { x: 400, y: 100 },
        data: { inputs: { value: 6 } },
      },
    ]

    const edges: Edge<any, any>[] = []

    const operators = transformGraph({ nodes, edges })

    // Verify all operators were created
    expect(operators.length).toBeGreaterThanOrEqual(5)

    // Bind all operators - this should not throw any errors or cause collisions
    const cleanupFns = bindAllOperatorsToTheatre(operators, testSheet)

    // Verify that all three number operators have unique sheet objects
    expect(hasSheetObject('/number')).toBe(true)
    expect(hasSheetObject('/container/number')).toBe(true)
    expect(hasSheetObject('/container/subcontainer/number')).toBe(true)

    // Verify each has a distinct sheet object
    const rootNumberObj = getSheetObject('/number')
    const containerNumberObj = getSheetObject('/container/number')
    const nestedNumberObj = getSheetObject('/container/subcontainer/number')

    expect(rootNumberObj).toBeDefined()
    expect(containerNumberObj).toBeDefined()
    expect(nestedNumberObj).toBeDefined()

    // Verify they are different objects (not the same reference)
    expect(rootNumberObj).not.toBe(containerNumberObj)
    expect(rootNumberObj).not.toBe(nestedNumberObj)
    expect(containerNumberObj).not.toBe(nestedNumberObj)

    // Verify that binding all three operators with the same base name doesn't cause errors
    // This is the key test - previously this would have caused a collision
    // Now each operator gets a unique Theatre.js object name based on its full path

    // Cleanup
    for (const cleanup of cleanupFns.values()) {
      cleanup()
    }

    // Verify cleanup worked
    expect(hasSheetObject('/number')).toBe(false)
    expect(hasSheetObject('/container/number')).toBe(false)
    expect(hasSheetObject('/container/subcontainer/number')).toBe(false)
  })
})
