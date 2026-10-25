import { ControlButton, Panel } from '@xyflow/react'
import { create } from 'zustand'
import { analytics } from '../../utils/analytics'
import s from './canvas-quickstart.module.css'

// A card for first-time users on how to move around the graph canvas. It shows until
// dismissed, and the ? button in the canvas controls brings it back.

const DISMISSED_KEY = 'noodles-canvas-quickstart-dismissed'

export function canvasQuickstartDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Storage blocked: the card comes back next time, which is harmless
  }
}

interface QuickstartState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useCanvasQuickstart = create<QuickstartState>(set => ({
  open: !canvasQuickstartDismissed(),
  setOpen: open => {
    if (!open) saveDismissed()
    set({ open })
    analytics.track(open ? 'canvas_quickstart_opened' : 'canvas_quickstart_dismissed')
  },
}))

const TIPS: { action: string; result: string }[] = [
  { action: 'Drag the background', result: 'to move around' },
  { action: 'Scroll or pinch', result: 'to zoom' },
  { action: 'Click a node', result: 'to edit its properties in the side panel' },
  { action: 'Drag from a dot on a node', result: 'to another dot to connect them' },
  { action: 'Right-click or press A', result: 'to add a node' },
]

// Rendered inside <ReactFlow>
export function CanvasQuickstart() {
  const open = useCanvasQuickstart(state => state.open)
  const setOpen = useCanvasQuickstart(state => state.setOpen)
  if (!open) return null

  return (
    <Panel position="bottom-left" className={s.card}>
      <section aria-labelledby="canvas-quickstart-title">
        <div className={s.header}>
          <h2 id="canvas-quickstart-title" className={s.title}>
            Getting around
          </h2>
          <button
            type="button"
            className={s.close}
            onClick={() => setOpen(false)}
            aria-label="Dismiss canvas tips"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
        <ul className={s.tips}>
          {TIPS.map(tip => (
            <li key={tip.action}>
              <strong>{tip.action}</strong> {tip.result}
            </li>
          ))}
        </ul>
        <button type="button" className={s.gotIt} onClick={() => setOpen(false)}>
          Got it
        </button>
      </section>
    </Panel>
  )
}

// Rendered inside <Controls>, so it sits with the zoom buttons
export function CanvasQuickstartButton() {
  const open = useCanvasQuickstart(state => state.open)
  const setOpen = useCanvasQuickstart(state => state.setOpen)
  const label = open ? 'Hide canvas tips' : 'Show canvas tips'
  return (
    <ControlButton onClick={() => setOpen(!open)} title={label} aria-label={label}>
      <span className={s.helpGlyph}>?</span>
    </ControlButton>
  )
}
