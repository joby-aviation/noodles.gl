import type { PropsWithChildren, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { DockablePane } from './components/dockable-pane'
import s from './layout.module.css'
import { useUIStore } from './noodles/store'

// Percentage-based splits (sidebar/main/properties, map/noodles) are persisted by
// useDefaultLayout under 'react-resizable-panels:<group id>' keys. The timeline and
// spreadsheet panels are pixel-sized instead so they keep their size when the window
// or the surrounding panels change; their sizes are persisted under these keys.
const TIMELINE_HEIGHT_KEY = 'noodles-timeline-height'
const SPREADSHEET_WIDTH_KEY = 'noodles-spreadsheet-width'

const TIMELINE_DEFAULT_HEIGHT = 250
const SPREADSHEET_DEFAULT_WIDTH = 400

function loadPx(key: string, fallback: number): number {
  const stored = Number.parseInt(localStorage.getItem(key) ?? '', 10)
  return Number.isNaN(stored) || stored <= 0 ? fallback : stored
}

function savePx(key: string, px: number | undefined) {
  if (px && px > 0) localStorage.setItem(key, String(Math.round(px)))
}

// Panel state was briefly persisted under these keys by an earlier revision
localStorage.removeItem('noodles-panel-sizes')
localStorage.removeItem('noodles-panel-collapsed')

export function Layout({
  top,
  left,
  right,
  flowGraph,
  spreadsheet,
  timeline,
  children,
}: PropsWithChildren<{
  top?: ReactNode
  left?: ReactNode
  right?: ReactNode
  flowGraph?: ReactNode
  spreadsheet?: ReactNode
  timeline?: (heightPx: number) => ReactNode
}>) {
  const timelineExpanded = useUIStore(state => state.timelineExpanded)
  const setTimelineExpanded = useUIStore(state => state.setTimelineExpanded)
  const spreadsheetVisible = useUIStore(state => state.spreadsheetVisible)
  const mapFloating = useUIStore(state => state.mapFloating)
  const setMapFloating = useUIStore(state => state.setMapFloating)
  const sidebarSearchFocusTrigger = useUIStore(state => state.sidebarSearchFocusTrigger)

  const sidebarRef = usePanelRef()
  const timelineRef = usePanelRef()
  const spreadsheetRef = usePanelRef()

  // TimelinePanel needs its height as a number to size its canvases
  const [timelineHeightPx, setTimelineHeightPx] = useState(() =>
    loadPx(TIMELINE_HEIGHT_KEY, TIMELINE_DEFAULT_HEIGHT)
  )

  // The map lives in a DockablePane pinned over this anchor when docked (its WebGL
  // canvas must never move in the DOM — see DockablePane). The anchor is an empty div
  // filling the map Panel that only provides the rect to pin to.
  const [mapDockAnchor, setMapDockAnchor] = useState<HTMLDivElement | null>(null)

  // Edit > Find focuses the sidebar search box; make sure the sidebar is visible first
  useEffect(() => {
    if (sidebarSearchFocusTrigger > 0) sidebarRef.current?.expand()
  }, [sidebarSearchFocusTrigger, sidebarRef])

  const columnsLayout = useDefaultLayout({
    id: 'noodles:columns',
    panelIds: ['sidebar', 'main', 'properties'],
  })
  const mainSplitLayout = useDefaultLayout({
    id: 'noodles:main-split',
    panelIds: mapFloating ? ['noodles'] : ['map', 'noodles'],
  })

  return (
    <div className={s.layout}>
      <div className={s.topBar}>{top}</div>

      <Group
        orientation="vertical"
        className={s.rootGroup}
        onLayoutChanged={() => savePx(TIMELINE_HEIGHT_KEY, timelineRef.current?.getSize().inPixels)}
      >
        <Panel id="workspace" minSize="20%">
          <Group
            orientation="horizontal"
            defaultLayout={columnsLayout.defaultLayout}
            onLayoutChanged={columnsLayout.onLayoutChanged}
          >
            <Panel
              id="sidebar"
              panelRef={sidebarRef}
              defaultSize="12%"
              minSize="10%"
              maxSize="30%"
              collapsible
              collapsedSize={0}
              className={s.sidebarPanel}
            >
              {left}
            </Panel>

            <Separator className={s.verticalHandle} />

            <Panel id="main" minSize="30%">
              <Group
                orientation="vertical"
                defaultLayout={mainSplitLayout.defaultLayout}
                onLayoutChanged={mainSplitLayout.onLayoutChanged}
              >
                {!mapFloating && (
                  <>
                    <Panel id="map" defaultSize="50%" minSize="20%" className={s.outputArea}>
                      <div className={s.mapHost} ref={setMapDockAnchor} />
                    </Panel>
                    <Separator className={s.horizontalHandle} />
                  </>
                )}

                <Panel id="noodles" minSize="20%">
                  <Group
                    orientation="horizontal"
                    onLayoutChanged={() =>
                      savePx(SPREADSHEET_WIDTH_KEY, spreadsheetRef.current?.getSize().inPixels)
                    }
                  >
                    <Panel id="nodeGraph" minSize="20%" className={s.nodeGraphArea}>
                      {flowGraph}
                    </Panel>
                    {spreadsheetVisible && (
                      <>
                        <Separator className={s.verticalHandle} />
                        <Panel
                          id="spreadsheet"
                          panelRef={spreadsheetRef}
                          defaultSize={`${loadPx(SPREADSHEET_WIDTH_KEY, SPREADSHEET_DEFAULT_WIDTH)}px`}
                          minSize="300px"
                          maxSize="800px"
                          groupResizeBehavior="preserve-pixel-size"
                        >
                          {spreadsheet}
                        </Panel>
                      </>
                    )}
                  </Group>
                </Panel>
              </Group>
            </Panel>

            <Separator className={s.verticalHandle} />

            <Panel
              id="properties"
              defaultSize="15%"
              minSize="12%"
              maxSize="30%"
              collapsible
              collapsedSize={0}
              className={s.rightPanel}
            >
              {right}
            </Panel>
          </Group>
        </Panel>

        {timelineExpanded && timeline && (
          <>
            <Separator className={s.horizontalHandle} />
            <Panel
              id="timeline"
              panelRef={timelineRef}
              defaultSize={`${loadPx(TIMELINE_HEIGHT_KEY, TIMELINE_DEFAULT_HEIGHT)}px`}
              minSize="150px"
              maxSize="800px"
              groupResizeBehavior="preserve-pixel-size"
              onResize={size => setTimelineHeightPx(size.inPixels)}
              className={s.timelinePanel}
            >
              {timeline(timelineHeightPx)}
            </Panel>
          </>
        )}
      </Group>

      {!timelineExpanded && timeline && (
        <button
          type="button"
          className={s.timelineCollapseTab}
          onClick={() => setTimelineExpanded(true)}
          title="Expand Timeline (click to open)"
        >
          <ChevronUpIcon />
          <span>Timeline</span>
        </button>
      )}

      <DockablePane
        title="Map"
        storageKey="noodles-floating-map"
        floating={mapFloating}
        dockTo={mapDockAnchor}
        onPopOut={() => setMapFloating(true)}
        onDock={() => setMapFloating(false)}
      >
        {children}
      </DockablePane>
    </div>
  )
}

function ChevronUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 8L6 5L9 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
