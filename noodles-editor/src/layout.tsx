import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import cx from 'classnames'
import type { PropsWithChildren, ReactNode } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { DockablePane } from './components/dockable-pane'
import { type MapMode, useUIStore } from './editor/ui-store'
import {
  type AreaNode,
  closeArea,
  EDITORS,
  type EditorType,
  hasEditor,
  type LayoutNode,
  type SplitNode,
  setEditor,
  setSizes,
  splitArea,
} from './editor/workspace'
import { activeLayout, setEditorShown, useWorkspaceStore } from './editor/workspace-store'
import s from './layout.module.css'
import {
  trackAreaEdited,
  trackMapModeChanged,
  trackPanelToggled,
} from './noodles/utils/editor-analytics'

// A collapsed timeline keeps a strip this tall to click open again
const TIMELINE_COLLAPSED_PX = 24
// A timeline that started collapsed has no size to go back to; it opens this tall: the
// toolbar, ruler and two track rows
const TIMELINE_OPEN_PX = 130

interface Editors {
  layers?: ReactNode
  properties?: ReactNode
  spreadsheet?: ReactNode
  timeline?: (heightPx: number) => ReactNode
}

interface Anchors {
  setMap: (el: HTMLDivElement | null) => void
  setGraph: (el: HTMLDivElement | null) => void
}

// The editor's window: a top bar over the active workspace's areas (see editor/workspace.ts).
// The map and the node graph are never rendered inside an area. Each lives in a DockablePane
// pinned over its area's rect, because the map's WebGL canvas must never move in the DOM, and
// both stay mounted when no area shows them: the map pops out as a floating window, the graph
// waits off screen, so its dialogs and file drops keep working.
export function Layout({
  top,
  layers,
  properties,
  flowGraph,
  spreadsheet,
  timeline,
  children,
}: PropsWithChildren<Editors & { top?: ReactNode; flowGraph?: ReactNode }>) {
  const tree = useWorkspaceStore(activeLayout)
  const mapMode = useUIStore(state => state.mapMode)
  const setMapMode = useUIStore(state => state.setMapMode)
  const sidebarSearchFocusTrigger = useUIStore(state => state.sidebarSearchFocusTrigger)

  const [mapAnchor, setMapAnchor] = useState<HTMLDivElement | null>(null)
  const [graphAnchor, setGraphAnchor] = useState<HTMLDivElement | null>(null)

  const mapShown = hasEditor(tree, 'map')
  const graphShown = hasEditor(tree, 'graph')
  const paneMode: MapMode =
    mapMode === 'floating' || !mapShown
      ? 'floating'
      : mapMode === 'underlay' && graphShown
        ? 'underlay'
        : 'docked'

  const changeMapMode = (mode: MapMode) => {
    if (mode !== mapMode) trackMapModeChanged(mode)
    if (mode === 'docked') setEditorShown('map', true)
    if (mode === 'underlay') setEditorShown('graph', true)
    setMapMode(mode)
  }

  // Edit > Find focuses the layers editor's search box; make sure it is open first
  useEffect(() => {
    if (sidebarSearchFocusTrigger > 0) setEditorShown('layers', true)
  }, [sidebarSearchFocusTrigger])

  const editors: Editors = { layers, properties, spreadsheet, timeline }
  const anchors: Anchors = { setMap: setMapAnchor, setGraph: setGraphAnchor }

  return (
    <div className={s.layout}>
      <div className={s.topBar}>{top}</div>

      <div className={s.workspace}>
        {tree.type === 'area' ? (
          <AreaView area={tree} editors={editors} anchors={anchors} canClose={false} />
        ) : (
          <SplitView node={tree} editors={editors} anchors={anchors} />
        )}
      </div>

      <DockablePane
        title="Node Graph"
        storageKey="noodles-floating-graph"
        mode="docked"
        dockTo={graphShown ? graphAnchor : null}
        onDock={() => setEditorShown('graph', true)}
        dockedActions={
          paneMode === 'underlay' && (
            <button
              type="button"
              className={s.paneActionButton}
              onClick={() => changeMapMode('docked')}
              title="Dock map back into its own area"
            >
              <i className="pi pi-window-maximize" />
            </button>
          )
        }
      >
        {flowGraph}
      </DockablePane>

      <DockablePane
        title="Map"
        storageKey="noodles-floating-map"
        mode={paneMode}
        dockTo={paneMode === 'underlay' ? graphAnchor : mapAnchor}
        onDock={() => changeMapMode('docked')}
        dockedActions={
          <>
            <button
              type="button"
              className={s.paneActionButton}
              onClick={() => changeMapMode('underlay')}
              title="Show map behind the node graph"
            >
              <i className="pi pi-clone" />
            </button>
            <button
              type="button"
              className={s.paneActionButton}
              onClick={() => changeMapMode('floating')}
              title="Pop out map into a floating window"
            >
              <i className="pi pi-external-link" />
            </button>
          </>
        }
      >
        {children}
      </DockablePane>
    </div>
  )
}

function SplitView({
  node,
  editors,
  anchors,
}: {
  node: SplitNode
  editors: Editors
  anchors: Anchors
}) {
  const update = useWorkspaceStore(state => state.update)
  return (
    <Group
      // A new set of children starts from the sizes the tree holds for them
      key={node.children.map(c => c.id).join(',')}
      orientation={node.orientation}
      className={s.group}
      onLayoutChanged={layout => {
        const same = node.children.every(
          c => Math.abs((layout[c.id] ?? 0) - (node.sizes?.[c.id] ?? -1)) < 0.01
        )
        if (!same) update(tree => setSizes(tree, node.id, layout))
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <Separator
              className={node.orientation === 'horizontal' ? s.verticalHandle : s.horizontalHandle}
            />
          )}
          <ChildPanel parent={node} child={child} editors={editors} anchors={anchors} />
        </Fragment>
      ))}
    </Group>
  )
}

// Panels that hold a tool rather than the picture keep their pixel size when the window
// resizes, so the map takes up the difference
const FIXED_EDITORS = new Set<EditorType>(['layers', 'properties', 'timeline', 'spreadsheet'])

function ChildPanel({
  parent,
  child,
  editors,
  anchors,
}: {
  parent: SplitNode
  child: LayoutNode
  editors: Editors
  anchors: Anchors
}) {
  const panelRef = usePanelRef()
  const timelineExpanded = useUIStore(state => state.timelineExpanded)
  const setTimelineExpanded = useUIStore(state => state.setTimelineExpanded)
  // Only a timeline stacked under or over something collapses, to a strip across the window
  const collapsible =
    child.type === 'area' && child.editor === 'timeline' && parent.orientation === 'vertical'
  const lastCollapsed = useRef<boolean | undefined>(undefined)

  useEffect(() => {
    const panel = panelRef.current
    if (!collapsible || !panel) return
    if (timelineExpanded && panel.isCollapsed()) {
      panel.expand()
      if (panel.getSize().inPixels < TIMELINE_OPEN_PX) panel.resize(`${TIMELINE_OPEN_PX}px`)
    } else if (!timelineExpanded && !panel.isCollapsed()) panel.collapse()
  }, [collapsible, timelineExpanded, panelRef])

  const size = parent.sizes?.[child.id]
  return (
    <Panel
      id={child.id}
      panelRef={panelRef}
      defaultSize={size !== undefined ? `${size}%` : undefined}
      minSize={collapsible ? '100px' : '80px'}
      collapsible={collapsible}
      collapsedSize={collapsible ? `${TIMELINE_COLLAPSED_PX}px` : undefined}
      groupResizeBehavior={
        child.type === 'area' && FIXED_EDITORS.has(child.editor) ? 'preserve-pixel-size' : undefined
      }
      onResize={({ inPixels }) => {
        if (!collapsible) return
        // Follow a drag across the collapse point; the first report is the starting size
        const collapsed = inPixels <= TIMELINE_COLLAPSED_PX + 1
        const before = lastCollapsed.current
        lastCollapsed.current = collapsed
        if (before !== undefined && before !== collapsed) setTimelineExpanded(!collapsed)
      }}
      className={s.panel}
    >
      {child.type === 'area' ? (
        <AreaView
          area={child}
          editors={editors}
          anchors={anchors}
          canClose
          collapsed={collapsible && !timelineExpanded}
        />
      ) : (
        <SplitView node={child} editors={editors} anchors={anchors} />
      )}
    </Panel>
  )
}

function AreaView({
  area,
  editors,
  anchors,
  canClose,
  collapsed,
}: {
  area: AreaNode
  editors: Editors
  anchors: Anchors
  canClose: boolean
  collapsed?: boolean
}) {
  const setTimelineExpanded = useUIStore(state => state.setTimelineExpanded)

  if (collapsed) {
    return (
      <button
        type="button"
        className={s.timelineCollapseTab}
        onClick={() => {
          trackPanelToggled('timeline', true)
          setTimelineExpanded(true)
        }}
        title="Expand Timeline (click to open)"
      >
        <ChevronUpIcon />
        <span>Timeline</span>
      </button>
    )
  }

  const anchorRef =
    area.editor === 'map' ? anchors.setMap : area.editor === 'graph' ? anchors.setGraph : undefined

  return (
    <div className={s.area} data-editor={area.editor}>
      <AreaHeader area={area} canClose={canClose} />
      <div className={s.areaContent} ref={anchorRef}>
        <AreaContent area={area} editors={editors} />
      </div>
    </div>
  )
}

function AreaContent({ area, editors }: { area: AreaNode; editors: Editors }) {
  switch (area.editor) {
    // Drawn by the pinned panes in Layout
    case 'map':
    case 'graph':
      return null
    case 'layers':
      return editors.layers
    case 'properties':
      return editors.properties
    case 'spreadsheet':
      return editors.spreadsheet
    case 'timeline':
      return editors.timeline ? (
        <Measured>{height => editors.timeline?.(height) ?? null}</Measured>
      ) : null
    case 'empty':
      return <EmptyArea area={area} />
  }
}

// The timeline sizes its canvases from a number, so measure the area for it
function Measured({ children }: { children: (heightPx: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.clientHeight))
    observer.observe(el)
    setHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} className={s.measured}>
      {height > 0 && children(height)}
    </div>
  )
}

// Show an editor in an area. A timeline opened this way opens expanded, not as a strip.
function chooseEditor(areaId: string, editor: EditorType) {
  trackAreaEdited('editor', editor)
  if (editor === 'timeline') useUIStore.getState().setTimelineExpanded(true)
  useWorkspaceStore.getState().update(t => setEditor(t, areaId, editor))
}

function AreaHeader({ area, canClose }: { area: AreaNode; canClose: boolean }) {
  const update = useWorkspaceStore(state => state.update)
  const tree = useWorkspaceStore(activeLayout)
  const current = EDITORS.find(e => e.type === area.editor)

  const split = (orientation: SplitNode['orientation']) => {
    trackAreaEdited('split', area.editor)
    update(t => splitArea(t, area.id, orientation))
  }

  return (
    <div className={s.areaHeader}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={s.editorPicker} title="Change editor">
            <i className={cx('pi', current?.icon ?? 'pi-plus')} />
            <span>{current?.label ?? 'Choose an editor'}</span>
            <i className={cx('pi pi-chevron-down', s.editorPickerChevron)} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={s.menu} align="start" sideOffset={2}>
            {EDITORS.map(e => (
              <DropdownMenu.Item
                key={e.type}
                className={cx(s.menuItem, e.type === area.editor && s.menuItemCurrent)}
                onSelect={() => chooseEditor(area.id, e.type)}
              >
                <i className={cx('pi', e.icon)} />
                <span>{e.label}</span>
                {e.type !== area.editor && hasEditor(tree, e.type) && (
                  <span className={s.menuHint} title="Open in another area; the two swap">
                    swap
                  </span>
                )}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div className={s.areaActions}>
        <button
          type="button"
          className={s.areaAction}
          onClick={() => split('horizontal')}
          title="Split side by side"
        >
          <SplitIcon vertical />
        </button>
        <button
          type="button"
          className={s.areaAction}
          onClick={() => split('vertical')}
          title="Split top and bottom"
        >
          <SplitIcon />
        </button>
        {canClose && (
          <button
            type="button"
            className={s.areaAction}
            onClick={() => {
              trackAreaEdited('close', area.editor)
              update(t => closeArea(t, area.id))
            }}
            title="Close area"
          >
            <i className="pi pi-times" />
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyArea({ area }: { area: AreaNode }) {
  const tree = useWorkspaceStore(activeLayout)
  const closed = EDITORS.filter(e => !hasEditor(tree, e.type))
  return (
    <div className={s.emptyArea}>
      {closed.length > 0 ? (
        closed.map(e => (
          <button
            key={e.type}
            type="button"
            className={s.emptyAreaChoice}
            onClick={() => chooseEditor(area.id, e.type)}
          >
            <i className={cx('pi', e.icon)} />
            {e.label}
          </button>
        ))
      ) : (
        <span>Every editor is open. Pick one above to move it here.</span>
      )}
    </div>
  )
}

function SplitIcon({ vertical }: { vertical?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="1.5" width="10" height="9" rx="1.5" stroke="currentColor" />
      {vertical ? (
        <path d="M6 1.5V10.5" stroke="currentColor" />
      ) : (
        <path d="M1 6H11" stroke="currentColor" />
      )}
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 8L6 5L9 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
