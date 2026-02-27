import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import s from './examples-page.module.css'
import { directoryHandleCache } from './noodles/utils/directory-handle-cache'
import { checkFileSystemSupport, getOPFSRoot, selectDirectory } from './noodles/utils/filesystem'

interface UserProject {
  name: string
  path: string
  storageType: 'fileSystemAccess' | 'opfs'
  cachedAt?: number
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<UserProject[]>([])
  const [loading, setLoading] = useState(true)
  const [, navigate] = useLocation()
  const support = checkFileSystemSupport()

  const loadProjects = useCallback(async () => {
    setLoading(true)
    const result: UserProject[] = []

    // Load fileSystemAccess handles from IndexedDB cache
    if (support.fileSystemAccess) {
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
        console.error('Failed to load cached directory handles', err)
      }
    }

    // Load OPFS projects by iterating root
    if (support.opfs) {
      try {
        const root = await getOPFSRoot()
        for await (const entry of root.values()) {
          if (entry.kind === 'directory') {
            // Only include dirs not already in fileSystemAccess list
            const alreadyListed = result.some(p => p.name === entry.name)
            if (!alreadyListed) {
              // Check if this directory has a noodles.json
              try {
                const dir = await root.getDirectoryHandle(entry.name)
                dir.getFileHandle('noodles.json')
                result.push({
                  name: entry.name,
                  path: `/projects/${entry.name}`,
                  storageType: 'opfs',
                })
              } catch {
                // No noodles.json — skip this directory
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to enumerate OPFS projects', err)
      }
    }

    setProjects(result)
    setLoading(false)
  }, [support.fileSystemAccess, support.opfs])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  async function handleOpenFolder() {
    try {
      const handle = await selectDirectory()
      await directoryHandleCache.cacheHandle(handle.name, handle, handle.name)
      navigate(`/projects/${handle.name}`)
    } catch {
      // User cancelled or permission denied — ignore
    }
  }

  function formatDate(timestamp?: number) {
    if (!timestamp) return null
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className={s.examplesPage} data-testid="projects-page">
      <h1>Projects</h1>
      <p>Your saved projects from local folders and browser storage.</p>

      {support.fileSystemAccess && (
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <button
            type="button"
            onClick={handleOpenFolder}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: '1px solid var(--violet-7)',
              background: 'var(--violet-3)',
              color: 'var(--violet-11)',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Open folder…
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ textAlign: 'center', color: 'var(--mauve-11)' }}>Loading projects…</p>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--mauve-11)', marginTop: '3rem' }}>
          <p>No projects found.</p>
          {support.fileSystemAccess && (
            <p>Use "Open folder…" to open a project from your file system.</p>
          )}
        </div>
      ) : (
        <div className={s.examplesGrid}>
          {projects.map(project => (
            <Link key={project.path} href={project.path} className={s.exampleCard}>
              <h3>{project.name}</h3>
              <p>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '0.75rem',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '3px',
                    background: 'var(--mauve-4)',
                    color: 'var(--mauve-11)',
                    marginRight: '0.5rem',
                  }}
                >
                  {project.storageType === 'opfs' ? 'OPFS' : 'Local folder'}
                </span>
                {project.cachedAt && (
                  <span style={{ fontSize: '0.85rem' }}>{formatDate(project.cachedAt)}</span>
                )}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
