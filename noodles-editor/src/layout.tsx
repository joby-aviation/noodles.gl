import cx from 'classnames'
import { type PropsWithChildren, useEffect, useRef, useState } from 'react'
import s from './layout.module.css'

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

    // hide the right toolbar completely, we don't need it
    const rightToolbar = toolbar?.children[1] as HTMLDivElement
    rightToolbar?.style.setProperty('display', 'none', 'important')

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
    <div className={cx(s.layout, layoutClass)}>
      <div style={{ gridArea: 'top-widget' }}>{top}</div>
      <div style={{ gridArea: 'left-widget' }}>
        <TheatreSheetTree width={sheetTreeWidth} />
        {left}
      </div>
      <div style={{ gridArea: 'right-widget', display: 'flex', flexDirection: 'column' }}>
        <TheatrePropPanel width={propPanelWidth} height={propPanelHeight} />
        <div style={{ flex: 1 }}>{right}</div>
      </div>
      <div ref={bottomRef} style={{ gridArea: 'bottom-widget' }}>
        {bottom}
      </div>
      <div className={cx(s.fillWidget, layoutClass)}>
        <div className={s.outputArea}>{children}</div>
        <div className={s.noodlesArea}>{flowGraph}</div>
      </div>
    </div>
  )
}
