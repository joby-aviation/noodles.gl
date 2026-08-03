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
