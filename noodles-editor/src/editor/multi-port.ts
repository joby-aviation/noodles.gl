// A multi input (the deck's layers, a union's tables) draws as a pill where a single input is a
// dot, and grows a slot per wire, in the wires' order. A wire lands on its slot, and a drag onto the
// pill drops at the slot boundary nearest the pointer.

export const SLOT_HEIGHT = 6
export const SLOT_GAP = 1.5
export const SLOT_SPACING = SLOT_HEIGHT + SLOT_GAP

// Tall enough to read as a pill with no wires or one
export const MIN_PILL_HEIGHT = 15

// The pill's height for `count` wires
export function pillHeight(count: number): number {
  return Math.max(MIN_PILL_HEIGHT, count * SLOT_HEIGHT + (count - 1) * SLOT_GAP)
}

// A wire's offset from the pill's center: slot `index` of `count`
export function slotOffsetY(index: number, count: number): number {
  return (index - (count - 1) / 2) * SLOT_SPACING
}

// The slot boundary, 0 to `count`, nearest a pointer: boundary i sits between slot i - 1 and
// slot i. Both heights are in flow coordinates, so the answer doesn't depend on zoom.
export function insertionIndex(pointerY: number, centerY: number, count: number): number {
  if (count <= 0) return 0
  const raw = (pointerY - centerY) / SLOT_SPACING + count / 2
  return Math.max(0, Math.min(count, Math.round(raw)))
}
