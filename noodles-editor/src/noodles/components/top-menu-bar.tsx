import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDownIcon, ExternalLinkIcon } from '@radix-ui/react-icons'
import studio from '@theatre/studio'
import { useReactFlow } from '@xyflow/react'
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react'
import logoSvg from '/noodles-favicon.svg'
import { SettingsDialog } from '../../components/settings-dialog'
import { analytics } from '../../utils/analytics'
import { ContainerOp } from '../operators'
import { getOpStore, useNestingStore } from '../store'
import { directoryHandleCache } from '../utils/directory-handle-cache'
import { getParentPath, splitPath } from '../utils/path-utils'
import { Breadcrumbs } from './breadcrumbs'
import type { CopyControlsRef } from './copy-controls'
import { DataImporterTool } from './tools/data-importer-tool'
import { PointWizardTool } from './tools/point-wizard-tool'
import s from './top-menu-bar.module.css'
import type { UndoRedoHandlerRef } from './UndoRedoHandler'

interface TopMenuBarProps {
  projectName?: string
  onSaveProject: () => void
  onDownload?: () => Promise<void>
  onNewProject: () => void
  onImport: () => void
  onOpen?: (projectName?: string) => Promise<void>
  onOpenAddNode?: () => void
  showChatPanel?: boolean
  setShowChatPanel?: (show: boolean) => void
  undoRedoRef: RefObject<UndoRedoHandlerRef | null>
  copyControlsRef: RefObject<CopyControlsRef | null>
  startRender?: () => Promise<void>
  takeScreenshot?: () => Promise<void>
  isRendering?: boolean
  hasUnsavedChanges?: boolean
  showOverlay?: boolean
  setShowOverlay?: (show: boolean) => void
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
  setLayoutMode?: (mode: 'split' | 'noodles-on-top' | 'output-on-top') => void
  reactFlowRef?: RefObject<HTMLDivElement>
}

export function TopMenuBar({
  projectName,
  onSaveProject,
  onDownload,
  onNewProject,
  onImport,
  onOpen,
  onOpenAddNode,
  showChatPanel,
  setShowChatPanel,
  undoRedoRef,
  copyControlsRef,
  startRender,
  takeScreenshot,
  isRendering,
  hasUnsavedChanges,
  showOverlay,
  setShowOverlay,
  layoutMode,
  setLayoutMode,
  reactFlowRef,
}: TopMenuBarProps) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [showPointWizard, setShowPointWizard] = useState(false)
  const [showDataImporter, setShowDataImporter] = useState(false)
  const currentContainerId = useNestingStore(state => state.currentContainerId)
  const setCurrentContainerId = useNestingStore(state => state.setCurrentContainerId)
  const reactFlow = useReactFlow()

  // Load recent projects on mount
  useEffect(() => {
    directoryHandleCache
      .getAllProjectNames()
      .then(names => setRecentProjects(names))
      .catch(err => console.warn('Failed to load recent projects:', err))
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSaveProject, onNewProject, onOpen, onImport])

  // Detect platform for keyboard shortcuts
  const isMac = useMemo(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0, [])
  const mod = isMac ? '⌘' : 'Ctrl'

  // Container navigation
  const pathSegments = useMemo(() => splitPath(currentContainerId), [currentContainerId])
  const canGoUp = pathSegments.length > 1

  // Check if a selected node is a container - needs to update when nodes change
  const nodes = reactFlow.getNodes()
  const selectedContainer = useMemo(() => {
    const selectedNode = nodes.find(n => n.selected)
    if (!selectedNode) return null

    const store = getOpStore()
    const op = store.getOp(selectedNode.id)
    if (op instanceof ContainerOp) {
      return selectedNode.id
    }
    return null
  }, [nodes])

  const canGoInto = selectedContainer !== null

  const goUp = useCallback(() => {
    const parentPath = getParentPath(currentContainerId)
    if (parentPath && parentPath !== currentContainerId) {
      // Clear selection when changing levels
      reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
      setCurrentContainerId(parentPath)
      analytics.track('container_navigated', { method: 'menu', direction: 'up' })
      // Fit all nodes at the new level (no animation)
      setTimeout(() => {
        reactFlow.fitView({ duration: 0 })
      }, 50)
    }
  }, [currentContainerId, setCurrentContainerId, reactFlow])

  const goInto = useCallback(() => {
    if (selectedContainer) {
      // Clear selection when changing levels
      reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
      setCurrentContainerId(selectedContainer)
      analytics.track('container_navigated', { method: 'menu', direction: 'into' })
      // Fit all nodes at the new level (no animation)
      setTimeout(() => {
        reactFlow.fitView({ duration: 0 })
      }, 50)
    }
  }, [selectedContainer, setCurrentContainerId, reactFlow])

  const onSelectRenderSettings = useCallback(() => {
    const store = getOpStore()
    const obj = store.getSheetObject('render')
    if (obj) {
      studio.setSelection([obj])
    }
  }, [])

  const handleStartRender = useCallback(async () => {
    if (startRender) {
      await startRender()
      analytics.track('render_started', { source: 'menu' })
    }
  }, [startRender])

  const handleTakeScreenshot = useCallback(async () => {
    if (takeScreenshot) {
      await takeScreenshot()
      analytics.track('screenshot_taken', { source: 'menu' })
    }
  }, [takeScreenshot])

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
                        <span>Go to Parent Container</span>
                        <span className={s.shortcut}>U</span>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        className={s.dropdownItem}
                        onSelect={goInto}
                        disabled={!canGoInto}
                      >
                        <span>Go into Selected Container</span>
                        <span className={s.shortcut}>I</span>
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
                        onCheckedChange={setShowOverlay}
                      >
                        <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                          <i className="pi pi-check" style={{ fontSize: '12px' }} />
                        </DropdownMenu.ItemIndicator>
                        Show node graph overlay
                      </DropdownMenu.CheckboxItem>

                      <DropdownMenu.Separator className={s.dropdownSeparator} />

                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className={s.dropdownItem}>
                          Layout
                          <i
                            className="pi pi-chevron-right"
                            style={{ marginLeft: 'auto', fontSize: '10px' }}
                          />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent className={s.dropdownContent} sideOffset={2}>
                            <DropdownMenu.RadioGroup
                              value={layoutMode}
                              onValueChange={value =>
                                setLayoutMode?.(
                                  value as 'split' | 'noodles-on-top' | 'output-on-top'
                                )
                              }
                            >
                              <DropdownMenu.RadioItem className={s.dropdownItem} value="split">
                                <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                                  <i className="pi pi-check" style={{ fontSize: '12px' }} />
                                </DropdownMenu.ItemIndicator>
                                Split
                              </DropdownMenu.RadioItem>
                              <DropdownMenu.RadioItem
                                className={s.dropdownItem}
                                value="noodles-on-top"
                              >
                                <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                                  <i className="pi pi-check" style={{ fontSize: '12px' }} />
                                </DropdownMenu.ItemIndicator>
                                Noodles on Top
                              </DropdownMenu.RadioItem>
                              <DropdownMenu.RadioItem
                                className={s.dropdownItem}
                                value="output-on-top"
                              >
                                <DropdownMenu.ItemIndicator className={s.itemIndicator}>
                                  <i className="pi pi-check" style={{ fontSize: '12px' }} />
                                </DropdownMenu.ItemIndicator>
                                Output on Top
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
                <DropdownMenu.Item className={s.dropdownItem} onSelect={onSelectRenderSettings}>
                  Render Settings
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

        <div className={s.centerSection}>
          {reactFlowRef && (
            <>
              <button
                type="button"
                className={s.toolButton}
                onClick={onOpenAddNode}
                disabled={!onOpenAddNode}
              >
                <i className="pi pi-plus-circle" />
                <span className={s.toolLabel}>Add Op</span>
              </button>

              <button
                type="button"
                className={s.toolButton}
                onClick={() => setShowPointWizard(true)}
              >
                <i className="pi pi-map-marker" />
                <span className={s.toolLabel}>Create Point</span>
              </button>

              <button
                type="button"
                className={s.toolButton}
                onClick={() => setShowDataImporter(true)}
              >
                <i className="pi pi-file-import" />
                <span className={s.toolLabel}>Import Data</span>
              </button>
            </>
          )}
        </div>

        <div className={s.rightSection}>
          {setShowChatPanel && (
            <button
              type="button"
              onClick={() => setShowChatPanel(!showChatPanel)}
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
        </>
      )}

      <SettingsDialog open={settingsDialogOpen} setOpen={setSettingsDialogOpen} />
    </>
  )
}
