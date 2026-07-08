import type { PropsWithChildren, ReactNode } from 'react'
import { useEffect } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import s from './layout.module.css'
import { useUIStore } from './noodles/store'

export function Layout({
  top,
  bottom,
  left,
  right,
  flowGraph,
  spreadsheet,
  children,
}: PropsWithChildren<{
  top?: ReactNode
  bottom?: ReactNode
  left?: ReactNode
  right?: ReactNode
  flowGraph?: ReactNode
  spreadsheet?: ReactNode
}>) {
  const panelSizes = useUIStore(state => state.panelSizes)
  const panelCollapsed = useUIStore(state => state.panelCollapsed)
  const setPanelSize = useUIStore(state => state.setPanelSize)
  const setPanelCollapsed = useUIStore(state => state.setPanelCollapsed)
  const loadPanelState = useUIStore(state => state.loadPanelState)
  const savePanelState = useUIStore(state => state.savePanelState)

  // Load panel state on mount
  useEffect(() => {
    loadPanelState()
  }, [loadPanelState])

  return (
    <div className={s.layout}>
      <div className={s.topBar}>{top}</div>

      <div className={s.mainContent}>
        <PanelGroup direction="horizontal" onLayoutChanged={savePanelState}>
          {/* Left Sidebar */}
          <Panel
            id="sidebar"
            defaultSize={panelSizes.sidebar}
            minSize={10}
            maxSize={30}
            collapsible={true}
            collapsedSize={0}
            onResize={size => {
              setPanelSize('sidebar', size)
              setPanelCollapsed('sidebar', size === 0)
            }}
            className={s.sidebarPanel}
          >
            {left}
          </Panel>

          <PanelResizeHandle className={s.verticalHandle} />

          {/* Main Content Area (Map + Noodles) */}
          <Panel id="main" minSize={30}>
            <PanelGroup direction="vertical" onLayoutChanged={savePanelState}>
              {/* Map Output */}
              <Panel
                id="map"
                defaultSize={panelSizes.mainSplit}
                minSize={20}
                onResize={size => setPanelSize('mainSplit', size)}
                className={s.outputArea}
              >
                {children}
              </Panel>

              <PanelResizeHandle className={s.horizontalHandle} />

              {/* Node Editor */}
              <Panel id="noodles" minSize={20} className={s.noodlesArea}>
                <div className={s.nodeGraphArea}>{flowGraph}</div>
                {spreadsheet}
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className={s.verticalHandle} />

          {/* Right Properties Panel */}
          <Panel
            id="properties"
            defaultSize={panelSizes.properties}
            minSize={12}
            maxSize={30}
            collapsible={true}
            collapsedSize={0}
            onResize={size => {
              setPanelSize('properties', size)
              setPanelCollapsed('properties', size === 0)
            }}
            className={s.rightPanel}
          >
            {right}
          </Panel>
        </PanelGroup>
      </div>

      {/* Timeline at bottom - has its own resize implementation in CollapsibleTimelinePanel */}
      {bottom}
    </div>
  )
}
