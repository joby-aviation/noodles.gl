import { describe, expect, it } from 'vitest'
import {
  insertionIndex,
  MIN_PILL_HEIGHT,
  pillHeight,
  SLOT_SPACING,
  slotOffsetY,
} from './multi-port'

describe('multi input slots', () => {
  it('is a pill with no wires and grows a slot per wire', () => {
    expect(pillHeight(0)).toBe(MIN_PILL_HEIGHT)
    expect(pillHeight(1)).toBe(MIN_PILL_HEIGHT)
    expect(pillHeight(4)).toBeGreaterThan(pillHeight(3))
  })

  it('spreads wires evenly around the pill center', () => {
    expect(slotOffsetY(0, 1)).toBe(0)
    expect(slotOffsetY(0, 3)).toBe(-SLOT_SPACING)
    expect(slotOffsetY(2, 3)).toBe(SLOT_SPACING)
  })

  it('picks the slot boundary nearest the pointer, clamped to the pill', () => {
    expect(insertionIndex(100, 100, 0)).toBe(0)
    // Two wires: boundaries at -1, 0 and +1 spacing from the center
    expect(insertionIndex(100 - SLOT_SPACING, 100, 2)).toBe(0)
    expect(insertionIndex(101, 100, 2)).toBe(1)
    expect(insertionIndex(100 + SLOT_SPACING, 100, 2)).toBe(2)
    expect(insertionIndex(1000, 100, 2)).toBe(2)
    expect(insertionIndex(-1000, 100, 2)).toBe(0)
  })
})
