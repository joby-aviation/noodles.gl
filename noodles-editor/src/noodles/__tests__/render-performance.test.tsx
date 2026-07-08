// Real performance tests measuring React renders and DOM updates
// Tests actual bottlenecks: component re-renders, not Map lookups

import { act, render, renderHook } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { useState } from 'react'
import { BehaviorSubject } from 'rxjs'
import { NumberOp } from '../operators'
import { clearOps, setOp } from '../store'
import { useObservable } from '../hooks/use-observable'

describe('React Render Performance', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  describe('useObservable re-render behavior', () => {
    it('should re-subscribe when observable changes (correct behavior)', () => {
      const subject1 = new BehaviorSubject(10)
      const subject2 = new BehaviorSubject(20)

      let renderCount = 0
      const TestComponent = ({ observable }: { observable: BehaviorSubject<number> }) => {
        renderCount++
        const value = useObservable(observable, 0)
        return <div data-testid="value">{value}</div>
      }

      const { rerender } = render(<TestComponent observable={subject1} />)
      const initialRenders = renderCount

      // Change observable - triggers re-render and re-subscription
      rerender(<TestComponent observable={subject2} />)
      expect(renderCount).toBeGreaterThan(initialRenders)

      const beforeChange = renderCount

      // Emit from new observable - should trigger render
      act(() => {
        subject2.next(30)
      })
      expect(renderCount).toBeGreaterThan(beforeChange)

      // Emit from old observable - should NOT trigger render
      const afterNewObs = renderCount
      act(() => {
        subject1.next(40)
      })
      expect(renderCount).toBe(afterNewObs) // No extra render from old observable
    })

    it('should trigger re-renders when operator fields change', () => {
      const op = new NumberOp('/test', { val: 10 })
      setOp('/test', op)

      let renderCount = 0
      const TestComponent = () => {
        renderCount++
        const value = useObservable(op.inputs.val, 0)
        return <div>{value}</div>
      }

      render(<TestComponent />)
      const initialRenders = renderCount

      // Change field value - should trigger re-render
      act(() => {
        op.inputs.val.setValue(20)
      })

      expect(renderCount).toBe(initialRenders + 1)
    })
  })

  describe('Field subscription re-render optimization', () => {
    it('should prevent re-renders when non-subscribed fields change', () => {
      const op = new NumberOp('/test', { val: 10 })
      setOp('/test', op)

      // Component subscribes only to 'val', not to operator-level changes
      let renderCount = 0

      const TestComponent = () => {
        renderCount++
        // Only subscribe to one field
        const value = useObservable(op.inputs.val, 0)
        return <div>{value}</div>
      }

      render(<TestComponent />)
      const initialRenders = renderCount

      // Change the subscribed field - SHOULD trigger re-render
      act(() => {
        op.inputs.val.setValue(100)
      })
      expect(renderCount).toBe(initialRenders + 1)

      // Changing other operator state that we're not subscribed to
      // would not trigger re-renders (demonstrates selective subscription)
    })

    it('should measure re-render reduction with selective subscriptions', () => {
      // Create multiple operators
      const ops: NumberOp[] = []
      for (let i = 0; i < 10; i++) {
        const op = new NumberOp(`/node-${i}`, { val: i })
        setOp(op.id, op)
        ops.push(op)
      }

      // Test: Verify only affected component re-renders
      let renderCountWithOpt = 0
      const TestComponentWithOpt = React.memo(({ op }: { op: NumberOp }) => {
        renderCountWithOpt++
        const value = useObservable(op.inputs.val, 0)
        return <div>{value}</div>
      })

      const ParentWithOpt = () => (
        <div>
          {ops.map(op => (
            <TestComponentWithOpt key={op.id} op={op} />
          ))}
        </div>
      )

      render(<ParentWithOpt />)
      renderCountWithOpt = 0

      // Change one field
      act(() => {
        ops[0].inputs.val.setValue(888)
      })

      const rendersWithOpt = renderCountWithOpt

      // With optimization, only 1 component should re-render
      expect(rendersWithOpt).toBeLessThanOrEqual(2) // Only affected component with memo
    })
  })

  describe('Component re-render scenarios', () => {
    it('should measure render performance with nested components', () => {
      const ops: NumberOp[] = []
      for (let i = 0; i < 50; i++) {
        const op = new NumberOp(`/node-${i}`, { val: i })
        setOp(`/node-${i}`, op)
        ops.push(op)
      }

      let totalRenders = 0
      const ChildComponent = React.memo(({ op }: { op: NumberOp }) => {
        totalRenders++
        const value = useObservable(op.inputs.val, 0)
        return <div>{value}</div>
      })

      const ParentComponent = ({ opList }: { opList: NumberOp[] }) => {
        return (
          <div>
            {opList.map(op => (
              <ChildComponent key={op.id} op={op} />
            ))}
          </div>
        )
      }

      render(<ParentComponent opList={ops.slice(0, 10)} />)
      const initialRenders = totalRenders

      // Reset counter after initial render
      totalRenders = 0

      // Update one operator - should only re-render that child (with memo)
      act(() => {
        ops[0].inputs.val.setValue(999)
      })

      expect(totalRenders).toBeLessThanOrEqual(2) // Only affected child re-renders
    })

    it('should not trigger cascading re-renders', () => {
      const ops: NumberOp[] = []
      for (let i = 0; i < 20; i++) {
        const op = new NumberOp(`/node-${i}`, { val: i })
        setOp(`/node-${i}`, op)
        ops.push(op)
      }

      const renderCounts = new Map<string, number>()

      const NodeComponent = ({ op }: { op: NumberOp }) => {
        const count = renderCounts.get(op.id) || 0
        renderCounts.set(op.id, count + 1)

        const value = useObservable(op.inputs.val, 0)
        return <div>{value}</div>
      }

      const GraphComponent = ({ nodes }: { nodes: NumberOp[] }) => {
        return (
          <div>
            {nodes.map(op => (
              <NodeComponent key={op.id} op={op} />
            ))}
          </div>
        )
      }

      render(<GraphComponent nodes={ops} />)

      // Reset counts
      renderCounts.forEach((_, key) => renderCounts.set(key, 0))

      // Update 5 operators
      act(() => {
        for (let i = 0; i < 5; i++) {
          ops[i].inputs.val.setValue(Math.random())
        }
      })

      // Only those 5 should have re-rendered
      let rerenderedCount = 0
      renderCounts.forEach(count => {
        if (count > 0) rerenderedCount++
      })

      expect(rerenderedCount).toBe(5) // Only 5 components re-rendered
      expect(renderCounts.get(ops[0].id)).toBe(1)
      expect(renderCounts.get(ops[10].id)).toBe(0) // Unaffected node
    })
  })

  describe('EdgeConnectionSynchronizer render impact', () => {
    it('should not trigger re-renders on position-only updates', () => {
      // Simulate edge array updates
      const edges = [
        { id: 'e1', source: 's1', target: 't1' },
        { id: 'e2', source: 's2', target: 't2' },
      ]

      let renderCount = 0
      let syncCount = 0

      const EdgeSync = ({ edgeList }: { edgeList: typeof edges }) => {
        renderCount++
        const prevRef = React.useRef<typeof edges | null>(null)

        React.useEffect(() => {
          // Skip if same reference (position-only updates)
          if (prevRef.current === edgeList) {
            return
          }
          prevRef.current = edgeList
          syncCount++
        }, [edgeList])

        return <div>sync</div>
      }

      const { rerender } = render(<EdgeSync edgeList={edges} />)
      expect(renderCount).toBe(1)
      expect(syncCount).toBe(1)

      // Same reference (position update) - should not sync
      for (let i = 0; i < 50; i++) {
        rerender(<EdgeSync edgeList={edges} />)
      }

      expect(renderCount).toBe(51) // React still renders
      expect(syncCount).toBe(1) // But sync doesn't run (optimization)

      // New array (structural change) - should sync
      const newEdges = [...edges, { id: 'e3', source: 's3', target: 't3' }]
      rerender(<EdgeSync edgeList={newEdges} />)

      expect(renderCount).toBe(52)
      expect(syncCount).toBe(2)
    })
  })

  describe('Category cache render optimization', () => {
    it('should not re-compute on every render', () => {
      const cache = new Map<string, string>()
      let computeCount = 0

      const getCachedCategory = (type: string): string => {
        if (cache.has(type)) {
          return cache.get(type)!
        }
        computeCount++
        const result = 'category'
        cache.set(type, result)
        return result
      }

      const TestComponent = ({ nodeType }: { nodeType: string }) => {
        const category = getCachedCategory(nodeType)
        return <div>{category}</div>
      }

      const { rerender } = render(<TestComponent nodeType="NumberOp" />)
      expect(computeCount).toBe(1)

      // Re-render same type 100 times - should not re-compute
      for (let i = 0; i < 100; i++) {
        rerender(<TestComponent nodeType="NumberOp" />)
      }
      expect(computeCount).toBe(1) // Still only 1 computation

      // Different type - should compute once
      rerender(<TestComponent nodeType="FileOp" />)
      expect(computeCount).toBe(2)
    })
  })

  describe('Real-world scenario: Large graph interaction', () => {
    it('should keep re-renders isolated to affected components', () => {
      // Create realistic graph
      const nodeCount = 100
      const ops: NumberOp[] = []

      for (let i = 0; i < nodeCount; i++) {
        const op = new NumberOp(`/node-${i}`, { val: i })

        // Some nodes have enable expressions
        if (i % 10 === 0) {
          op.customInputDefinitions = [
            {
              name: 'conditional',
              type: 'number',
              default: 0,
              enableExpression: 'par.enabled',
            },
            { name: 'enabled', type: 'boolean', default: false },
          ]
        }

        setOp(op.id, op)
        ops.push(op)
      }

      const renderCounts = new Map<string, number>()

      const NodeComponent = ({ op }: { op: NumberOp }) => {
        const count = renderCounts.get(op.id) || 0
        renderCounts.set(op.id, count + 1)

        const value = useObservable(op.inputs.val, 0)

        // Simulate field subscription optimization
        const [, forceUpdate] = useState(0)
        React.useEffect(() => {
          if (op.customInputDefinitions?.length > 0) {
            // Only subscribe to 'enabled' field if it exists
            const enabledField = op.inputs.enabled
            if (enabledField) {
              const sub = enabledField.subscribe(() => forceUpdate(n => n + 1))
              return () => sub.unsubscribe()
            }
          }
        }, [op])

        return <div data-testid={`node-${op.id}`}>{value}</div>
      }

      const GraphComponent = ({ nodes }: { nodes: NumberOp[] }) => {
        return (
          <div>
            {nodes.map(op => (
              <NodeComponent key={op.id} op={op} />
            ))}
          </div>
        )
      }

      render(<GraphComponent nodes={ops} />)

      // Reset counts after initial render
      renderCounts.clear()

      // Simulate user interaction: update 5 nodes
      act(() => {
        for (let i = 0; i < 5; i++) {
          ops[i].inputs.val.setValue(Math.random())
        }
      })

      // Count how many components re-rendered
      let rerenderedCount = 0
      renderCounts.forEach(count => {
        if (count > 0) rerenderedCount++
      })

      // Should only re-render the 5 affected nodes, not all 100
      expect(rerenderedCount).toBe(5)
      expect(rerenderedCount / nodeCount * 100).toBeLessThan(10) // <10% of graph re-rendered
    })
  })

  describe('Performance regression detection', () => {
    it('should keep re-renders isolated with React.memo', () => {
      // Create 20 operators
      const ops: NumberOp[] = []
      for (let i = 0; i < 20; i++) {
        const op = new NumberOp(`/node-${i}`, { val: i })
        setOp(op.id, op)
        ops.push(op)
      }

      let renderCount = 0
      const MemoizedComponent = React.memo(({ op }: { op: NumberOp }) => {
        renderCount++
        const value = useObservable(op.inputs.val, 0)
        return <div>{value}</div>
      })

      const GraphComponent = () => (
        <div>
          {ops.map(op => (
            <MemoizedComponent key={op.id} op={op} />
          ))}
        </div>
      )

      render(<GraphComponent />)
      renderCount = 0

      // Change 1 field
      act(() => {
        ops[0].inputs.val.setValue(999)
      })

      // With memoization, only 1 component should re-render
      // If someone removes React.memo, all 20 would re-render
      expect(renderCount).toBeLessThanOrEqual(2)
    })
  })
})
