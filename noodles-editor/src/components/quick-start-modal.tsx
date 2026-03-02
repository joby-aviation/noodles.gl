import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeftIcon, Cross2Icon } from '@radix-ui/react-icons'
import { basename, dirname } from 'node:path'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import logoSvg from '/noodles-favicon.svg'
import type { CachedHandleEntry } from '../noodles/utils/directory-handle-cache'
import { directoryHandleCache } from '../noodles/utils/directory-handle-cache'
import { checkFileSystemSupport, getOPFSRoot, selectDirectory } from '../noodles/utils/filesystem'
import { analytics } from '../utils/analytics'
import s from './quick-start-modal.module.css'

type ModalView = 'home' | 'projects' | 'examples'

// Vite glob imports for examples
const exampleProjects = import.meta.glob('../examples/**/noodles.json', {
  eager: true,
  import: 'default',
})
const exampleReadmes = import.meta.glob('../examples/**/README.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

interface ExampleProject {
  id: string
  name: string
  path: string
  description?: string
}

interface UserProject {
  name: string
  path: string
  storageType: 'fileSystemAccess' | 'opfs'
  cachedAt?: number
}

const ACRONYMS: Record<string, string> = {
  nyc: 'NYC',
  usa: 'USA',
  uk: 'UK',
  api: 'API',
  json: 'JSON',
  csv: 'CSV',
}

function extractDescription(readme?: string): string {
  if (!readme) return ''
  const lines = readme.split('\n')
  let foundTitle = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      foundTitle = true
      continue
    }
    if (!trimmed) continue
    if (foundTitle) {
      if (trimmed.startsWith('_')) continue
      return trimmed
    }
  }
  return ''
}

function formatProjectName(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(
      /\b\w+\b/g,
      word => ACRONYMS[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1)
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

const CURATED_EXAMPLES = [
  {
    id: 'world-flights',
    title: 'World Flights',
    description: 'Animated flight trajectories across the globe',
    icon: 'pi-globe',
  },
  {
    id: 'california-earthquakes',
    title: 'California Earthquakes',
    description: 'Seismic activity with magnitude-driven styling',
    icon: 'pi-chart-scatter',
  },
  {
    id: 'nyc-taxis',
    title: 'NYC Taxis',
    description: 'Taxi trips showing pickup to dropoff flows',
    icon: 'pi-car',
  },
  {
    id: 'sf-street-trees',
    title: 'SF Street Trees',
    description: 'Urban forest inventory across San Francisco',
    icon: 'pi-sitemap',
  },
]

// Store for pending quick start actions (file upload or LLM question)
// These can be picked up by the main app after navigating to a project
interface PendingQuickStartAction {
  type: 'file' | 'llm'
  file?: File
  question?: string
}

let pendingAction: PendingQuickStartAction | null = null

export function getPendingQuickStartAction(): PendingQuickStartAction | null {
  const action = pendingAction
  pendingAction = null // Clear after reading
  return action
}

export function setPendingQuickStartAction(action: PendingQuickStartAction | null) {
  pendingAction = action
}

interface QuickStartModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuickStartModal({ open, onOpenChange }: QuickStartModalProps) {
  const [location, navigate] = useLocation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [llmQuestion, setLlmQuestion] = useState('')
  const [error, setError] = useState<string | null>(null)

  // View state derived from URL
  const view: ModalView = useMemo(() => {
    if (location === '/projects') return 'projects'
    if (location === '/examples') return 'examples'
    return 'home'
  }, [location])

  // Recent projects state (for home view)
  const [recentProjects, setRecentProjects] = useState<CachedHandleEntry[]>([])

  // All projects state (for projects view)
  const [allProjects, setAllProjects] = useState<UserProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const fileSystemSupport = checkFileSystemSupport()

  // All examples (for examples view)
  const allExamples = useMemo<ExampleProject[]>(() => {
    const list: ExampleProject[] = []
    for (const path of Object.keys(exampleProjects)) {
      const projectId = basename(dirname(path))
      const readmePath = path.replace('noodles.json', 'README.md')
      let projectName = projectId
      let description = ''

      const readme = exampleReadmes[readmePath] as string | undefined
      if (readme) {
        const firstLine = readme.split('\n')[0]
        const match = firstLine.match(/^#\s+(.*)/)
        if (match?.[1]) {
          projectName = match[1].trim()
        }
        description = extractDescription(readme)
      }

      list.push({
        id: projectId,
        name: projectName,
        path: `/examples/${projectId}`,
        description,
      })
    }
    list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [])

  // Load recent projects for home view
  useEffect(() => {
    async function loadRecent() {
      try {
        const handles = await directoryHandleCache.getAllCachedHandles()
        setRecentProjects(handles.slice(0, 3))
      } catch (err) {
        console.error('Failed to load recent projects', err)
      }
    }
    loadRecent()
  }, [])

  // Load all projects when viewing projects page
  useEffect(() => {
    if (view !== 'projects') return

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
          console.error('Failed to load cached directory handles', err)
        }
      }

      // Load OPFS projects
      if (fileSystemSupport.opfs) {
        try {
          const root = await getOPFSRoot()
          // @ts-expect-error - TS doesn't include async iterator types for FileSystemDirectoryHandle
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
          console.error('Failed to enumerate OPFS projects', err)
        }
      }

      setAllProjects(result)
      setProjectsLoading(false)
    }

    loadAllProjects()
  }, [view, fileSystemSupport.fileSystemAccess, fileSystemSupport.opfs])

  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

  const validateFile = useCallback((file: File): string | null => {
    const validExtensions = ['.csv', '.json', '.geojson']
    const fileName = file.name.toLowerCase()
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext))

    if (!hasValidExtension) {
      return 'Please upload a CSV, JSON, or GeoJSON file.'
    }

    if (file.size > MAX_FILE_SIZE) {
      return 'File size exceeds 50MB limit.'
    }

    return null
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setError(null)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        const file = files[0]
        const validationError = validateFile(file)
        if (validationError) {
          setError(validationError)
          return
        }
        setUploadedFile(file)
        analytics.track('quick_start_file_dropped', { fileType: file.type, fileSize: file.size })
      }
    },
    [validateFile]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null)
      const files = e.target.files
      if (files && files.length > 0) {
        const file = files[0]
        const validationError = validateFile(file)
        if (validationError) {
          setError(validationError)
          return
        }
        setUploadedFile(file)
        analytics.track('quick_start_file_selected', { fileType: file.type, fileSize: file.size })
      }
    },
    [validateFile]
  )

  const handleCreateFromFile = useCallback(() => {
    if (!uploadedFile) return

    analytics.track('quick_start_create_from_file', {
      fileName: uploadedFile.name,
      fileSize: uploadedFile.size,
    })

    // Store the file for the main app to pick up
    setPendingQuickStartAction({ type: 'file', file: uploadedFile })

    // Navigate to an example - the main app can detect the pending action
    onOpenChange(false)
    navigate('/examples/world-flights')
  }, [uploadedFile, onOpenChange, navigate])

  const handleAskQuestion = useCallback(() => {
    if (!llmQuestion.trim()) return

    analytics.track('quick_start_ask_llm', { questionLength: llmQuestion.length })

    // Store the question for the main app to pick up
    setPendingQuickStartAction({ type: 'llm', question: llmQuestion })

    // Navigate to an example - the main app can detect the pending action and open chat
    onOpenChange(false)
    navigate('/examples/world-flights')
  }, [llmQuestion, onOpenChange, navigate])

  const handleExampleClick = useCallback(
    (exampleId: string) => {
      analytics.track('quick_start_example_selected', { example: exampleId })
      onOpenChange(false)
      navigate(`/examples/${exampleId}`)
    },
    [navigate, onOpenChange]
  )

  const handleBrowseAll = useCallback(() => {
    analytics.track('quick_start_browse_all')
    navigate('/examples')
  }, [navigate])

  const handleViewAllProjects = useCallback(() => {
    analytics.track('quick_start_view_all_projects')
    navigate('/projects')
  }, [navigate])

  const handleBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  const handleClose = useCallback(() => {
    onOpenChange(false)
    // Default behavior when closing without action: go to examples
    navigate('/examples/world-flights')
  }, [onOpenChange, navigate])

  const handleOpenFolder = useCallback(async () => {
    try {
      const handle = await selectDirectory()
      await directoryHandleCache.cacheHandle(handle.name, handle, handle.name)
      onOpenChange(false)
      navigate(`/projects/${handle.name}`)
    } catch {
      // User cancelled or permission denied
    }
  }, [navigate, onOpenChange])

  const handleProjectClick = useCallback(
    (path: string) => {
      analytics.track('quick_start_project_selected', { path })
      onOpenChange(false)
      navigate(path)
    },
    [navigate, onOpenChange]
  )

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Render home view content
  const renderHomeView = () => (
    <>
      {/* Header */}
      <div className={s.header}>
        <div className={s.logo}>
          <img src={logoSvg} alt="Noodles.gl" />
        </div>
        <Dialog.Title className={s.title}>Welcome to Noodles.gl</Dialog.Title>
        <Dialog.Description className={s.subtitle}>
          Create beautiful geospatial visualizations with a visual node editor
        </Dialog.Description>
      </div>

      <div className={s.body}>
        {/* Upload Section */}
        <div className={s.section}>
          <h3 className={s.sectionTitle}>Start with your data</h3>
          {/* biome-ignore lint/a11y/useSemanticElements: div needed for drag-and-drop zone styling */}
          <div
            className={`${s.uploadZone} ${isDragging ? s.uploadZoneDragging : ''}`}
            role="button"
            tabIndex={0}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => !uploadedFile && fileInputRef.current?.click()}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                fileInputRef.current?.click()
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,.geojson"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            {uploadedFile ? (
              <div className={s.uploadedFile}>
                <i className={`pi pi-file ${s.uploadIcon}`} style={{ fontSize: '28px' }} />
                <span className={s.fileName}>{uploadedFile.name}</span>
                <span className={s.fileSize}>{formatFileSize(uploadedFile.size)}</span>
                <button
                  type="button"
                  className={s.createButton}
                  onClick={e => {
                    e.stopPropagation()
                    handleCreateFromFile()
                  }}
                >
                  Create Visualization
                </button>
              </div>
            ) : (
              <>
                <i className={`pi pi-cloud-upload ${s.uploadIcon}`} />
                <p className={s.uploadText}>Drop your data file here</p>
                <p className={s.uploadHint}>CSV, JSON, or GeoJSON (max 50MB)</p>
              </>
            )}
          </div>
          {error && <div className={s.error}>{error}</div>}
        </div>

        {/* LLM Section */}
        <div className={s.section}>
          <h3 className={s.sectionTitle}>Or describe what you want to build</h3>
          <div className={s.llmInputWrapper}>
            <textarea
              className={s.llmTextarea}
              value={llmQuestion}
              onChange={e => setLlmQuestion(e.target.value)}
              placeholder="e.g., Create a heatmap showing earthquake density in California..."
              rows={2}
              onKeyDown={e => {
                if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault()
                  handleAskQuestion()
                }
              }}
            />
            <button
              type="button"
              className={s.llmSubmitButton}
              onClick={handleAskQuestion}
              disabled={!llmQuestion.trim()}
            >
              Create
            </button>
          </div>
        </div>

        {/* Examples Section */}
        <div className={s.section}>
          <h3 className={s.sectionTitle}>Or explore examples</h3>
          <div className={s.examplesGrid}>
            {CURATED_EXAMPLES.map(example => (
              <button
                key={example.id}
                type="button"
                className={s.exampleCard}
                onClick={() => handleExampleClick(example.id)}
              >
                <i className={`pi ${example.icon} ${s.exampleIcon}`} />
                <div className={s.exampleInfo}>
                  <h4>{example.title}</h4>
                  <p>{example.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Projects Section */}
        {recentProjects.length > 0 && (
          <div className={s.recentProjectsSection}>
            <div className={s.recentProjectsHeader}>
              <h3 className={s.sectionTitle}>Recent projects</h3>
              <button type="button" className={s.viewAllLink} onClick={handleViewAllProjects}>
                View all →
              </button>
            </div>
            <div className={s.examplesGrid}>
              {recentProjects.map(project => (
                <button
                  key={project.projectName}
                  type="button"
                  className={s.exampleCard}
                  onClick={() => handleProjectClick(`/projects/${project.projectName}`)}
                >
                  <i className={`pi pi-folder ${s.exampleIcon}`} />
                  <div className={s.exampleInfo}>
                    <h4>{project.projectName}</h4>
                    {project.cachedAt && <p>{formatDate(project.cachedAt)}</p>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={s.footer}>
        <a
          href="https://noodles.gl/docs"
          target="_blank"
          rel="noopener noreferrer"
          className={s.docsLink}
        >
          <i className="pi pi-book" />
          Documentation
        </a>
        <button type="button" className={s.browseAllButton} onClick={handleBrowseAll}>
          Browse all examples
        </button>
      </div>
    </>
  )

  // Render projects view content
  const renderProjectsView = () => (
    <>
      {/* Header with back button */}
      <div className={s.viewHeader}>
        <button type="button" className={s.backButton} onClick={handleBack}>
          <ChevronLeftIcon width={16} height={16} />
          Back
        </button>
        <Dialog.Title className={s.viewTitle}>Projects</Dialog.Title>
        <Dialog.Description className={s.viewSubtitle}>
          Your saved projects from local folders and browser storage
        </Dialog.Description>
      </div>

      <div className={s.body}>
        {fileSystemSupport.fileSystemAccess && (
          <div className={s.openFolderSection}>
            <button type="button" className={s.openFolderButton} onClick={handleOpenFolder}>
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
              <p>Use "Open folder…" to open a project from your file system.</p>
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

  // Render examples view content
  const renderExamplesView = () => (
    <>
      {/* Header with back button */}
      <div className={s.viewHeader}>
        <button type="button" className={s.backButton} onClick={handleBack}>
          <ChevronLeftIcon width={16} height={16} />
          Back
        </button>
        <Dialog.Title className={s.viewTitle}>Examples</Dialog.Title>
        <Dialog.Description className={s.viewSubtitle}>
          Explore example projects showcasing different visualizations
        </Dialog.Description>
      </div>

      <div className={s.body}>
        <div className={s.fullGrid}>
          {allExamples.map(example => (
            <button
              key={example.id}
              type="button"
              className={s.projectCard}
              onClick={() => handleExampleClick(example.id)}
            >
              <div className={s.projectInfo}>
                <h4>{formatProjectName(example.name)}</h4>
                {example.description && <p>{example.description}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  )

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          {view === 'home' && renderHomeView()}
          {view === 'projects' && renderProjectsView()}
          {view === 'examples' && renderExamplesView()}

          {/* Close button */}
          <Dialog.Close asChild>
            <button type="button" className={s.closeButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
