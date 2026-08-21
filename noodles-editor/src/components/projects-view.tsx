import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeftIcon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import type { CachedHandleEntry } from '../noodles/utils/directory-handle-cache'
import { directoryHandleCache } from '../noodles/utils/directory-handle-cache'
import { checkFileSystemSupport, getOPFSRoot, selectDirectory } from '../noodles/utils/filesystem'
import { analytics } from '../utils/analytics'
import { debugUI } from '../utils/debug'
import s from './quick-start-modal.module.css'

export interface UserProject {
  name: string
  path: string
  storageType: 'fileSystemAccess' | 'opfs'
  cachedAt?: number
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
  const fileSystemSupport = checkFileSystemSupport()

  // Load all projects
  useEffect(() => {
    async function loadAllProjects() {
      setProjectsLoading(true)
      const result: UserProject[] = []

      // Load fileSystemAccess handles from IndexedDB cache
      if (fileSystemSupport.fileSystemAccess) {
        try {
          const handles = await directoryHandleCache.getAllCachedHandles()
          for (const entry of handles) {
            result.push({
              name: entry.handle.name,
              path: `/projects/${entry.projectName}`,
              storageType: 'fileSystemAccess',
              cachedAt: entry.cachedAt,
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
    }

    loadAllProjects()
  }, [fileSystemSupport.fileSystemAccess, fileSystemSupport.opfs])

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
    (path: string) => {
      analytics.track('quick_start_project_selected', { path })
      onClose()
      navigate(path)
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
              <button
                key={project.path}
                type="button"
                className={s.projectCard}
                onClick={() => handleProjectClick(project.path)}
              >
                <div className={s.projectInfo}>
                  <h4>{project.name}</h4>
                  <p>
                    <span className={s.storageBadge}>
                      {project.storageType === 'opfs' ? 'OPFS' : 'Local folder'}
                    </span>
                    {project.cachedAt && (
                      <span className={s.projectDate}>{formatDate(project.cachedAt)}</span>
                    )}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// Hook to load recent projects (for home view)
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
  }, [limit])

  return recentProjects
}
