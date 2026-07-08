import cx from 'classnames'
import type { PropsWithChildren, ReactNode } from 'react'
import s from './layout.module.css'
import { useUIStore } from './noodles/store'

const LAYOUT_CLASSES = {
  split: s.layoutSplit,
  'noodles-on-top': s.layoutNoodlesOnTop,
  'output-on-top': s.layoutOutputOnTop,
} as const

export function Layout({
  top,
  bottom,
  left,
  right,
  flowGraph,
  children,
  layoutMode = 'split',
}: PropsWithChildren<{
  top?: ReactNode
  bottom?: ReactNode
  left?: ReactNode
  right?: ReactNode
  flowGraph?: ReactNode
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
}>) {
  const sidebarVisible = useUIStore(state => state.sidebarVisible)

  const layoutClass = LAYOUT_CLASSES[layoutMode]

  const setSidebarVisible = useUIStore(state => state.setSidebarVisible)

  return (
    <div className={cx(s.layout, layoutClass)}>
      <div style={{ gridArea: 'top-bar' }}>{top}</div>
      {sidebarVisible && (
        <div className={s.sidebarContainer} style={{ gridArea: 'left-widget', minHeight: 0 }}>
          {left}
        </div>
      )}
      <button
        type="button"
        onClick={() => setSidebarVisible(!sidebarVisible)}
        className={cx(s.sidebarToggle, { [s.sidebarToggleCollapsed]: !sidebarVisible })}
        title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
      >
        <i className={sidebarVisible ? 'pi pi-chevron-left' : 'pi pi-chevron-right'} />
      </button>
      <div className={s.rightWidgetWrapper}>
        <div style={{ flex: 1, minHeight: 0 }}>{right}</div>
      </div>
      <div style={{ gridArea: 'bottom-widget' }}>{bottom}</div>
      <div className={cx(s.fillWidget, layoutClass)}>
        <div className={s.outputArea}>{children}</div>
        <div className={s.noodlesArea}>{flowGraph}</div>
      </div>
    </div>
  )
}
