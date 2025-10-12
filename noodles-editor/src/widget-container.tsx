import cx from 'classnames'
import { type PropsWithChildren, useEffect, useRef, useState } from 'react'
import './widget-container.css'

const TheatreSheetTree = ({ width }: { width: number }) => (
  <div style={{ width: `${width + 16}px` }} />
)
const TheatrePropPanel = ({ width, height }: { width: number; height: number }) => (
  <div style={{ width: `${width + 16}px`, height: `${height + 60}px` }} />
)

const LAYOUT_CLASSES = {
  split: 'layout-split',
  'noodles-on-top': 'layout-noodles-on-top',
  'output-on-top': 'layout-output-on-top',
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
    const toolbar = theatreUi?.[1]
    const sheetTree = theatreUi?.[2]
    const propPanel = theatreUi?.[3]

    // hide the toolbar completely, we don't need it
    toolbar?.style.setProperty('display', 'none', 'important')

    const updateStyles = () => {
      // prevent theatre from overlaying the map area
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
    <div className={cx('widget-container', layoutClass)}>
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
      <div className={cx('fill-widget', layoutClass)}>
        <div className="output-area">{children}</div>
        <div className="noodles-area">{widgets?.flowGraph}</div>
      </div>
    </div>
  )
}
