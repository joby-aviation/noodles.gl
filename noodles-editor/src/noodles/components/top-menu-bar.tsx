import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import { studio } from '@theatre/studio'
import { useReactFlow } from '@xyflow/react'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import { SettingsDialog } from '../../components/settings-dialog'
import { useRenderActions } from '../../hooks/use-render-actions'
import { analytics } from '../../utils/analytics'
import { useActiveStorageType, useFileSystemStore } from '../filesystem-store'
import type { NoodlesProjectJSON } from '../noodles'
import { ContainerOp } from '../operators'
import { getOpStore, useNestingStore } from '../store'
import { getParentPath, splitPath } from '../utils/path-utils'
import { saveProjectLocally } from '../utils/serialization'
import { Breadcrumbs } from './breadcrumbs'
import type { CopyControlsRef } from './copy-controls'
import s from './top-menu-bar.module.css'
import type { UndoRedoHandlerRef } from './UndoRedoHandler'

const newProjectJSON = {
  version: 6,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

interface TopMenuBarProps {
  projectName?: string
  setProjectName: (name: string | null) => void
  getNoodlesProjectJson: () => NoodlesProjectJSON
  loadProjectFile: (project: NoodlesProjectJSON) => void
  onSaveProject: () => void
  onOpenAddNode?: () => void
  showChatPanel?: boolean
  setShowChatPanel?: (show: boolean) => void
  undoRedoRef: RefObject<UndoRedoHandlerRef | null>
  copyControlsRef: RefObject<CopyControlsRef | null>
}

export function TopMenuBar({
  projectName,
  setProjectName,
  getNoodlesProjectJson,
  loadProjectFile,
  onSaveProject,
  onOpenAddNode,
  showChatPanel,
  setShowChatPanel,
  undoRedoRef,
  copyControlsRef,
}: TopMenuBarProps) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const renderActions = useRenderActions()
  const storageType = useActiveStorageType()
  const { setCurrentDirectory } = useFileSystemStore()
  const currentContainerId = useNestingStore(state => state.currentContainerId)
  const setCurrentContainerId = useNestingStore(state => state.setCurrentContainerId)
  const reactFlow = useReactFlow()

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

  const onNewProject = useCallback(async () => {
    loadProjectFile(newProjectJSON as NoodlesProjectJSON)
    analytics.track('project_created', { method: 'new' })
  }, [loadProjectFile])

  const onImport = useCallback(async () => {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'Noodles Project',
          accept: {
            'application/json': ['.json'],
          },
        },
      ],
    })
    const file = await fileHandle.getFile()
    const text = await file.text()
    const projectJson = JSON.parse(text)
    loadProjectFile(projectJson)
    setProjectName(null)
    setCurrentDirectory(null)
    analytics.track('project_imported')
  }, [loadProjectFile, setProjectName, setCurrentDirectory])

  const onDownloadProject = useCallback(async () => {
    const noodlesProjectJson = getNoodlesProjectJson()
    saveProjectLocally(projectName || 'untitled', noodlesProjectJson, storageType)
    analytics.track('project_exported', { storageType })
  }, [projectName, getNoodlesProjectJson, storageType])

  const onSelectRenderSettings = useCallback(() => {
    const store = getOpStore()
    const obj = store.getSheetObject('render')
    if (obj) {
      studio.setSelection([obj])
    }
  }, [])

  const onSelectEditorSettings = useCallback(() => {
    const store = getOpStore()
    const obj = store.getSheetObject('editor')
    if (obj) {
      studio.setSelection([obj])
    }
  }, [])

  const handleStartRender = useCallback(async () => {
    if (renderActions) {
      await renderActions.startRender()
      analytics.track('render_started', { source: 'menu' })
    }
  }, [renderActions])

  const handleTakeScreenshot = useCallback(async () => {
    if (renderActions) {
      await renderActions.takeScreenshot()
      analytics.track('screenshot_taken', { source: 'menu' })
    }
  }, [renderActions])

  return (
    <>
      <div className={s.topMenuBar}>
        <div className={s.leftSection}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={s.hamburgerButton} title="Menu">
                <HamburgerMenuIcon />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content className={s.dropdownContent} align="start" sideOffset={5}>
                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={onOpenAddNode}
                  disabled={!onOpenAddNode}
                >
                  <span>Add Node</span>
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
                        New Project
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={s.dropdownItem} onSelect={onImport}>
                        Import
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={s.dropdownItem} onSelect={onSaveProject}>
                        Save
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={s.dropdownItem} onSelect={onDownloadProject}>
                        Download Project
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

                <DropdownMenu.Separator className={s.dropdownSeparator} />

                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={handleStartRender}
                  disabled={!renderActions}
                >
                  Start Render
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={handleTakeScreenshot}
                  disabled={!renderActions}
                >
                  Take Screenshot
                </DropdownMenu.Item>
                <DropdownMenu.Item className={s.dropdownItem} onSelect={onSelectRenderSettings}>
                  Render Settings
                </DropdownMenu.Item>

                <DropdownMenu.Separator className={s.dropdownSeparator} />

                <DropdownMenu.Item className={s.dropdownItem} onSelect={onSelectEditorSettings}>
                  Editor Settings
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={s.dropdownItem}
                  onSelect={() => setSettingsDialogOpen(true)}
                >
                  App Settings
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <div className={s.breadcrumbContainer}>
            <Breadcrumbs projectName={projectName} />
          </div>
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

      <SettingsDialog open={settingsDialogOpen} setOpen={setSettingsDialogOpen} />
    </>
  )
}
