import { describe, expect, it } from 'vitest'
import { computeVisibilityHeuristic } from './visibility-heuristic'

// Mock operator with configurable fields
function mockOp(fields: Record<string, { showByDefault: boolean }>) {
  return {
    inputs: Object.fromEntries(
      Object.entries(fields).map(([name, { showByDefault }]) => [name, { showByDefault }])
    ),
  } as any
}

describe('computeVisibilityHeuristic', () => {
  it('includes fields with showByDefault: true', () => {
    const op = mockOp({ visible: { showByDefault: true }, hidden: { showByDefault: false } })
    const { visibleFields, differsFromDefaults } = computeVisibilityHeuristic(op, {}, new Set())

    expect(visibleFields.has('visible')).toBe(true)
    expect(visibleFields.has('hidden')).toBe(false)
    expect(differsFromDefaults).toBe(false)
  })

  it('includes fields with custom values', () => {
    const op = mockOp({ a: { showByDefault: false }, b: { showByDefault: false } })
    const { visibleFields, differsFromDefaults } = computeVisibilityHeuristic(
      op,
      { a: 'custom' }, // a has custom value
      new Set()
    )

    expect(visibleFields.has('a')).toBe(true)
    expect(visibleFields.has('b')).toBe(false)
    expect(differsFromDefaults).toBe(true)
  })

  it('includes fields with connections', () => {
    const op = mockOp({ a: { showByDefault: false }, b: { showByDefault: false } })
    const { visibleFields, differsFromDefaults } = computeVisibilityHeuristic(
      op,
      {},
      new Set(['a']) // a has connection
    )

    expect(visibleFields.has('a')).toBe(true)
    expect(visibleFields.has('b')).toBe(false)
    expect(differsFromDefaults).toBe(true)
  })

  it('combines all conditions (showByDefault OR value OR connection)', () => {
    const op = mockOp({
      byDefault: { showByDefault: true },
      byValue: { showByDefault: false },
      byConnection: { showByDefault: false },
      hidden: { showByDefault: false },
    })
    const { visibleFields, differsFromDefaults } = computeVisibilityHeuristic(
      op,
      { byValue: 42 },
      new Set(['byConnection'])
    )

    expect(visibleFields.has('byDefault')).toBe(true)
    expect(visibleFields.has('byValue')).toBe(true)
    expect(visibleFields.has('byConnection')).toBe(true)
    expect(visibleFields.has('hidden')).toBe(false)
    expect(differsFromDefaults).toBe(true)
  })

  it('returns differsFromDefaults: false when only showByDefault fields are visible', () => {
    const op = mockOp({ a: { showByDefault: true }, b: { showByDefault: true } })
    const { differsFromDefaults } = computeVisibilityHeuristic(op, {}, new Set())

    expect(differsFromDefaults).toBe(false)
  })
})
