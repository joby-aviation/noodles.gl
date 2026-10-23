import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import logoSvg from '/noodles-favicon.svg'
import {
  type CoordinateDetection,
  describeDetection,
  detectFileCoordinates,
  hasCoordinates,
} from '../noodles/components/tools/detect-coordinates'
import {
  detectFormat,
  extensionOf,
  FILE_INPUT_ACCEPT,
  isBinaryFormat,
  isImportable,
} from '../noodles/components/tools/import-pipelines'
import { analytics } from '../utils/analytics'
import { CURATED_EXAMPLES, ExamplesView } from './examples-view'
import { ProjectsView, useRecentProjects } from './projects-view'
import s from './quick-start-modal.module.css'

export type ModalView = 'home' | 'projects' | 'examples'

// Opened when the dialog is closed without a choice: the smallest of the featured
// examples, so a first look at the graph isn't overwhelming
const DEFAULT_EXAMPLE = 'california-earthquakes'

// Store for pending quick start actions (file upload or LLM question)
// These can be picked up by the main app after navigating to a project
interface PendingQuickStartAction {
  type: 'file' | 'llm'
  file?: File
  // Both import the file. chat also opens the AI assistant to help map it.
  mode?: 'map' | 'chat'
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

function formatDate(timestamp?: number): string | null {
  if (!timestamp) return null
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface QuickStartModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialView?: ModalView
}

export function QuickStartModal({
  open,
  onOpenChange,
  initialView = 'home',
}: QuickStartModalProps) {
  const [, navigate] = useLocation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  // undefined while the file is being read
  const [detection, setDetection] = useState<CoordinateDetection | null>()
  const [llmQuestion, setLlmQuestion] = useState('')
  const [error, setError] = useState<string | null>(null)

  // View state managed locally, initialized from prop
  const [view, setView] = useState<ModalView>(initialView)

  // Update view when initialView prop changes
  useEffect(() => {
    setView(initialView)
  }, [initialView])

  // Recent projects state (for home view)
  const recentProjects = useRecentProjects(3)

  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

  const validateFile = useCallback((file: File): string | null => {
    // Same formats as dropping a file on the canvas
    if (!isImportable(file.name)) {
      return 'Please upload a CSV, TSV, JSON, GeoJSON, Shapefile, GeoParquet, or PMTiles file.'
    }

    if (file.size > MAX_FILE_SIZE) {
      return 'File size exceeds 50MB limit.'
    }

    return null
  }, [])

  // Look for coordinates as soon as a file is chosen, so the dialog can say whether
  // it will map before the user commits
  const latestFileRef = useRef<File | null>(null)
  const acceptFile = useCallback((file: File) => {
    latestFileRef.current = file
    setUploadedFile(file)
    setDetection(undefined)
    // Ignore the result if another file was dropped while this one was being read
    const settle = (found: CoordinateDetection | null) => {
      if (latestFileRef.current === file) setDetection(found)
    }
    // Binary formats carry their own geometry and can't be read as text
    if (isBinaryFormat(detectFormat(file.name))) {
      settle(null)
      return
    }
    file
      .text()
      .then(contents =>
        settle(detectFileCoordinates(detectFormat(file.name, contents), contents) ?? null)
      )
      .catch(() => settle(null))
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
          const fileType = extensionOf(file.name) || 'unknown'
          const reason = file.size > MAX_FILE_SIZE ? 'size_limit' : 'unsupported_type'
          analytics.track('file_import_failed', {
            fileType,
            attemptedFormat: 'unknown',
            reason,
            source: 'quickstart',
            fileSize: file.size,
          })
          setError(validationError)
          return
        }
        acceptFile(file)
        analytics.track('quick_start_file_dropped', { fileType: file.type, fileSize: file.size })
      }
    },
    [validateFile, acceptFile]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null)
      const files = e.target.files
      if (files && files.length > 0) {
        const file = files[0]
        const validationError = validateFile(file)
        if (validationError) {
          const fileType = extensionOf(file.name) || 'unknown'
          const reason = file.size > MAX_FILE_SIZE ? 'size_limit' : 'unsupported_type'
          analytics.track('file_import_failed', {
            fileType,
            attemptedFormat: 'unknown',
            reason,
            source: 'quickstart',
            fileSize: file.size,
          })
          setError(validationError)
          return
        }
        acceptFile(file)
        analytics.track('quick_start_file_selected', { fileType: file.type, fileSize: file.size })
      }
    },
    [validateFile, acceptFile]
  )

  const handleCreateFromFile = useCallback(
    (mode: 'map' | 'chat') => {
      if (!uploadedFile) return

      analytics.track('quick_start_create_from_file', {
        fileSize: uploadedFile.size,
        mode,
        detected: hasCoordinates(detection ?? undefined),
      })

      // Store the file for the main app to pick up
      setPendingQuickStartAction({ type: 'file', file: uploadedFile, mode })

      // Either way the file is imported into a blank project, so it is never lost
      onOpenChange(false)
      navigate('/projects/new')
    },
    [uploadedFile, detection, onOpenChange, navigate]
  )

  const handleAskQuestion = useCallback(() => {
    if (!llmQuestion.trim()) return

    analytics.track('quick_start_ask_llm', { questionLength: llmQuestion.length })

    // Store the question for the main app to pick up
    setPendingQuickStartAction({ type: 'llm', question: llmQuestion })

    // Build from a blank project rather than editing an unrelated example
    onOpenChange(false)
    navigate('/projects/new')
  }, [llmQuestion, onOpenChange, navigate])

  const handleExampleClick = useCallback(
    (exampleId: string) => {
      analytics.track('quick_start_example_selected', { example: exampleId })
      onOpenChange(false)
      navigate(`/examples/${exampleId}`)
    },
    [navigate, onOpenChange]
  )

  const handleProjectClick = useCallback(
    (path: string) => {
      analytics.track('quick_start_project_selected', { path })
      onOpenChange(false)
      navigate(path)
    },
    [navigate, onOpenChange]
  )

  const handleClose = useCallback(() => {
    onOpenChange(false)
    // Default behavior when closing without action: go to examples
    navigate(`/examples/${DEFAULT_EXAMPLE}`)
  }, [onOpenChange, navigate])

  // Switch tabs and update the URL so deep links stay in sync
  const switchToTab = useCallback(
    (newView: ModalView) => {
      setView(newView)
      const paths: Record<ModalView, string> = {
        home: '/',
        projects: '/projects',
        examples: '/examples',
      }
      navigate(paths[newView], { replace: true })
    },
    [navigate]
  )

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const renderFileActions = () => {
    if (detection === undefined) {
      return <span className={s.detectionText}>Looking for coordinates…</span>
    }
    // null: a binary format or a file we couldn't read ahead, mapped on import
    const mappable = detection === null || hasCoordinates(detection)
    const message =
      detection && detection.kind !== 'geojson' ? describeDetection(detection, 'found') : null
    return (
      <>
        {message && (
          <span className={s.detectionText}>
            {mappable ? message : `${message}. It will open as a table you can place on the map.`}
          </span>
        )}
        <button
          type="button"
          className={s.createButton}
          onClick={e => {
            e.stopPropagation()
            handleCreateFromFile('map')
          }}
        >
          {mappable ? 'Show on map' : 'Open in editor'}
        </button>
        <button
          type="button"
          className={s.secondaryLink}
          onClick={e => {
            e.stopPropagation()
            handleCreateFromFile('chat')
          }}
        >
          {mappable ? 'Open with the AI assistant' : 'Ask AI to map it'}
        </button>
      </>
    )
  }

  const renderHomeView = () => (
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
            accept={FILE_INPUT_ACCEPT}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {uploadedFile ? (
            <div className={s.uploadedFile}>
              <i className={`pi pi-file ${s.uploadIcon}`} style={{ fontSize: '28px' }} />
              <span className={s.fileName}>{uploadedFile.name}</span>
              <span className={s.fileSize}>{formatFileSize(uploadedFile.size)}</span>
              {renderFileActions()}
            </div>
          ) : (
            <>
              <i className={`pi pi-cloud-upload ${s.uploadIcon}`} />
              <p className={s.uploadText}>Drop your data file here</p>
              <p className={s.uploadHint}>CSV, GeoJSON, Parquet, Shapefile and more (max 50MB)</p>
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
        <div className={s.recentProjectsHeader}>
          <h3 className={s.sectionTitle}>Featured examples</h3>
          <button type="button" className={s.viewAllLink} onClick={() => switchToTab('examples')}>
            View all →
          </button>
        </div>
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
            <button type="button" className={s.viewAllLink} onClick={() => switchToTab('projects')}>
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

      {/* Docs link */}
      <div className={s.docsRow}>
        <a
          href="https://noodles.gl/docs"
          target="_blank"
          rel="noopener noreferrer"
          className={s.docsLink}
        >
          <i className="pi pi-book" />
          Documentation
        </a>
      </div>
    </div>
  )

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          {/* Compact header */}
          <div className={s.compactHeader}>
            <div className={s.headerBrand}>
              <img src={logoSvg} alt="" className={s.headerLogo} />
              <Dialog.Title className={s.headerTitle}>Noodles.gl</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button type="button" className={s.closeButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </div>

          {/* Tab bar */}
          <div className={s.tabBar}>
            <button
              type="button"
              className={s.tabButton}
              data-active={view === 'home' ? '' : undefined}
              onClick={() => switchToTab('home')}
            >
              Home
            </button>
            <button
              type="button"
              className={s.tabButton}
              data-active={view === 'projects' ? '' : undefined}
              onClick={() => switchToTab('projects')}
            >
              Projects
            </button>
            <button
              type="button"
              className={s.tabButton}
              data-active={view === 'examples' ? '' : undefined}
              onClick={() => switchToTab('examples')}
            >
              Examples
            </button>
          </div>

          {view === 'home' && renderHomeView()}
          {view === 'projects' && <ProjectsView onClose={() => onOpenChange(false)} />}
          {view === 'examples' && <ExamplesView onClose={() => onOpenChange(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
