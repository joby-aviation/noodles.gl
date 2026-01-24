import cx from 'classnames'
import { type PropsWithChildren, useEffect, useState } from 'react'
import s from './layout.module.css'
import { useUIStore } from './noodles/store'

const TheatrePropPanel = ({ width, height }: { width: number; height: number }) => (
  <div style={{ width: `${width + 16}px`, height: `${height + 8}px` }} />
)

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
  top?: React.ReactNode
  bottom?: React.ReactNode
  left?: React.ReactNode
  right?: React.ReactNode
  flowGraph?: React.ReactNode
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
}>) {
  const [propPanelHeight, setPropPanelHeight] = useState(150)
  const [propPanelWidth, setPropPanelWidth] = useState(280)
  const sidebarVisible = useUIStore(state => state.sidebarVisible)

  const layoutClass = LAYOUT_CLASSES[layoutMode]

  useEffect(() => {
    const theatreRoot = document.getElementById('theatrejs-studio-root') as HTMLDivElement
    if (!theatreRoot) return
    // hacky, but worst case it just falls back to defaults
    const theatreUi = theatreRoot?.shadowRoot?.querySelectorAll<HTMLDivElement>(
      '#pointer-root > div > div'
    )
    const toolbar = theatreUi?.[1]
    const propPanel = theatreUi?.[3]

    // hide the right toolbar completely, we don't need it
    const rightToolbar = toolbar?.children[1] as HTMLDivElement
    rightToolbar?.style.setProperty('display', 'none', 'important')

    const updateStyles = () => {
      if (propPanel) {
        const { offsetHeight, offsetWidth } = propPanel
        setPropPanelHeight(offsetHeight)
        setPropPanelWidth(offsetWidth)
      }
    }

    const observer = new ResizeObserver(() => {
      updateStyles()
    })

    if (propPanel) observer.observe(propPanel)

    // Initial update
    updateStyles()

    return () => {
      observer.disconnect()
    }
  }, [])

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
        <TheatrePropPanel width={propPanelWidth} height={propPanelHeight} />
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
