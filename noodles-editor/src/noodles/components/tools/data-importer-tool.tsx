import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useReactFlow } from '@xyflow/react'
import { useCallback, useRef, useState } from 'react'
import { useFileImport } from '../../hooks/use-file-import'
import s from './data-importer-tool.module.css'
import { FILE_INPUT_ACCEPT, isImportable } from './import-pipelines'

const SAMPLE_DATASETS = [
  {
    name: 'World Countries',
    url: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
    format: 'geojson' as const,
  },
  {
    name: 'US States',
    url: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
    format: 'geojson' as const,
  },
  {
    name: 'World Airports',
    url: 'https://raw.githubusercontent.com/datasets/airport-codes/master/data/airport-codes.csv',
    format: 'csv' as const,
  },
  {
    name: 'World Cities',
    url: 'https://raw.githubusercontent.com/datasets/world-cities/master/data/world-cities.csv',
    format: 'csv' as const,
  },
]

interface DataImporterToolProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reactFlowRef: React.RefObject<HTMLDivElement>
}

export function DataImporterTool({ open, onOpenChange, reactFlowRef }: DataImporterToolProps) {
  const { screenToFlowPosition } = useReactFlow()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [urlInput, setUrlInput] = useState('')

  const getBasePosition = useCallback(() => {
    const pane = reactFlowRef.current?.getBoundingClientRect()
    if (!pane) return { x: 0, y: 0 }
    return screenToFlowPosition({
      x: pane.left + pane.width / 2,
      y: pane.top + pane.height / 2,
    })
  }, [reactFlowRef, screenToFlowPosition])

  const { importFile, importUrl } = useFileImport({ getBasePosition })

  const runImport = useCallback(
    async (work: () => Promise<void> | void) => {
      setError(null)
      setIsImporting(true)
      try {
        await work()
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import')
      } finally {
        setIsImporting(false)
      }
    },
    [onOpenChange]
  )

  const importFiles = useCallback(
    (files: File[], source: string) => {
      const supported = files.filter(file => isImportable(file.name))
      if (supported.length === 0) {
        setError(`Can't import ${files[0]?.name ?? 'that file'}. Supported: ${FILE_INPUT_ACCEPT}`)
        return
      }
      const basePosition = getBasePosition()
      return runImport(async () => {
        for (const [index, file] of supported.entries()) {
          await importFile(file, { x: basePosition.x, y: basePosition.y + index * 700 }, source)
        }
      })
    },
    [getBasePosition, importFile, runImport]
  )

  const handleUrlImport = useCallback(() => {
    const url = urlInput.trim()
    if (!url) return
    return runImport(() => {
      importUrl(url, 'tools_shelf_url')
      setUrlInput('')
    })
  }, [urlInput, importUrl, runImport])

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      if (files.length === 0) return
      await importFiles(files, 'tools_shelf')

      // Reset file input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [importFiles]
  )

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
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length === 0) return
      await importFiles(files, 'tools_shelf')
    },
    [importFiles]
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>Import Data</Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Add data from a file or URL to create a visualization pipeline. You can also drop a file
            straight onto the graph canvas.
          </Dialog.Description>

          {/* biome-ignore lint/a11y/useSemanticElements: div needed for drag-and-drop zone styling */}
          <div
            className={`${s.dropZone} ${isDragging ? s.dropZoneDragging : ''}`}
            role="button"
            tabIndex={0}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_INPUT_ACCEPT}
              onChange={handleFileSelect}
              multiple
              style={{ display: 'none' }}
            />

            <div className={s.dropZoneContent}>
              <i className={`pi pi-cloud-upload ${s.uploadIcon}`} />
              <div className={s.dropZoneText}>Drag and drop files here</div>
              <div className={s.dropZoneSubtext}>or</div>
              <button
                type="button"
                className={s.uploadButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                Browse Files
              </button>
              <div className={s.dropZoneHint}>
                CSV, JSON, GeoJSON, Shapefile, GeoParquet, PMTiles
              </div>
            </div>
          </div>

          <div className={s.urlSection}>
            <div className={s.urlLabel}>Or load from URL</div>
            <div className={s.urlInputGroup}>
              <input
                type="url"
                className={s.urlInput}
                placeholder="https://example.com/data.geojson"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleUrlImport()
                }}
                disabled={isImporting}
              />
              <button
                type="button"
                className={s.urlLoadButton}
                onClick={handleUrlImport}
                disabled={isImporting || !urlInput.trim()}
              >
                Load
              </button>
            </div>
          </div>

          <div className={s.sampleSection}>
            <div className={s.urlLabel}>Sample datasets</div>
            <div className={s.sampleGrid}>
              {SAMPLE_DATASETS.map(sample => (
                <button
                  key={sample.url}
                  type="button"
                  className={s.sampleButton}
                  disabled={isImporting}
                  onClick={() => {
                    setUrlInput(sample.url)
                    runImport(() => {
                      importUrl(sample.url, 'sample_dataset', sample.format)
                    })
                  }}
                >
                  <span className={s.sampleName}>{sample.name}</span>
                  <span className={s.sampleFormat}>{sample.format}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <div className={s.error}>{error}</div>}

          {isImporting && (
            <div className={s.importing}>
              <i className="pi pi-spin pi-spinner" />
              <span>Importing...</span>
            </div>
          )}

          <div className={s.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={s.cancelButton}>
                Close
              </button>
            </Dialog.Close>
          </div>

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
