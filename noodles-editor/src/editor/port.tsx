// A property row's port, as Cavalry's attribute ports: the input on the left reads something,
// the output on the right is read. Drag one to connect it (link-drag.tsx); a connected port is
// filled, and hovering one lists what it is connected to.

import cx from 'classnames'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import s from './doc-editor.module.css'
import { docStore } from './doc-store'
import { startPortDrag } from './link-drag'
import type { Connection, LinkDrag } from './param-links'
import { useUIStore } from './ui-store'

// How long the pointer rests on a port before its list opens, so a quick drag starts without it
// covering the rows below
const SHOW_MS = 400
// How long the list stays after the pointer leaves the port, so it can move onto the list
const LEAVE_MS = 150
const TIP_WIDTH = 240
// A longer list scrolls
const TIP_MAX_HEIGHT = 220

export function Port({
  side,
  drag,
  connections,
  hint,
}: {
  side: 'in' | 'out'
  drag: LinkDrag
  connections: Connection[]
  // What dragging the port does, shown while it connects to nothing
  hint: string
}) {
  const [at, setAt] = useState<DOMRect>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dragging = useUIStore(st => st.linkDrag !== null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = (el: HTMLElement) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setAt(el.getBoundingClientRect()), at ? 0 : SHOW_MS)
  }
  const hide = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setAt(undefined), LEAVE_MS)
  }
  const close = () => {
    clearTimeout(timer.current)
    setAt(undefined)
  }
  const label = side === 'in' ? 'Reads' : 'Read by'

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging from the port is the pointer gesture; the link button and the right-click menu make the same link from the keyboard */}
      <span
        className={cx(s.port, side === 'out' && s.portOut, connections.length > 0 && s.portOn)}
        data-port={side}
        onPointerDown={e => {
          close()
          startPortDrag(e, drag, side)
        }}
        onMouseEnter={e => show(e.currentTarget)}
        onMouseLeave={hide}
      />
      {at &&
        !dragging &&
        createPortal(
          <div
            className={s.portTip}
            role="tooltip"
            style={{
              left: Math.max(
                4,
                Math.min(side === 'in' ? at.left : at.right - TIP_WIDTH, innerWidth - TIP_WIDTH - 4)
              ),
              // Below the port, or above it when the window ends first
              ...(innerHeight - at.bottom < TIP_MAX_HEIGHT + 12
                ? { bottom: innerHeight - at.top + 6 }
                : { top: at.bottom + 6 }),
              width: TIP_WIDTH,
              maxHeight: TIP_MAX_HEIGHT,
            }}
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={hide}
          >
            <div className={s.portTipHead}>{label}</div>
            {connections.length > 0 ? (
              connections.map(c => (
                <button
                  type="button"
                  key={c.key}
                  className={s.portTipItem}
                  title="Go to it"
                  onClick={() => {
                    close()
                    docStore().set({ network: c.node.parent, selection: [c.node.id] })
                  }}
                >
                  {c.label}
                </button>
              ))
            ) : (
              <div className={s.portTipEmpty}>{hint}</div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
