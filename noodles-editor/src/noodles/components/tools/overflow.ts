// Shelf overflow maths, kept separate from the component so it can be tested without
// a layout engine. Widths come from a hidden measurement row rendered at natural size.

// How many of `widths` fit in `available` pixels, laid out in a row separated by `gap`.
// Returns 0 when not even the first item fits, so the caller puts everything in More.
export function computeVisibleCount(widths: number[], available: number, gap: number): number {
  if (available <= 0) return 0
  let used = 0
  for (let i = 0; i < widths.length; i++) {
    const next = used + widths[i] + (i > 0 ? gap : 0)
    if (next > available) return i
    used = next
  }
  return widths.length
}

export interface ShelfLayout {
  // Number of leading items that get their own button
  visibleCount: number
  // Whether a More button is needed to hold the rest
  showMore: boolean
}

// Decide how many shelf items get their own button, and whether More is needed at all.
//
// Two passes, because the answers depend on each other: More occupies space, but it
// only exists if something overflowed. So first check whether everything fits with no
// More; only when it does not, redo the fit against the narrower space that leaves
// room for the More button.
export function computeShelfLayout(
  widths: number[],
  available: number,
  gap: number,
  moreWidth: number
): ShelfLayout {
  if (computeVisibleCount(widths, available, gap) === widths.length) {
    return { visibleCount: widths.length, showMore: false }
  }
  return {
    visibleCount: computeVisibleCount(widths, available - moreWidth - gap, gap),
    showMore: true,
  }
}
