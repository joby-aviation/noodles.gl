// Dragging a number parameter's label sideways changes its value, as in Houdini and Blender:
// one step per pixel, Shift for a tenth, Alt for ten. A click without a drag changes nothing.

import type { ParamDef } from '@noodles.gl/planner'

// Movement under this many pixels is a click on the label, not a drag
const DEAD_ZONE_PX = 2

/** The value a drag of `dx` pixels from `from` sets. */
export function scrubValue(
  def: Pick<ParamDef, 'kind' | 'step' | 'min' | 'max'>,
  from: number,
  dx: number,
  { fine = false, coarse = false } = {}
): number {
  const base = def.step ?? (def.kind === 'int' ? 1 : 0.01)
  const scale = fine ? 0.1 : coarse ? 10 : 1
  let v = from + dx * base * scale
  if (def.kind === 'int') v = Math.round(v)
  if (def.min !== undefined) v = Math.max(def.min, v)
  if (def.max !== undefined) v = Math.min(def.max, v)
  return Number(v.toFixed(6))
}

/** Follows the pointer from a press on a label until it is released. */
export function startScrub(
  e: { clientX: number; preventDefault(): void },
  def: Pick<ParamDef, 'kind' | 'step' | 'min' | 'max'>,
  from: number,
  set: (value: number) => void
): void {
  const start = e.clientX
  let moved = false
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - start
    if (!moved && Math.abs(dx) <= DEAD_ZONE_PX) return
    moved = true
    set(scrubValue(def, from, dx, { fine: ev.shiftKey, coarse: ev.altKey }))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  document.body.style.cursor = 'ew-resize'
  // Keeps the drag from selecting the label's text
  e.preventDefault()
}
