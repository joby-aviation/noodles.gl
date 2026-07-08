import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import s from './dockable-pane.module.css'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_RECT: Rect = { x: 80, y: 80, width: 640, height: 420 }
const TITLE_BAR_HEIGHT = 32
const MIN_WIDTH = 320
const MIN_HEIGHT = 240

function clampSize(rect: Rect): Rect {
  return {
    ...rect,
    width: Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth * 0.95),
    height: Math.min(Math.max(rect.height, MIN_HEIGHT), window.innerHeight * 0.9),
  }
}

function clampToViewport(rect: Rect): Rect {
  // Keep the title bar reachable so the pane can always be dragged back
  const maxX = Math.max(0, window.innerWidth - 80)
  const maxY = Math.max(0, window.innerHeight - TITLE_BAR_HEIGHT)
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, -rect.width + 80), maxX),
    y: Math.min(Math.max(rect.y, 0), maxY),
  }
}

function loadRect(storageKey: string, fallback: Rect): Rect {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '')
    if (
      typeof parsed?.x === 'number' &&
      typeof parsed?.y === 'number' &&
      typeof parsed?.width === 'number' &&
      typeof parsed?.height === 'number'
    ) {
      return clampToViewport(clampSize(parsed))
    }
  } catch {}
  return fallback
}

// Hosts content that must never unmount or reparent — moving a WebGL canvas in the DOM
// loses its context (MapLibre recovers, deck.gl's layer resources don't). The pane is a
// single fixed-position element that is either pinned over dockTo's bounding box or
// floats as a draggable window (drag by title bar, resize by the corner handle). The
// floating rect persists to localStorage under storageKey.
export function DockablePane({
  title,
  storageKey,
  floating,
  dockTo,
  onPopOut,
  onDock,
  children,
}: PropsWithChildren<{
  title: string
  storageKey: string
  floating: boolean
  dockTo: HTMLElement | null
  onPopOut: () => void
  onDock: () => void
}>) {
  const [floatRect, setFloatRect] = useState(() => loadRect(storageKey, DEFAULT_RECT))
  const [dockRect, setDockRect] = useState<Rect | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const floatRectRef = useRef(floatRect)
  floatRectRef.current = floatRect

  const persist = useCallback(
    (next: Rect) => localStorage.setItem(storageKey, JSON.stringify(next)),
    [storageKey]
  )

  // Mirror the dock anchor's viewport rect while docked. Panel drags, window resizes,
  // and sidebar/timeline toggles all change the anchor's size, so ResizeObserver fires.
  useEffect(() => {
    if (floating || !dockTo) {
      setDockRect(null)
      return
    }
    const update = () => {
      const r = dockTo.getBoundingClientRect()
      setDockRect({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(dockTo)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [floating, dockTo])

  // Shared pointer-drag plumbing for the title bar (move) and corner handle (resize).
  // Tracks the latest rect locally so the pointerup persist never sees a stale value.
  const startPointerDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, computeRect: (dx: number, dy: number) => Rect) => {
      e.preventDefault()
      const target = e.currentTarget
      try {
        target.setPointerCapture(e.pointerId)
      } catch {}
      const startX = e.clientX
      const startY = e.clientY
      let latest = floatRectRef.current

      function onPointerMove(ev: PointerEvent) {
        latest = computeRect(ev.clientX - startX, ev.clientY - startY)
        setFloatRect(latest)
      }

      function onPointerUp(ev: PointerEvent) {
        target.removeEventListener('pointermove', onPointerMove)
        target.removeEventListener('pointerup', onPointerUp)
        persist(latest)
        try {
          target.releasePointerCapture(ev.pointerId)
        } catch {}
      }

      target.addEventListener('pointermove', onPointerMove)
      target.addEventListener('pointerup', onPointerUp)
    },
    [persist]
  )

  const onTitlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Ignore drags starting on the title bar buttons
      if ((e.target as HTMLElement).closest('button')) return
      const start = floatRectRef.current
      startPointerDrag(e, (dx, dy) =>
        clampToViewport({ ...start, x: start.x + dx, y: start.y + dy })
      )
    },
    [startPointerDrag]
  )

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const start = floatRectRef.current
      startPointerDrag(e, (dx, dy) =>
        clampSize({ ...start, width: start.width + dx, height: start.height + dy })
      )
    },
    [startPointerDrag]
  )

  const rect = floating ? floatRect : dockRect

  return (
    <div
      ref={containerRef}
      className={floating ? s.floating : s.docked}
      style={
        rect
          ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
          : { visibility: 'hidden' }
      }
    >
      {floating && (
        <div className={s.titleBar} onPointerDown={onTitlePointerDown}>
          <span className={s.title}>{title}</span>
          <button
            type="button"
            className={s.titleBarButton}
            onClick={onDock}
            title={`Dock ${title.toLowerCase()} back into the layout`}
          >
            <i className="pi pi-window-minimize" />
          </button>
        </div>
      )}
      <div className={s.content}>
        {children}
        {!floating && (
          <button
            type="button"
            className={s.popOutButton}
            onClick={onPopOut}
            title={`Pop out ${title.toLowerCase()} into a floating window`}
          >
            <i className="pi pi-external-link" />
          </button>
        )}
      </div>
      {floating && (
        <div
          className={s.resizeHandle}
          onPointerDown={onResizePointerDown}
          title="Drag to resize"
        />
      )}
    </div>
  )
}
