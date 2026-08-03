import { describe, expect, it } from 'vitest'
import { computeVisibleCount } from './overflow'

describe('computeVisibleCount', () => {
  it('fits everything when there is room', () => {
    expect(computeVisibleCount([50, 50, 50], 1000, 4)).toBe(3)
  })

  it('counts the gaps between items but not before the first', () => {
    // 50 + 4 + 50 = 104 fits exactly; adding the third needs 158
    expect(computeVisibleCount([50, 50, 50], 104, 4)).toBe(2)
    expect(computeVisibleCount([50], 50, 4)).toBe(1)
  })

  it('drops everything when the first item cannot fit', () => {
    expect(computeVisibleCount([50, 50], 40, 4)).toBe(0)
    expect(computeVisibleCount([50], 0, 4)).toBe(0)
    expect(computeVisibleCount([50], -10, 4)).toBe(0)
  })

  it('handles an empty list', () => {
    expect(computeVisibleCount([], 500, 4)).toBe(0)
  })

  it('stops at the first item that does not fit rather than skipping it', () => {
    // A narrow third item must not sneak in after a wide second one is cut
    expect(computeVisibleCount([50, 400, 10], 100, 4)).toBe(1)
  })
})
