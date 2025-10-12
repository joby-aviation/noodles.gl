import cx from 'classnames'
import { type PropsWithChildren, useEffect, useRef, useState } from 'react'
import s from './widget-container.module.css'

const TheatreSheetTree = ({ width }: { width: number }) => (
  <div style={{ width: `${width + 16}px` }} />
)
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
    bottom?: React.ReactNode // primary horizontal panel for widgets
    top?: React.ReactNode
    left?: React.ReactNode
  }
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
}>) {
  const [sheetTreeWidth, setSheetTreeWidth] = useState(150)
  const [propPanelHeight, setPropPanelHeight] = useState(150)
  const [propPanelWidth, setPropPanelWidth] = useState(280)

  const layoutClass = LAYOUT_CLASSES[layoutMode]

  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const theatreRoot = document.getElementById('theatrejs-studio-root') as HTMLDivElement
    if (!theatreRoot) return
    // hacky, but worst case it just falls back to defaults
    const theatreUi = theatreRoot?.shadowRoot?.querySelectorAll<HTMLDivElement>(
      '#pointer-root > div > div'
    )
    const sheetTree = theatreUi?.[2]
    const propPanel = theatreUi?.[3]

    const updateStyles = () => {
      // prevent thetare from overlaying the map area
      if (sheetTree) {
        setSheetTreeWidth(sheetTree.offsetWidth)
      }
      if (propPanel) {
        const { offsetHeight, offsetWidth } = propPanel
        setPropPanelHeight(offsetHeight)
        setPropPanelWidth(offsetWidth)
      }
      // push theatre out of the way of bottom widgets
      if (bottomRef.current) {
        theatreRoot.style.bottom = `${bottomRef.current.offsetHeight}px`
      }
    }

    const observer = new ResizeObserver(() => {
      updateStyles()
    })

    if (sheetTree) observer.observe(sheetTree)
    if (propPanel) observer.observe(propPanel)
    if (bottomRef.current) observer.observe(bottomRef.current)

    // Initial update
    updateStyles()

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <div className={cx(s.widgetContainer, layoutClass)}>
      <div style={{ gridArea: 'top-widget' }}>{widgets?.top}</div>
      <div style={{ gridArea: 'left-widget' }}>
        <TheatreSheetTree width={sheetTreeWidth} />
        {widgets?.left}
      </div>
      <div style={{ gridArea: 'right-widget', display: 'flex', flexDirection: 'column' }}>
        <TheatrePropPanel width={propPanelWidth} height={propPanelHeight} />
        <div style={{ flex: 1 }}>{widgets?.right}</div>
      </div>
      <div ref={bottomRef} style={{ gridArea: 'bottom-widget' }}>
        {widgets?.bottom}
      </div>
      <div className={cx(s.fillWidget, layoutClass)}>
        <div className={s.outputArea}>{children}</div>
        <div className={s.noodlesArea}>{widgets?.flowGraph}</div>
      </div>
    </div>
  )
}
