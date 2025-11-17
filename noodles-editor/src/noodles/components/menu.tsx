import { ChevronRightIcon } from '@radix-ui/react-icons'
import * as Menubar from '@radix-ui/react-menubar'
import { useReactFlow } from '@xyflow/react'
import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react'
import { importProjectOperation } from '../operations/import-project'
import { newProjectOperation } from '../operations/new-project'
import { openProjectOperation } from '../operations/open-project'
import { saveAsProjectOperation } from '../operations/save-as-project'
import { saveProjectOperation } from '../operations/save-project'
import { switchWorkspaceOperation } from '../operations/switch-workspace'
import type { OperationContext } from '../operations/types'
import {
  deleteProject as deleteStorage,
  listProjects as listStorageProjects,
  loadProject as loadStorage,
  projectExists,
  saveProject as saveStorage,
} from '../storage/workspace-storage'
import type { Workspace } from '../storage/workspace-types'
import { getOpStore } from '../store'
import { migrateProject } from '../utils/migrate-schema'
import { createOperationRunner } from '../utils/operation-runner'
import {
  EMPTY_PROJECT,
  NOODLES_VERSION,
  type NoodlesProjectJSON,
  serializeEdges,
  serializeNodes,
} from '../utils/serialization'
import { cacheWorkspace, getCachedWorkspace, getRecentWorkspaces } from '../utils/workspace-cache'
import { useDialogAPI } from './dialog-api'
import s from './menu.module.css'

// Recent projects tracking (kept for now, may migrate to workspace cache later)
type RecentProject = {
  workspace: string
  project: string
  lastOpened: string
}

const RECENT_PROJECTS_KEY = 'recentProjects'
function getRecentProjects(): RecentProject[] {
  return JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) || '[]')
}

const MAX_RECENT_PROJECTS = 6
function addToRecentProjects(workspace: string, projectName: string) {
  const recentProjects = getRecentProjects()

  // Remove if already exists
  const existingIndex = recentProjects.findIndex(
    (p: RecentProject) => p.workspace === workspace && p.project === projectName
  )
  if (existingIndex !== -1) {
    recentProjects.splice(existingIndex, 1)
  }

  // Add to front
  recentProjects.unshift({
    workspace,
    project: projectName,
    lastOpened: new Date().toISOString(),
  })

  // Limit list size
  if (recentProjects.length > MAX_RECENT_PROJECTS) {
    recentProjects.pop()
  }

  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recentProjects))
}

export function NoodlesMenubar({
  projectName,
  loadProjectFile,
  getTimelineJson,
  setProjectName,
  undoRedo,
  showChatPanel,
  setShowChatPanel,
}: {
  projectName?: string
  loadProjectFile: (project: NoodlesProjectJSON, projectName?: string) => void
  getTimelineJson: () => Record<string, unknown>
  setProjectName: Dispatch<SetStateAction<string | null>>
  undoRedo?: {
    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
    getState: () => { undoDescription?: string; redoDescription?: string }
  }
  showChatPanel?: boolean
  setShowChatPanel?: (show: boolean) => void
}) {
  const [recentlyOpened, setRecentlyOpened] = useState<RecentProject[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const { toObject } = useReactFlow()
  const dialogAPI = useDialogAPI()
  const runOperation = useMemo(() => createOperationRunner(dialogAPI), [dialogAPI])

  // Create operation context
  const operationContext: OperationContext = useMemo(
    () => ({
      // Current state
      workspace,
      activeProject: projectName || null,

      // State setters
      setWorkspace: (ws: Workspace) => {
        setWorkspace(ws)
        cacheWorkspace(ws)
      },
      setActiveProject: (name: string | null) => {
        setProjectName(name || undefined)
      },

      // Storage operations
      saveProject: async (ws: Workspace, name: string, data: NoodlesProjectJSON) => {
        await saveStorage(ws, name, data)
      },
      loadProject: async (ws: Workspace, name: string): Promise<NoodlesProjectJSON> => {
        const data = await loadStorage(ws, name)
        return await migrateProject(data)
      },
      deleteProject: async (ws: Workspace, name: string) => {
        await deleteStorage(ws, name)
      },
      listProjects: async (ws: Workspace): Promise<string[]> => {
        return await listStorageProjects(ws)
      },
      checkProjectExists: async (ws: Workspace, name: string): Promise<boolean> => {
        return await projectExists(ws, name)
      },

      // Workspace operations
      cacheWorkspace: async (ws: Workspace) => {
        await cacheWorkspace(ws)
      },
      getCachedWorkspace: async (name: string): Promise<Workspace | null> => {
        return await getCachedWorkspace(name)
      },
      listCachedWorkspaces: async (): Promise<Workspace[]> => {
        return await getRecentWorkspaces()
      },

      // Utility functions
      updateURL: (workspaceName: string, projectName: string | null) => {
        const url = new URL(window.location.href)
        if (projectName) {
          url.searchParams.set('workspace', workspaceName)
          url.searchParams.set('project', projectName)
        } else {
          url.searchParams.delete('project')
        }
        window.history.replaceState({}, '', url.toString())
      },
      updateRecent: (ws: Workspace, project: string) => {
        addToRecentProjects(ws.name, project)
      },
      removeFromRecent: (ws: Workspace, project: string) => {
        const recents = getRecentProjects()
        const updated = recents.filter(p => !(p.workspace === ws.name && p.project === project))
        localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated))
      },
      getNewProjectTemplate: (): NoodlesProjectJSON => {
        return EMPTY_PROJECT
      },

      // Current project data
      getCurrentProjectData: (): NoodlesProjectJSON => {
        const { nodes, edges, viewport } = toObject()
        const store = getOpStore()
        const serializedNodes = serializeNodes(store, nodes, edges)
        const serializedEdges = serializeEdges(store, nodes, edges)
        const timeline = getTimelineJson()

        return {
          nodes: serializedNodes,
          edges: serializedEdges,
          viewport,
          timeline,
          version: NOODLES_VERSION,
        }
      },
    }),
    [workspace, projectName, setProjectName, toObject, getTimelineJson]
  )

  // Menu handlers using operations
  const onNewProject = useCallback(async () => {
    try {
      await runOperation(newProjectOperation(operationContext))
      // Operation updates state through context
    } catch (error) {
      console.error('New project failed:', error)
    }
  }, [runOperation, operationContext])

  const onOpenProject = useCallback(async () => {
    try {
      const project = await runOperation(openProjectOperation(operationContext))
      if (project) {
        loadProjectFile(project, operationContext.activeProject || undefined)
      }
    } catch (error) {
      console.error('Open project failed:', error)
    }
  }, [runOperation, operationContext, loadProjectFile])

  const onSaveProject = useCallback(async () => {
    try {
      await runOperation(saveProjectOperation(operationContext))
    } catch (error) {
      console.error('Save project failed:', error)
    }
  }, [runOperation, operationContext])

  const onSaveAsProject = useCallback(async () => {
    try {
      await runOperation(saveAsProjectOperation(operationContext))
    } catch (error) {
      console.error('Save As project failed:', error)
    }
  }, [runOperation, operationContext])

  const onImportProject = useCallback(async () => {
    try {
      const project = await runOperation(importProjectOperation(operationContext))
      if (project) {
        loadProjectFile(project, operationContext.activeProject || undefined)
      }
    } catch (error) {
      console.error('Import project failed:', error)
    }
  }, [runOperation, operationContext, loadProjectFile])

  const onSwitchWorkspace = useCallback(async () => {
    try {
      await runOperation(switchWorkspaceOperation(operationContext))
    } catch (error) {
      console.error('Switch workspace failed:', error)
    }
  }, [runOperation, operationContext])

  const updateRecentlyOpened = useCallback(() => {
    setRecentlyOpened(getRecentProjects())
  }, [])

  return (
    <Menubar.Root className={s.menubarRoot}>
      <Menubar.Menu>
        <Menubar.Trigger className={s.menubarTrigger}>File</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className={s.menubarContent}
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.Item className={s.menubarItem} onSelect={onNewProject}>
              New Project <div className={s.menubarItemRightSlot}>⌘ N</div>
            </Menubar.Item>
            <Menubar.Item className={s.menubarItem} onSelect={onImportProject}>
              Import
            </Menubar.Item>
            <Menubar.Separator className={s.menubarSeparator} />
            <Menubar.Item className={s.menubarItem} onSelect={onOpenProject}>
              Open... <div className={s.menubarItemRightSlot}>⌘ O</div>
            </Menubar.Item>
            <Menubar.Sub onOpenChange={updateRecentlyOpened}>
              <Menubar.SubTrigger className={s.menubarSubTrigger}>
                Open Recent
                <div className={s.menubarItemRightSlot}>
                  <ChevronRightIcon />
                </div>
              </Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent className={s.menubarSubContent} alignOffset={-5}>
                  {recentlyOpened.map(recent => (
                    <Menubar.Item
                      key={`${recent.workspace}-${recent.project}`}
                      className={s.menubarItem}
                      onSelect={async () => {
                        try {
                          // Load workspace and project
                          const ws = await getCachedWorkspace(recent.workspace)
                          if (!ws) {
                            console.error('Workspace not found in cache:', recent.workspace)
                            return
                          }
                          const project = await loadStorage(ws, recent.project)
                          const migrated = await migrateProject(project)
                          setWorkspace(ws)
                          loadProjectFile(migrated, recent.project)
                        } catch (error) {
                          console.error('Failed to load recent project:', error)
                        }
                      }}
                    >
                      {recent.project} ({recent.workspace})
                    </Menubar.Item>
                  ))}
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
            <Menubar.Separator className={s.menubarSeparator} />
            <Menubar.Item className={s.menubarItem} onSelect={onSaveProject}>
              Save
            </Menubar.Item>
            <Menubar.Item className={s.menubarItem} onSelect={onSaveAsProject}>
              Save As...
            </Menubar.Item>
            <Menubar.Item className={s.menubarItem} onSelect={onSwitchWorkspace}>
              Switch Workspace...
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      <Menubar.Menu>
        <Menubar.Trigger className={s.menubarTrigger}>Edit</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className={s.menubarContent}
            align="start"
            sideOffset={5}
            alignOffset={-3}
          >
            <Menubar.Item
              className={s.menubarItem}
              onSelect={undoRedo?.undo}
              disabled={!undoRedo?.canUndo()}
            >
              Undo{' '}
              {undoRedo?.getState().undoDescription
                ? `"${undoRedo.getState().undoDescription}"`
                : ''}
              <div className={s.menubarItemRightSlot}>⌘ Z</div>
            </Menubar.Item>
            <Menubar.Item
              className={s.menubarItem}
              onSelect={undoRedo?.redo}
              disabled={!undoRedo?.canRedo()}
            >
              Redo{' '}
              {undoRedo?.getState().redoDescription
                ? `"${undoRedo.getState().redoDescription}"`
                : ''}
              <div className={s.menubarItemRightSlot}>⌘ ⇧ Z</div>
            </Menubar.Item>
            <Menubar.Separator className={s.menubarSeparator} />
            <Menubar.Item className={s.menubarItem}>Cut</Menubar.Item>
            <Menubar.Item className={s.menubarItem}>Copy</Menubar.Item>
            <Menubar.Item className={s.menubarItem}>Paste</Menubar.Item>
            <Menubar.Item className={s.menubarItem}>Delete</Menubar.Item>
            <Menubar.Separator className={s.menubarSeparator} />
            <Menubar.Sub>
              <Menubar.SubTrigger className={s.menubarSubTrigger}>
                Find
                <div className={s.menubarItemRightSlot}>
                  <ChevronRightIcon />
                </div>
              </Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent className={s.menubarSubContent} alignOffset={-5}>
                  <Menubar.Item className={s.menubarItem}>Find…</Menubar.Item>
                  <Menubar.Item className={s.menubarItem}>Find Next</Menubar.Item>
                  <Menubar.Item className={s.menubarItem}>Find Previous</Menubar.Item>
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* Chat button on the right side */}
      {setShowChatPanel && (
        <div className={s.menubarRightSlot}>
          <button
            type="button"
            onClick={() => setShowChatPanel(!showChatPanel)}
            className={s.chatButton}
            title="Toggle Noodles AI Assistant"
          >
            💬 {showChatPanel ? 'Hide' : 'Assistant'}
          </button>
        </div>
      )}
    </Menubar.Root>
  )
}
