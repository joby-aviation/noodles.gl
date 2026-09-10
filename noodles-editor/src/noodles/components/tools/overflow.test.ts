import { describe, expect, it } from 'vitest'
import { computeShelfLayout, computeVisibleCount } from './overflow'

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

describe('computeShelfLayout', () => {
  const MORE = 20
  const GAP = 4
  // Three items at 50 wide lay out as 50 + 4 + 50 + 4 + 50 = 158

  it('hides More entirely when every item fits', () => {
    expect(computeShelfLayout([50, 50, 50], 1000, GAP, MORE)).toEqual({
      visibleCount: 3,
      showMore: false,
    })
  })

  it('does not reserve space for More when nothing overflows', () => {
    // Two items need exactly 104. Reserving room for a More button that is not
    // needed would wrongly cut one, so the no-More fit has to be checked first.
    expect(computeShelfLayout([50, 50], 104, GAP, MORE)).toEqual({
      visibleCount: 2,
      showMore: false,
    })
  })

  it('keeps as many items visible as fit alongside More', () => {
    // 158 does not fit in 150, so More appears and takes 24, leaving 126 for
    // 50 + 4 + 50 = 104
    expect(computeShelfLayout([50, 50, 50], 150, GAP, MORE)).toEqual({
      visibleCount: 2,
      showMore: true,
    })
  })

  it('gives up an item that only fit before More claimed its space', () => {
    // Two items fit in 104 exactly, but the third overflows, and once More takes
    // its 24 only one item is left visible
    expect(computeShelfLayout([50, 50, 50], 104, GAP, MORE)).toEqual({
      visibleCount: 1,
      showMore: true,
    })
  })

  it('puts everything in More when the shelf is too narrow for any item', () => {
    expect(computeShelfLayout([50, 50], 20, GAP, MORE)).toEqual({
      visibleCount: 0,
      showMore: true,
    })
  })

  it('hides More for an empty item list', () => {
    expect(computeShelfLayout([], 500, GAP, MORE)).toEqual({ visibleCount: 0, showMore: false })
  })
})
