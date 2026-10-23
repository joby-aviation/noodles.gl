import { nameOf } from '@noodles.gl/planner'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDownIcon, ExternalLinkIcon } from '@radix-ui/react-icons'
import { useReactFlow } from '@xyflow/react'
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import logoSvg from '/noodles-favicon.svg'
import { SettingsDialog } from '../../components/settings-dialog'
import { docStore, useEditor } from '../../editor/doc-store'
import type { CopyControlsRef, UndoRedoHandlerRef } from '../../editor/edit-menu'
import { type MapMode, useUIStore } from '../../editor/ui-store'
import type { RenderSource } from '../../render/render-analytics'
import { exportsTransparentVideo } from '../../render/video-export'
import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import { directoryHandleCache } from '../utils/directory-handle-cache'
import {
  trackChatClosed,
  trackChatOpened,
  trackMapModeChanged,
  trackPanelToggled,
} from '../utils/editor-analytics'
import { shouldBlockKeyboardShortcut } from '../utils/input-detection'
import { Breadcrumbs } from './breadcrumbs'
import { ExportButton } from './export-button'
import { DataImporterTool } from './tools/data-importer-tool'
import type { GeoRecipe } from './tools/geo-recipes'
import { GeoToolWizard } from './tools/geo-tool-wizard'
import { PointWizardTool } from './tools/point-wizard-tool'
import { ToolShelf } from './tools/tool-shelf'
import s from './top-menu-bar.module.css'

interface TopMenuBarProps {
  projectName?: string
  // Project whose version control settings the settings dialog edits; null when unsaved
  versionedProjectName?: string | null
  onSaveProject: () => void
  onSaveAs?: () => Promise<void>
  onRename?: () => void
  onDownload?: () => Promise<void>
  onNewProject: () => void
  onImport: () => void
  onOpen?: (projectName?: string) => Promise<void>
  onOpenAddNode?: () => void
  showChatPanel?: boolean
  onChangeShowChatPanel?: (show: boolean) => void
  undoRedoRef: RefObject<UndoRedoHandlerRef | null>
  copyControlsRef: RefObject<CopyControlsRef | null>
  // Export functions always use the active OutOp's settings
  startRender?: (source?: RenderSource) => Promise<void>
  takeScreenshot?: (source?: RenderSource) => Promise<void>
  isRendering?: boolean
  hasUnsavedChanges?: boolean
  showOverlay?: boolean
  onChangeShowOverlay?: (show: boolean) => void
  showDebugInfo?: boolean
  onChangeShowDebugInfo?: (show: boolean) => void
  autoLayoutOnConnect?: boolean
  onChangeAutoLayoutOnConnect?: (enabled: boolean) => void
  spreadsheetVisible?: boolean
  onChangeSpreadsheetVisible?: (show: boolean) => void
  reactFlowRef?: RefObject<HTMLDivElement>
}

export function TopMenuBar({
  projectName,
  versionedProjectName,
  onSaveProject,
  onSaveAs,
  onRename,
  onDownload,
  onNewProject,
  onImport,
  onOpen,
  onOpenAddNode,
  showChatPanel,
  onChangeShowChatPanel,
  undoRedoRef,
  copyControlsRef,
  startRender,
  takeScreenshot,
  isRendering,
  hasUnsavedChanges,
  showOverlay,
  onChangeShowOverlay,
  showDebugInfo,
  onChangeShowDebugInfo,
  autoLayoutOnConnect,
  onChangeAutoLayoutOnConnect,
  spreadsheetVisible,
  onChangeSpreadsheetVisible,
  reactFlowRef,
}: TopMenuBarProps) {
  const settingsDialogOpen = useUIStore(state => state.settingsDialogOpen)
  const setSettingsDialogOpen = useUIStore(state => state.setSettingsDialogOpen)

  const mapMode = useUIStore(state => state.mapMode)
  const setMapMode = useUIStore(state => state.setMapMode)
  const triggerSidebarSearch = useUIStore(state => state.triggerSidebarSearch)
  const [, navigate] = useLocation()
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [showPointWizard, setShowPointWizard] = useState(false)
  const [showDataImporter, setShowDataImporter] = useState(false)
  const [activeRecipe, setActiveRecipe] = useState<GeoRecipe | null>(null)
  const reactFlow = useReactFlow()
  // The deck whose render settings an export uses
  const deckName = useEditor(st => {
    const deck = st.doc.nodes.find(n => n.op === 'deck')
    return deck ? nameOf(deck) : null
  })
  const network = useEditor(st => st.network)
  const selectedSubnet = useEditor(st => {
    const n = st.doc.nodes.find(x => x.id === st.selection[0])
    return n?.op === 'subnet' ? n.id : null
  })

  // Load recent projects on mount, and again when one is removed or its folder changes
  useEffect(() => {
    const loadRecent = () =>
      directoryHandleCache
        .getAllProjectNames()
        .then(names => setRecentProjects(names))
        .catch(err => debugUI('Failed to load recent projects:', err))
    loadRecent()
    return directoryHandleCache.subscribe(loadRecent)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldBlockKeyboardShortcut(e)) return

      const isMod = e.metaKey || e.ctrlKey

      if (isMod && e.key === 's') {
        e.preventDefault()
        onSaveProject()
        analytics.track('keyboard_shortcut_used', { action: 'save' })
      } else if (isMod && e.key === 'n') {
        e.preventDefault()
        onNewProject()
        analytics.track('keyboard_shortcut_used', { action: 'new_project' })
      } else if (isMod && e.key === 'o') {
        e.preventDefault()
        onOpen?.()
        analytics.track('keyboard_shortcut_used', { action: 'open' })
      } else if (isMod && e.key === 'i') {
        e.preventDefault()
        onImport()
        analytics.track('keyboard_shortcut_used', { action: 'import' })
      } else if (isMod && e.key === 'f') {
        e.preventDefault()
        triggerSidebarSearch()
        analytics.track('keyboard_shortcut_used', { action: 'find' })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSaveProject, onNewProject, onOpen, onImport, triggerSidebarSearch])

  // Detect platform for keyboard shortcuts
  const isMac = useMemo(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0, [])
  const mod = isMac ? '⌘' : 'Ctrl'

  // Subnet navigation, as the network editor's U and Enter keys do
  const canGoUp = network !== undefined
  const canGoInto = selectedSubnet !== null

  // Simplified export handlers - always use active OutOp's settings. The renderer
  // tracks render and screenshot analytics, so every button that exports is counted.
  const handleStartRender = useCallback(async () => {
    if (!startRender) return
    await startRender()
  }, [startRender])

  const handleTakeScreenshot = useCallback(async () => {
    if (!takeScreenshot) return
    await takeScreenshot()
  }, [takeScreenshot])

  const goTo = useCallback(
    (next: string | undefined, direction: 'up' | 'into') => {
      docStore().set({ network: next, selection: [] })
      analytics.track('container_navigated', { method: 'menu', direction })
      // Fit the nodes at the new level once they have rendered
      setTimeout(() => reactFlow.fitView({ duration: 0 }), 50)
    },
    [reactFlow]
  )
  const goUp = useCallback(() => {
    const { doc, network: at } = docStore().get()
    goTo(doc.nodes.find(n => n.id === at)?.parent, 'up')
  }, [goTo])
  const goInto = useCallback(() => {
    if (selectedSubnet) goTo(selectedSubnet, 'into')
  }, [goTo, selectedSubnet])

  return (
    <>
      <div className={s.topMenuBar}>
        <div className={s.leftSection}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={s.logoButton} title="Menu">
                <div className={s.logoContainer}>
                  <img src={logoSvg} alt="Noodles.gl" className={s.logo} />
                </div>
                <ChevronDownIcon className={s.chevron} />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content className={s.dropdownContent} align="start" sideOffset={5}>
                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={onOpenAddNode}
                  disabled={!onOpenAddNode}
                >
                  <span>Add Operator</span>
                  <span className={s.shortcut}>A</span>
                </DropdownMenu.Item>

                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={s.dropdownItem}>
                    File
                    <i
                      className="pi pi-chevron-right"
                      style={{ marginLeft: 'auto', fontSize: '10px' }}
                    />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className={s.dropdownContent} sideOffset={2}>
                      <DropdownMenu.Item className={s.dropdownItem} onSelect={onNewProject}>
                        <span>New Project</span>
                        <span className={s.shortcut}>{mod}+N</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => onOpen?.()}
                        disabled={!onOpen}
                      >
                        <span>Open</span>
                        <span className={s.shortcut}>{mod}+O</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={s.dropdownItem} onSelect={onImport}>
                        <span>Import</span>
                        <span className={s.shortcut}>{mod}+I</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className={s.dropdownSeparator} />
                      <DropdownMenu.Item className={s.dropdownItem} onSelect={onSaveProject}>
                        <span>Save</span>
                        <span className={s.shortcut}>{mod}+S</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={onSaveAs}
                        disabled={!onSaveAs}
                      >
                        <span>Save As...</span>
                        <span className={s.shortcut}>{mod}+Shift+S</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={onRename}
                        disabled={!onRename}
                      >
                        Rename Project...
                        <span className={s.shortcut}>{mod}+Shift+A</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={onDownload}
                        disabled={!onDownload}
                      >
                        Download
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className={s.dropdownSeparator} />
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className={s.dropdownItem} disabled={!onOpen}>
                          Open Recent
                          <i
                            className="pi pi-chevron-right"
                            style={{ marginLeft: 'auto', fontSize: '10px' }}
                          />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent className={s.dropdownContent} sideOffset={2}>
                            {recentProjects.length === 0 ? (
                              <DropdownMenu.Item className={s.dropdownItem} disabled>
                                No recent projects
                              </DropdownMenu.Item>
                            ) : (
                              recentProjects.map(name => (
                                <DropdownMenu.Item
                                  key={name}
                                  className={s.dropdownItem}
                                  onSelect={() => onOpen?.(name)}
                                >
                                  {name}
                                </DropdownMenu.Item>
                              ))
                            )}
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => navigate('/projects')}
                      >
                        Manage Projects...
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className={s.dropdownSeparator} />
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => navigate('/examples')}
                      >
                        Examples
                      </DropdownMenu.Item>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>

                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={s.dropdownItem}>
                    Edit
                    <i
                      className="pi pi-chevron-right"
                      style={{ marginLeft: 'auto', fontSize: '10px' }}
                    />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className={s.dropdownContent} sideOffset={2}>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => undoRedoRef.current?.undo()}
                        disabled={!undoRedoRef.current?.canUndo()}
                      >
                        <span>Undo</span>
                        <span className={s.shortcut}>{mod}+Z</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => undoRedoRef.current?.redo()}
                        disabled={!undoRedoRef.current?.canRedo()}
                      >
                        <span>Redo</span>
                        <span className={s.shortcut}>
                          {mod}+{isMac ? 'Shift+Z' : 'Y'}
                        </span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className={s.dropdownSeparator} />
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => copyControlsRef.current?.copy()}
                        disabled={!copyControlsRef.current?.canCopy()}
                      >
                        <span>Copy</span>
                        <span className={s.shortcut}>{mod}+C</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => copyControlsRef.current?.paste()}
                        disabled={!copyControlsRef.current?.canPaste()}
                      >
                        <span>Paste</span>
                        <span className={s.shortcut}>{mod}+V</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className={s.dropdownSeparator} />
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={() => {
                          triggerSidebarSearch()
                          analytics.track('keyboard_shortcut_used', { action: 'find' })
                        }}
                      >
                        <span>Find</span>
                        <span className={s.shortcut}>{mod}+F</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>

                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={s.dropdownItem}>
                    Navigate
                    <i
                      className="pi pi-chevron-right"
                      style={{ marginLeft: 'auto', fontSize: '10px' }}
                    />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className={s.dropdownContent} sideOffset={2}>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={goUp}
                        disabled={!canGoUp}
                      >
                        <span>Go to Parent Network</span>
                        <span className={s.shortcut}>U</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={goInto}
                        disabled={!canGoInto}
                      >
                        <span>Go into Selected Subnet</span>
                        <span className={s.shortcut}>Enter</span>
                      </DropdownMenu.Item>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>

                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={s.dropdownItem}>
                    Editor
                    <i
                      className="pi pi-chevron-right"
                      style={{ marginLeft: 'auto', fontSize: '10px' }}
                    />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className={s.dropdownContent} sideOffset={2}>
                      <DropdownMenu.CheckboxItem
                        className={s.dropdownItem}
                        checked={showOverlay}
                        onCheckedChange={onChangeShowOverlay}
                      >
                        <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                          <i className="pi pi-check" style={{ fontSize: '12px' }} />
                        </DropdownMenu.ItemIndicator>
                        Show node graph
                      </DropdownMenu.CheckboxItem>
                      <DropdownMenu.CheckboxItem
                        className={s.dropdownItem}
                        checked={showDebugInfo}
                        onCheckedChange={onChangeShowDebugInfo}
                      >
                        <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                          <i className="pi pi-check" style={{ fontSize: '12px' }} />
                        </DropdownMenu.ItemIndicator>
                        Show editor debug info
                      </DropdownMenu.CheckboxItem>
                      <DropdownMenu.CheckboxItem
                        className={s.dropdownItem}
                        checked={spreadsheetVisible}
                        onCheckedChange={visible => {
                          trackPanelToggled('spreadsheet', visible)
                          onChangeSpreadsheetVisible?.(visible)
                        }}
                      >
                        <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                          <i className="pi pi-check" style={{ fontSize: '12px' }} />
                        </DropdownMenu.ItemIndicator>
                        Show spreadsheet
                      </DropdownMenu.CheckboxItem>
                      <DropdownMenu.CheckboxItem
                        className={s.dropdownItem}
                        checked={autoLayoutOnConnect}
                        onCheckedChange={onChangeAutoLayoutOnConnect}
                      >
                        <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                          <i className="pi pi-check" style={{ fontSize: '12px' }} />
                        </DropdownMenu.ItemIndicator>
                        Auto-layout when connecting nodes
                      </DropdownMenu.CheckboxItem>
                      <DropdownMenu.Separator className={s.dropdownSeparator} />

                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className={s.dropdownItem}>
                          Map
                          <i
                            className="pi pi-chevron-right"
                            style={{ marginLeft: 'auto', fontSize: '10px' }}
                          />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent className={s.dropdownContent} sideOffset={2}>
                            <DropdownMenu.RadioGroup
                              value={mapMode}
                              onValueChange={value => {
                                if (value !== mapMode) trackMapModeChanged(value as MapMode)
                                setMapMode(value as MapMode)
                              }}
                            >
                              <DropdownMenu.RadioItem className={s.dropdownItem} value="docked">
                                <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                                  <i className="pi pi-check" style={{ fontSize: '12px' }} />
                                </DropdownMenu.ItemIndicator>
                                Docked panel
                              </DropdownMenu.RadioItem>
                              <DropdownMenu.RadioItem className={s.dropdownItem} value="floating">
                                <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                                  <i className="pi pi-check" style={{ fontSize: '12px' }} />
                                </DropdownMenu.ItemIndicator>
                                Floating window
                              </DropdownMenu.RadioItem>
                              <DropdownMenu.RadioItem className={s.dropdownItem} value="underlay">
                                <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                                  <i className="pi pi-check" style={{ fontSize: '12px' }} />
                                </DropdownMenu.ItemIndicator>
                                Behind node graph
                              </DropdownMenu.RadioItem>
                            </DropdownMenu.RadioGroup>
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>

                <DropdownMenu.Separator className={s.dropdownSeparator} />

                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={handleStartRender}
                  disabled={!startRender || isRendering}
                >
                  Start Render
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={handleTakeScreenshot}
                  disabled={!takeScreenshot || isRendering}
                >
                  Take Screenshot
                </DropdownMenu.Item>

                <DropdownMenu.Separator className={s.dropdownSeparator} />

                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={() => setSettingsDialogOpen(true)}
                >
                  Settings
                </DropdownMenu.Item>

                <DropdownMenu.Separator className={s.dropdownSeparator} />

                <DropdownMenu.Item className={s.dropdownItem} asChild>
                  <a
                    href="https://noodles.gl/users/getting-started"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={s.externalLink}
                  >
                    Documentation
                    <ExternalLinkIcon className={s.menuExternalIcon} />
                  </a>
                </DropdownMenu.Item>

                <div className={s.dropdownFooter}>
                  <a
                    href="https://noodles.gl"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={s.footerLink}
                  >
                    noodles.gl
                  </a>
                  <span className={s.footerSeparator}>•</span>
                  <a
                    href="https://github.com/joby-aviation/noodles.gl"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={s.footerLink}
                  >
                    GitHub
                  </a>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <div className={s.breadcrumbContainer}>
            <Breadcrumbs projectName={projectName} hasUnsavedChanges={hasUnsavedChanges} />
          </div>
        </div>

        {reactFlowRef && (
          <ToolShelf
            onOpenAddNode={onOpenAddNode}
            onCreatePoint={() => setShowPointWizard(true)}
            onImportFile={() => setShowDataImporter(true)}
            onRunRecipe={setActiveRecipe}
          />
        )}

        <div className={s.rightSection}>
          <ExportButton
            deckName={deckName}
            isRendering={Boolean(isRendering)}
            takeScreenshot={takeScreenshot}
            startRender={startRender}
          />
          {onChangeShowChatPanel && (
            <button
              type="button"
              onClick={() => {
                if (showChatPanel) trackChatClosed('toolbar')
                else trackChatOpened('toolbar')
                onChangeShowChatPanel(!showChatPanel)
              }}
              className={s.assistantButton}
              title="Toggle Noodles AI Assistant"
            >
              <i className="pi pi-comment" />
              {showChatPanel ? 'Hide' : 'Assistant'}
            </button>
          )}
        </div>
      </div>

      {reactFlowRef && (
        <>
          <PointWizardTool
            open={showPointWizard}
            onOpenChange={setShowPointWizard}
            reactFlowRef={reactFlowRef}
          />

          <DataImporterTool
            open={showDataImporter}
            onOpenChange={setShowDataImporter}
            reactFlowRef={reactFlowRef}
          />

          <GeoToolWizard
            recipe={activeRecipe}
            onOpenChange={open => {
              if (!open) setActiveRecipe(null)
            }}
            reactFlowRef={reactFlowRef}
          />
        </>
      )}

      <SettingsDialog
        open={settingsDialogOpen}
        setOpen={setSettingsDialogOpen}
        projectName={versionedProjectName}
      />
    </>
  )
}
