import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronLeftIcon, DotsHorizontalIcon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { useFileSystemStore } from '../noodles/filesystem-store'
import type { CachedHandleEntry } from '../noodles/utils/directory-handle-cache'
import { directoryHandleCache } from '../noodles/utils/directory-handle-cache'
import {
  checkFileSystemSupport,
  fileExists,
  getOPFSRoot,
  queryPermission,
  requestPermissionState,
  selectDirectory,
} from '../noodles/utils/filesystem'
import { analytics } from '../utils/analytics'
import { debugUI } from '../utils/debug'
import s from './quick-start-modal.module.css'

export interface UserProject {
  name: string
  path: string
  storageType: 'fileSystemAccess' | 'opfs'
  cachedAt?: number
  handle?: FileSystemDirectoryHandle // The remembered folder, for local folder projects
  permission?: PermissionState // Access to that folder, read without asking
}

// Where a project's actions menu is: the Projects tab or Recent projects on the home view
export type ProjectListSource = 'projects_tab' | 'recent_projects'

// After a browser restart a remembered folder's permission is back to 'prompt', and the
// project page can't ask for it without a user gesture. A click on the project is one, so
// ask here before navigating. If the user says no, the project page explains what to do.
export async function requestProjectAccess(
  handle?: FileSystemDirectoryHandle,
  source = 'project_list'
): Promise<PermissionState | undefined> {
  if (!handle) return
  const current = await queryPermission(handle, 'readwrite')
  if (current !== 'prompt') return current
  const permission = await requestPermissionState(handle, 'readwrite')
  if (permission === 'granted') {
    analytics.track('project_permission_granted', { source })
  } else {
    analytics.track('project_permission_denied', { source, state: permission })
  }
  return permission
}

// Run in a project's click handler, before navigating to it
export async function prepareProjectOpen(
  project: Pick<UserProject, 'storageType' | 'handle'>
): Promise<void> {
  // The project page loads from the active storage type, which opening an example sets
  // to 'memory'. Point it at where this project lives.
  useFileSystemStore.getState().setActiveStorageType(project.storageType)
  await requestProjectAccess(project.handle)
}

// Forget a project's folder. The folder and its files stay where they are on disk.
export async function removeProjectFromList(
  projectName: string,
  source: ProjectListSource
): Promise<void> {
  await directoryHandleCache.removeHandle(projectName)
  analytics.track('project_removed_from_list', { storageType: 'fileSystemAccess', source })
}

// Point a remembered project at a folder the user picked, for example after moving or
// renaming it on disk. Projects are named after their folder, so a new folder name
// renames the project in the list. Returns an error message, or null on success.
export async function reconnectProjectFolder(
  projectName: string,
  folder: FileSystemDirectoryHandle,
  source: ProjectListSource
): Promise<string | null> {
  if (!(await fileExists(folder, 'noodles.json'))) {
    return `The folder "${folder.name}" has no noodles.json file. Choose the folder that holds the project.`
  }
  await directoryHandleCache.renameProject(projectName, folder.name, folder)
  analytics.track('project_folder_reconnected', {
    source,
    folderNameChanged: folder.name !== projectName,
  })
  return null
}

interface ProjectActionsMenuProps {
  projectName: string
  handle: FileSystemDirectoryHandle
  source: ProjectListSource
  // Shows a problem from an action, or clears it with null
  onError: (message: string | null) => void
}

// The "..." menu on a remembered local folder project
export function ProjectActionsMenu({
  projectName,
  handle,
  source,
  onError,
}: ProjectActionsMenuProps) {
  const [permission, setPermission] = useState<PermissionState>('granted')

  // Read on open, without asking, so the menu only offers access when it's missing
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) queryPermission(handle, 'readwrite').then(setPermission)
    },
    [handle]
  )

  const onAllowAccess = useCallback(async () => {
    onError(null)
    const result = await requestProjectAccess(handle, 'project_menu')
    if (result === 'granted') {
      // Saving the entry again refreshes the lists that show its access
      await directoryHandleCache.cacheHandle(projectName, handle, handle.name)
    } else {
      onError(
        `Your browser didn't allow access to "${handle.name}". Use "Choose folder" to pick it again.`
      )
    }
  }, [projectName, handle, onError])

  const onChooseFolder = useCallback(async () => {
    onError(null)
    try {
      const folder = await selectDirectory()
      onError(await reconnectProjectFolder(projectName, folder, source))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      debugUI('Failed to choose a project folder', error)
      onError(`Couldn't open that folder for "${projectName}".`)
    }
  }, [projectName, source, onError])

  const onRemove = useCallback(async () => {
    onError(null)
    try {
      await removeProjectFromList(projectName, source)
    } catch (error) {
      debugUI('Failed to remove project from list', error)
      onError(`Couldn't remove "${projectName}" from the list.`)
    }
  }, [projectName, source, onError])

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={s.projectMenuTrigger}
          aria-label={`Project actions for ${projectName}`}
        >
          <DotsHorizontalIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.projectMenu} align="end" sideOffset={4}>
          <DropdownMenu.Label className={s.projectMenuLabel}>
            Folder: {handle.name}
          </DropdownMenu.Label>
          {permission !== 'granted' && (
            <DropdownMenu.Item className={s.projectMenuItem} onSelect={onAllowAccess}>
              Allow access
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={s.projectMenuItem} onSelect={onChooseFolder}>
            Choose folder…
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={s.projectMenuSeparator} />
          <DropdownMenu.Item className={s.projectMenuItem} onSelect={onRemove}>
            Remove from list
          </DropdownMenu.Item>
          <p className={s.projectMenuNote}>The folder and its files stay on your computer.</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function formatDate(timestamp?: number): string | null {
  if (!timestamp) return null
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface ProjectsViewProps {
  onBack?: () => void
  onClose: () => void
}

export function ProjectsView({ onBack, onClose }: ProjectsViewProps) {
  const [, navigate] = useLocation()
  const [allProjects, setAllProjects] = useState<UserProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fileSystemSupport = checkFileSystemSupport()

  const loadAllProjects = useCallback(async () => {
    const result: UserProject[] = []

    // Load fileSystemAccess handles from IndexedDB cache
    if (fileSystemSupport.fileSystemAccess) {
      try {
        const handles = await directoryHandleCache.getAllCachedHandles()
        for (const entry of handles) {
          result.push({
            name: entry.projectName,
            path: `/projects/${entry.projectName}`,
            storageType: 'fileSystemAccess',
            cachedAt: entry.cachedAt,
            handle: entry.handle,
            permission: await queryPermission(entry.handle, 'readwrite'),
          })
        }
      } catch (err) {
        debugUI('Failed to load cached directory handles', err)
      }
    }

    // Load OPFS projects
    if (fileSystemSupport.opfs) {
      try {
        const root = await getOPFSRoot()
        for await (const entry of root.values()) {
          if (entry.kind === 'directory') {
            const alreadyListed = result.some(p => p.name === entry.name)
            if (!alreadyListed) {
              try {
                const dir = await root.getDirectoryHandle(entry.name)
                await dir.getFileHandle('noodles.json')
                result.push({
                  name: entry.name,
                  path: `/projects/${entry.name}`,
                  storageType: 'opfs',
                })
              } catch {
                // No noodles.json — skip
              }
            }
          }
        }
      } catch (err) {
        debugUI('Failed to enumerate OPFS projects', err)
      }
    }

    setAllProjects(result)
    setProjectsLoading(false)
  }, [fileSystemSupport.fileSystemAccess, fileSystemSupport.opfs])

  // Load all projects, and again when one is removed or its folder changes
  useEffect(() => {
    loadAllProjects()
    return directoryHandleCache.subscribe(loadAllProjects)
  }, [loadAllProjects])

  const handleNewProject = useCallback(() => {
    analytics.track('quick_start_new_project')
    onClose()
    navigate('/projects/new')
  }, [navigate, onClose])

  const handleOpenFolder = useCallback(async () => {
    try {
      const handle = await selectDirectory()
      await directoryHandleCache.cacheHandle(handle.name, handle, handle.name)
      onClose()
      navigate(`/projects/${handle.name}`)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      console.error('Failed to open project:', error)
    }
  }, [navigate, onClose])

  const handleProjectClick = useCallback(
    async (project: UserProject) => {
      analytics.track('quick_start_project_selected', { path: project.path })
      await prepareProjectOpen(project)
      onClose()
      navigate(project.path)
    },
    [navigate, onClose]
  )

  return (
    <>
      {/* Show view header only in standalone mode (with back button) */}
      {onBack && (
        <div className={s.viewHeader}>
          <button type="button" className={s.backButton} onClick={onBack}>
            <ChevronLeftIcon width={16} height={16} />
            Back
          </button>
          <Dialog.Title className={s.viewTitle}>Projects</Dialog.Title>
          <Dialog.Description className={s.viewSubtitle}>
            Your saved projects from local folders and browser storage
          </Dialog.Description>
        </div>
      )}

      <div className={s.body}>
        {fileSystemSupport.fileSystemAccess && (
          <div className={s.projectActionsRow}>
            <button type="button" className={s.projectActionButton} onClick={handleNewProject}>
              <i className="pi pi-plus-circle" />
              New project
            </button>
            <button type="button" className={s.projectActionButton} onClick={handleOpenFolder}>
              <i className="pi pi-folder-open" />
              Open folder…
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className={cx(s.error, s.listError)}>
            {error}
          </div>
        )}

        {projectsLoading ? (
          <p className={s.loadingText}>Loading projects…</p>
        ) : allProjects.length === 0 ? (
          <div className={s.emptyState}>
            <p>No projects found.</p>
            {fileSystemSupport.fileSystemAccess && (
              <p>Use "New project" or "Open folder…" to get started.</p>
            )}
          </div>
        ) : (
          <div className={s.fullGrid}>
            {allProjects.map(project => (
              <div key={project.path} className={s.cardWithMenu}>
                <button
                  type="button"
                  className={s.projectCard}
                  onClick={() => handleProjectClick(project)}
                >
                  <div className={s.projectInfo}>
                    <h4>{project.name}</h4>
                    <p>
                      <span className={s.storageBadge}>
                        {project.storageType === 'opfs' ? 'OPFS' : 'Local folder'}
                      </span>
                      {project.permission === 'prompt' && (
                        <span className={s.storageBadge}>Needs access</span>
                      )}
                      {project.permission === 'denied' && (
                        <span className={s.storageBadge}>No access</span>
                      )}
                      {project.cachedAt && (
                        <span className={s.projectDate}>{formatDate(project.cachedAt)}</span>
                      )}
                    </p>
                  </div>
                </button>
                {project.handle && (
                  <ProjectActionsMenu
                    projectName={project.name}
                    handle={project.handle}
                    source="projects_tab"
                    onError={setError}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// Hook to load recent projects (for home view), again whenever the list changes
export function useRecentProjects(limit = 3): CachedHandleEntry[] {
  const [recentProjects, setRecentProjects] = useState<CachedHandleEntry[]>([])

  useEffect(() => {
    async function loadRecent() {
      try {
        const handles = await directoryHandleCache.getAllCachedHandles()
        setRecentProjects(handles.slice(0, limit))
      } catch (err) {
        debugUI('Failed to load recent projects', err)
      }
    }
    loadRecent()
    return directoryHandleCache.subscribe(loadRecent)
  }, [limit])

  return recentProjects
}
