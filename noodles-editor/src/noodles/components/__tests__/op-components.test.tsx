// Unit tests for op-components utilities
import type { NodeProps as ReactFlowNodeProps } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { nodePropsAreEqual } from '../op-components'

// Minimal ReactFlowNodeProps for testing — only the fields nodePropsAreEqual cares about
const makeProps = (overrides: Partial<ReactFlowNodeProps> = {}): ReactFlowNodeProps =>
  ({
    id: 'node-1',
    type: 'NumberOp',
    selected: false,
    position: { x: 0, y: 0 },
    data: {},
    dragging: false,
    isConnectable: true,
    zIndex: 0,
    ...overrides,
  }) as ReactFlowNodeProps

describe('nodePropsAreEqual', () => {
  it('returns true when id, type, and selected are the same', () => {
    const prev = makeProps()
    const next = makeProps()
    expect(nodePropsAreEqual(prev, next)).toBe(true)
  })

  it('returns true when only position changes (drag frame update)', () => {
    const prev = makeProps({ position: { x: 0, y: 0 } })
    const next = makeProps({ position: { x: 50, y: 100 } })
    expect(nodePropsAreEqual(prev, next)).toBe(true)
  })

  it('returns true when only data changes', () => {
    const prev = makeProps({ data: { foo: 1 } })
    const next = makeProps({ data: { foo: 2 } })
    expect(nodePropsAreEqual(prev, next)).toBe(true)
  })

  it('returns true when only dragging flag changes', () => {
    const prev = makeProps({ dragging: false })
    const next = makeProps({ dragging: true })
    expect(nodePropsAreEqual(prev, next)).toBe(true)
  })

  it('returns false when id changes', () => {
    const prev = makeProps({ id: 'node-1' })
    const next = makeProps({ id: 'node-2' })
    expect(nodePropsAreEqual(prev, next)).toBe(false)
  })

  it('returns false when type changes', () => {
    const prev = makeProps({ type: 'NumberOp' })
    const next = makeProps({ type: 'FileOp' })
    expect(nodePropsAreEqual(prev, next)).toBe(false)
  })

  it('returns false when selected changes to true', () => {
    const prev = makeProps({ selected: false })
    const next = makeProps({ selected: true })
    expect(nodePropsAreEqual(prev, next)).toBe(false)
  })

  it('returns false when selected changes to false', () => {
    const prev = makeProps({ selected: true })
    const next = makeProps({ selected: false })
    expect(nodePropsAreEqual(prev, next)).toBe(false)
  })
})

describe('headerClass caching', () => {
  it('should cache category lookups for O(1) performance', () => {
    const { headerClass } = require('../op-components')

    // First call - should populate cache
    const result1 = headerClass('NumberOp')
    expect(result1).toBeDefined()

    // Second call - should use cache (same result)
    const result2 = headerClass('NumberOp')
    expect(result2).toBe(result1)

    // Different type
    const result3 = headerClass('FileOp')
    expect(result3).toBeDefined()
    expect(result3).not.toBe(result1)

    // Same type again - should use cache
    const result4 = headerClass('NumberOp')
    expect(result4).toBe(result1)
  })

  it('should handle display name fallback correctly', () => {
    const { headerClass } = require('../op-components')

    // Test with actual operator type
    const result1 = headerClass('DeckRendererOp')
    expect(result1).toBeDefined()

    // Should cache and return same result
    const result2 = headerClass('DeckRendererOp')
    expect(result2).toBe(result1)
  })

  it('should default to data category for unknown types', () => {
    const { headerClass } = require('../op-components')

    const result = headerClass('UnknownOperatorType' as any)
    expect(result).toBeDefined()

    // Should cache the default
    const result2 = headerClass('UnknownOperatorType' as any)
    expect(result2).toBe(result)
  })
})
