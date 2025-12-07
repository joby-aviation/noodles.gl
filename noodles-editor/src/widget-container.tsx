import cx from 'classnames'
import { type PropsWithChildren, useEffect, useRef, useState } from 'react'
import s from './widget-container.module.css'

const TheatrePropPanel = ({ width, height }: { width: number; height: number }) => (
  <div style={{ width: `${width + 16}px`, height: `${height + 60}px` }} />
)

const LAYOUT_CLASSES = {
  split: s.layoutSplit,
  'noodles-on-top': s.layoutNoodlesOnTop,
  'output-on-top': s.layoutOutputOnTop,
} as const

export function WidgetContainer({
  widgets,
  children,
  layoutMode = 'split',
}: PropsWithChildren<{
  widgets?: {
    flowGraph?: React.ReactNode
    right?: React.ReactNode // primary vertical panel for widgets
    top?: React.ReactNode
    left?: React.ReactNode
    bottom?: React.ReactNode
  }
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
}>) {
  const [propPanelHeight, setPropPanelHeight] = useState(150)
  const [propPanelWidth, setPropPanelWidth] = useState(280)

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

  return (
    <div className={cx(s.widgetContainer, layoutClass)}>
      <div style={{ gridArea: 'top-bar' }}>{widgets?.top}</div>
      <div style={{ gridArea: 'left-widget' }}>{widgets?.left}</div>
      <div style={{ gridArea: 'right-widget', display: 'flex', flexDirection: 'column' }}>
        <TheatrePropPanel width={propPanelWidth} height={propPanelHeight} />
        <div style={{ flex: 1 }}>{widgets?.right}</div>
      </div>
      <div className={cx(s.fillWidget, layoutClass)}>
        <div className={s.outputArea}>{children}</div>
        <div className={s.noodlesArea}>{widgets?.flowGraph}</div>
      </div>
      <div style={{ gridArea: 'bottom-widget' }}>{widgets?.bottom}</div>
    </div>
  )
}
