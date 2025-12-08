import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import studio from '@theatre/studio'
import { useReactFlow } from '@xyflow/react'
import { type RefObject, useCallback, useMemo, useState } from 'react'
import { SettingsDialog } from '../../components/settings-dialog'
import { analytics } from '../../utils/analytics'
import { useFileSystemStore } from '../filesystem-store'
import { ContainerOp } from '../operators'
import { getOpStore, useNestingStore } from '../store'
import { directoryHandleCache } from '../utils/directory-handle-cache'
import { requestPermission, selectDirectory, writeFileToDirectory } from '../utils/filesystem'
import { migrateProject } from '../utils/migrate-schema'
import { getParentPath, splitPath } from '../utils/path-utils'
import { EMPTY_PROJECT, type NoodlesProjectJSON, safeStringify } from '../utils/serialization'
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
  onSaveProject: () => void
  onOpenAddNode?: () => void
  showChatPanel?: boolean
  setShowChatPanel?: (show: boolean) => void
  undoRedoRef: RefObject<UndoRedoHandlerRef | null>
  copyControlsRef: RefObject<CopyControlsRef | null>
  startRender?: () => Promise<void>
  takeScreenshot?: () => Promise<void>
  isRendering?: boolean
}

export function TopMenuBar({
  projectName,
  setProjectName,
  onSaveProject,
  onOpenAddNode,
  showChatPanel,
  setShowChatPanel,
  undoRedoRef,
  copyControlsRef,
  startRender,
  takeScreenshot,
  isRendering,
}: TopMenuBarProps) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
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
    try {
      // Prompt user to select/create a directory for the new project
      const directoryHandle = await selectDirectory()
      const directoryName = directoryHandle.name

      // Ensure we have write permission
      const hasPermission = await requestPermission(directoryHandle, 'readwrite')
      if (!hasPermission) {
        console.error('Permission denied to write to directory')
        return
      }

      // Write empty project to noodles.json
      const projectData = { ...EMPTY_PROJECT, ...newProjectJSON } as NoodlesProjectJSON
      await writeFileToDirectory(directoryHandle, 'noodles.json', safeStringify(projectData))

      // Cache the directory handle
      await directoryHandleCache.cacheHandle(directoryName, directoryHandle, directoryHandle.name)

      // Update store with directory handle
      setCurrentDirectory(directoryHandle, directoryName)

      // Navigate to the new project (triggers load)
      setProjectName(directoryName)

      analytics.track('project_created', { method: 'new' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the picker
        return
      }
      console.error('Failed to create new project:', error)
    }
  }, [setProjectName, setCurrentDirectory])

  const onImport = useCallback(async () => {
    try {
      // First, prompt for the project file to import
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
      const parsed = JSON.parse(text) as Partial<NoodlesProjectJSON>

      // Migrate the imported project to latest version
      const projectData = await migrateProject({
        ...EMPTY_PROJECT,
        ...parsed,
      } as NoodlesProjectJSON)

      // Now prompt for directory to save the imported project
      const directoryHandle = await selectDirectory()
      const directoryName = directoryHandle.name

      // Ensure we have write permission
      const hasPermission = await requestPermission(directoryHandle, 'readwrite')
      if (!hasPermission) {
        console.error('Permission denied to write to directory')
        return
      }

      // Write imported project to noodles.json
      await writeFileToDirectory(directoryHandle, 'noodles.json', safeStringify(projectData))

      // Cache the directory handle
      await directoryHandleCache.cacheHandle(directoryName, directoryHandle, directoryHandle.name)

      // Update store with directory handle
      setCurrentDirectory(directoryHandle, directoryName)

      // Navigate to the imported project (triggers load)
      setProjectName(directoryName)

      analytics.track('project_imported')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the picker
        return
      }
      console.error('Failed to import project:', error)
    }
  }, [setProjectName, setCurrentDirectory])

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
